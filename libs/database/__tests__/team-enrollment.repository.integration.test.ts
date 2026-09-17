import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createTeamEnrollmentRepository } from '../src/repositories/team-enrollment.repository.js';
import { agents, teamEnrollments, teamInvites, teams } from '../src/schema.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

let db: Database;
let pool: Pool;
let stop: (() => Promise<unknown>) | undefined;
let repository: ReturnType<typeof createTeamEnrollmentRepository>;
let runner: ReturnType<typeof createDrizzleTransactionRunner>;

beforeAll(async () => {
  const container = await new PostgreSqlContainer(
    'pgvector/pgvector:pg16',
  ).start();
  stop = () => container.stop();
  await runMigrations(container.getConnectionUri());
  ({ db, pool } = createDatabase(container.getConnectionUri()));
  repository = createTeamEnrollmentRepository(db);
  runner = createDrizzleTransactionRunner(db);
}, 120_000);
afterAll(async () => {
  await pool?.end();
  await stop?.();
});

async function fixture(maxUses = 1) {
  const [agent] = await db
    .insert(agents)
    .values({
      publicKey: `ed25519:${randomUUID()}`,
      fingerprint: randomUUID().slice(0, 19),
    })
    .returning();
  const [team] = await db
    .insert(teams)
    .values({
      name: 'Enrollment test',
      creatorAgentId: agent.id,
      personal: false,
      status: 'active',
    })
    .returning();
  const [invite] = await db
    .insert(teamInvites)
    .values({
      teamId: team.id,
      code: randomUUID(),
      creatorAgentId: agent.id,
      maxUses,
      expiresAt: new Date(Date.now() + 60_000),
    })
    .returning();
  return {
    agent,
    team,
    invite,
    input: {
      agentId: agent.id,
      inviteId: invite.id,
      idempotencyHash: 'a'.repeat(64),
      requestHash: 'b'.repeat(64),
    },
  };
}
const claim = (input: Parameters<typeof repository.claim>[0]) =>
  runner.runInTransaction(() => repository.claim(input));
async function uses(inviteId: string) {
  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.id, inviteId));
  return invite.useCount;
}

describe('durable team enrollment claims', () => {
  it('deduplicates concurrent retries and consumes exactly one use', async () => {
    const { input, invite } = await fixture(10);
    const receipts = await Promise.all(
      Array.from({ length: 10 }, () => claim(input)),
    );
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(await uses(invite.id)).toBe(1);
    expect(receipts[0]).not.toHaveProperty('code');
    expect(receipts[0]).not.toHaveProperty('secret');
  });

  it('allows only one subject to consume the final invitation use', async () => {
    const { input, invite } = await fixture();
    const other = await fixture();
    const results = await Promise.allSettled([
      claim(input),
      claim({ ...input, agentId: other.agent.id }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(await uses(invite.id)).toBe(1);
  });

  it('rolls back both the receipt and invite consumption', async () => {
    const { input, invite } = await fixture();
    await expect(
      runner.runInTransaction(async () => {
        await repository.claim(input);
        throw new Error('injected transaction failure');
      }),
    ).rejects.toThrow('injected transaction failure');
    expect(await uses(invite.id)).toBe(0);
    expect(
      await repository.findByRequest(input.agentId, input.idempotencyHash),
    ).toBeNull();
    expect((await claim(input)).inviteId).toBe(invite.id);
  });

  it('rejects key reuse with different input and a new key for an already redeemed invite', async () => {
    const { input, invite } = await fixture(5);
    await claim(input);
    await expect(
      claim({ ...input, requestHash: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ reason: 'conflict' });
    await expect(
      claim({ ...input, idempotencyHash: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ reason: 'conflict' });
    expect(await uses(invite.id)).toBe(1);
  });

  it.each(['expired', 'exhausted', 'deleted', 'inactive', 'personal'] as const)(
    'rejects %s invitations without a receipt',
    async (kind) => {
      const { input, invite, team } = await fixture();
      if (kind === 'expired')
        await db
          .update(teamInvites)
          .set({ expiresAt: new Date(0) })
          .where(eq(teamInvites.id, invite.id));
      if (kind === 'exhausted')
        await db
          .update(teamInvites)
          .set({ useCount: 1 })
          .where(eq(teamInvites.id, invite.id));
      if (kind === 'deleted')
        await db.delete(teamInvites).where(eq(teamInvites.id, invite.id));
      if (kind === 'inactive')
        await db
          .update(teams)
          .set({ status: 'archived' })
          .where(eq(teams.id, team.id));
      if (kind === 'personal')
        await db
          .update(teams)
          .set({ personal: true })
          .where(eq(teams.id, team.id));
      await expect(claim(input)).rejects.toMatchObject({
        name: 'TeamEnrollmentError',
      });
      expect(
        await repository.findByRequest(input.agentId, input.idempotencyHash),
      ).toBeNull();
      if (kind !== 'deleted')
        expect(await uses(invite.id)).toBe(kind === 'exhausted' ? 1 : 0);
    },
  );

  it('retains accepted progress after invite deletion, and only stores a key identifier', async () => {
    const { input, invite } = await fixture();
    const receipt = await claim(input);
    await db.delete(teamInvites).where(eq(teamInvites.id, invite.id));
    expect((await claim(input)).id).toBe(receipt.id);
    await expect(
      repository.markIssued(receipt.id, 'key-1'),
    ).rejects.toMatchObject({ reason: 'conflict' });
    await repository.markMembership(receipt.id, 'owner');
    await repository.markIssued(receipt.id, 'key-1');
    await repository.markIssued(receipt.id, 'key-1');
    await expect(
      repository.markIssued(receipt.id, 'key-2'),
    ).rejects.toMatchObject({ reason: 'conflict' });
    expect(
      await repository.findByRequest(input.agentId, input.idempotencyHash),
    ).toMatchObject({ role: 'owner', issuedKeyId: 'key-1' });
  });

  it('requires a transaction and enforces receipt state in Postgres', async () => {
    const { input } = await fixture();
    await expect(repository.claim(input)).rejects.toThrow('TransactionRunner');
    const receipt = await claim(input);
    await expect(
      db
        .update(teamEnrollments)
        .set({ role: 'member' })
        .where(eq(teamEnrollments.id, receipt.id)),
    ).rejects.toThrow();
    const result = await db.execute(
      sql`SELECT count(*)::int AS count FROM team_enrollments WHERE id = ${receipt.id}`,
    );
    expect(result.rows[0].count).toBe(1);
  });
});
