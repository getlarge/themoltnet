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
import { agents, teamInvites, teams } from '../src/schema.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

let db: Database;
let pool: Pool;
let stop: (() => Promise<unknown>) | undefined;
let repository: ReturnType<typeof createTeamRepository>;
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
    const boundary = journal.entries.findIndex(
      (entry: { tag: string }) => entry.tag === '0047_single_use_team_invites',
    );
    if (boundary < 0)
      throw new Error('Single-use migration missing from journal');
    journal.entries = journal.entries.slice(0, boundary);
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
  repository = createTeamRepository(db);
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
  };
}
const claim = (id: string) =>
  runner.runInTransaction(() => repository.claimInvite(id));
async function uses(inviteId: string) {
  const [invite] = await db
    .select()
    .from(teamInvites)
    .where(eq(teamInvites.id, inviteId));
  return invite.usedAt !== null;
}

describe('single-use team invites', () => {
  it('backfills every legacy invite as consumed and leaves new invites unused', async () => {
    for (const id of legacyInvites) {
      const invite = await repository.findInviteById(id);
      expect(invite?.usedAt).toBeInstanceOf(Date);
      expect(await claim(id)).toBeNull();
    }
    const { invite } = await fixture();
    expect(invite.usedAt).toBeNull();
    expect(await claim(invite.id)).not.toBeNull();
  });

  it('serializes old and new binary claims under the single-use compatibility trigger', async () => {
    const { invite } = await fixture();
    const [oldClaim, newClaim] = await Promise.all([
      pool.query(
        'UPDATE team_invites SET use_count = use_count + 1 WHERE id = $1 AND use_count < max_uses RETURNING id',
        [invite.id],
      ),
      claim(invite.id),
    ]);
    expect(oldClaim.rowCount! + Number(newClaim !== null)).toBe(1);
    const state = (
      await pool.query(
        'SELECT max_uses, use_count, used_at FROM team_invites WHERE id = $1',
        [invite.id],
      )
    ).rows[0];
    expect(state).toMatchObject({ max_uses: 1, use_count: 1 });
    expect(state.used_at).toBeInstanceOf(Date);
    await pool.query(
      'UPDATE team_invites SET use_count = use_count - 1 WHERE id = $1',
      [invite.id],
    );
    expect((await repository.findInviteById(invite.id))?.usedAt).toBeNull();
    expect(await claim(invite.id)).not.toBeNull();
  });

  it('allows exactly one concurrent claim', async () => {
    const { invite } = await fixture();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => claim(invite.id)),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await uses(invite.id)).toBe(true);
  });

  it('rolls back invite consumption with the surrounding transaction', async () => {
    const { invite } = await fixture();
    await expect(
      runner.runInTransaction(async () => {
        await repository.claimInvite(invite.id);
        throw new Error('injected transaction failure');
      }),
    ).rejects.toThrow('injected transaction failure');
    expect(await uses(invite.id)).toBe(false);
    expect(await claim(invite.id)).not.toBeNull();
  });

  it.each(['expired', 'used', 'deleted', 'inactive', 'personal'] as const)(
    'does not claim an %s invite',
    async (kind) => {
      const { invite, team } = await fixture();
      if (kind === 'expired')
        await db
          .update(teamInvites)
          .set({ expiresAt: new Date(0) })
          .where(eq(teamInvites.id, invite.id));
      if (kind === 'used') await claim(invite.id);
      if (kind === 'deleted') await repository.deleteInvite(invite.id);
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
      expect(await claim(invite.id)).toBeNull();
      if (kind !== 'deleted')
        expect(await uses(invite.id)).toBe(kind === 'used');
    },
  );

  it('can release a failed registration claim for a later attempt', async () => {
    const { invite } = await fixture();
    await claim(invite.id);
    await repository.revertInviteClaim(invite.id);
    expect(await claim(invite.id)).not.toBeNull();
    expect(await claim(invite.id)).toBeNull();
  });
});
