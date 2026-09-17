import { randomUUID } from 'node:crypto';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createTeamRepository } from '../src/repositories/team.repository.js';
import { createTeamEnrollmentRepository } from '../src/repositories/team-enrollment.repository.js';
import { agents, teamInvites, teams } from '../src/schema.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

let db: Database;
let pool: Pool;
let stop: (() => Promise<unknown>) | undefined;
let repository: ReturnType<typeof createTeamEnrollmentRepository>;
let runner: ReturnType<typeof createDrizzleTransactionRunner>;
const legacyInvites = [randomUUID(), randomUUID()];

beforeAll(async () => {
  const container = await new PostgreSqlContainer(
    'pgvector/pgvector:pg16',
  ).start();
  stop = () => container.stop();
  ({ db, pool } = createDatabase(container.getConnectionUri()));
  const legacy = await mkdtemp(join(tmpdir(), 'single-use-migration-'));
  try {
    await cp(resolve(import.meta.dirname, '../drizzle'), legacy, {
      recursive: true,
    });
    const journalPath = join(legacy, 'meta/_journal.json');
    const journal = JSON.parse(await readFile(journalPath, 'utf8'));
    journal.entries = journal.entries.filter(
      (entry: { idx: number }) => entry.idx < 46,
    );
    await writeFile(journalPath, JSON.stringify(journal));
    await migrate(db, { migrationsFolder: legacy });
    const owner = randomUUID(),
      team = randomUUID();
    await pool.query(
      'INSERT INTO agents(id, public_key, fingerprint) VALUES ($1, $2, $3)',
      [owner, 'ed25519:legacy', 'legacy'],
    );
    await pool.query(
      'INSERT INTO teams(id, name, creator_agent_id, personal, status) VALUES ($1, $2, $3, false, $4)',
      [team, 'Legacy invites', owner, 'active'],
    );
    for (let uses = 0; uses < 2; uses++)
      await pool.query(
        "INSERT INTO team_invites(id, team_id, code, creator_agent_id, expires_at, max_uses, use_count) VALUES ($1, $2, $3, $4, now() + interval '1 day', 3, $5)",
        [legacyInvites[uses], team, randomUUID(), owner, uses],
      );
    await runMigrations(container.getConnectionUri());
  } finally {
    await rm(legacy, { recursive: true, force: true });
  }
  repository = createTeamEnrollmentRepository(db);
  runner = createDrizzleTransactionRunner(db);
}, 120_000);
afterAll(async () => {
  await pool?.end();
  await stop?.();
});

async function fixture() {
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
  return invite.usedAt !== null;
}

describe('durable team enrollment claims', () => {
  it('migrates previously used invites without reopening them', async () => {
    const invites = createTeamRepository(db);
    expect(
      (await invites.findInviteById(legacyInvites[1]))?.usedAt,
    ).not.toBeNull();
    expect(await invites.claimInvite(legacyInvites[1])).toBeNull();
    expect(await invites.claimInvite(legacyInvites[0])).not.toBeNull();
    expect(await invites.claimInvite(legacyInvites[0])).toBeNull();
  });
  it('deduplicates concurrent retries and consumes exactly one use', async () => {
    const { input, invite } = await fixture();
    const receipts = await Promise.all(
      Array.from({ length: 10 }, () => claim(input)),
    );
    expect(new Set(receipts.map((receipt) => receipt.id)).size).toBe(1);
    expect(await uses(invite.id)).toBe(true);
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
    expect(await uses(invite.id)).toBe(true);
  });

  it('rolls back both the receipt and invite consumption', async () => {
    const { input, invite } = await fixture();
    await expect(
      runner.runInTransaction(async () => {
        await repository.claim(input);
        throw new Error('injected transaction failure');
      }),
    ).rejects.toThrow('injected transaction failure');
    expect(await uses(invite.id)).toBe(false);
    expect(
      await repository.findByRequest(input.agentId, input.idempotencyHash),
    ).toBeNull();
    expect((await claim(input)).id).toBe(invite.id);
  });

  it('rejects key reuse with different input and a new key for an already redeemed invite', async () => {
    const { input, invite } = await fixture();
    await claim(input);
    await expect(
      claim({ ...input, requestHash: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ reason: 'conflict' });
    await expect(
      claim({ ...input, idempotencyHash: 'c'.repeat(64) }),
    ).rejects.toMatchObject({ reason: 'conflict' });
    expect(await uses(invite.id)).toBe(true);
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
          .set({ usedAt: new Date() })
          .where(eq(teamInvites.id, invite.id));
      if (kind === 'deleted')
        await createTeamRepository(db).deleteInvite(invite.id);
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
        expect(await uses(invite.id)).toBe(kind === 'exhausted');
    },
  );

  it('retains a claim when an invite is revoked and hides it from discovery', async () => {
    const { input, invite, team } = await fixture();
    const receipt = await claim(input);
    const invites = createTeamRepository(db);
    expect(await invites.deleteInviteByTeam(invite.id, team.id)).toBe(true);
    expect(await invites.findInviteByCode(invite.code)).toBeNull();
    expect(await invites.listInvites(team.id)).toEqual([]);
    expect(await invites.claimInvite(invite.id)).toBeNull();
    expect(await claim(input)).toEqual(receipt);
    expect(receipt.id).toBe(invite.id);
  });

  it('requires a transaction and enforces complete enrollment claims in Postgres', async () => {
    const { input, invite } = await fixture();
    await expect(repository.claim(input)).rejects.toThrow('TransactionRunner');
    await expect(
      db
        .update(teamInvites)
        .set({ enrollmentAgentId: input.agentId })
        .where(eq(teamInvites.id, invite.id)),
    ).rejects.toThrow();
    await claim(input);
    expect(await uses(invite.id)).toBe(true);
  });

  it('serializes membership-only and enrollment claims on the same invite', async () => {
    const { input, invite } = await fixture();
    const invites = createTeamRepository(db);
    const results = await Promise.allSettled([
      claim(input),
      invites.claimInvite(invite.id),
    ]);
    expect(
      results.filter((r) => r.status === 'fulfilled' && r.value !== null),
    ).toHaveLength(1);
    expect(await uses(invite.id)).toBe(true);
  });

  it('only compensates membership-only claims', async () => {
    const { input, invite } = await fixture();
    const invites = createTeamRepository(db);
    await invites.claimInvite(invite.id);
    expect(await invites.claimInvite(invite.id)).toBeNull();
    await invites.revertInviteClaim(invite.id);
    expect(await uses(invite.id)).toBe(false);
    await claim(input);
    expect(await invites.revertInviteClaim(invite.id)).toBeNull();
    expect(await uses(invite.id)).toBe(true);
  });
});
