/**
 * Integration tests for identity key history: the `agents` trigger that
 * records every key, the compare-and-swap rotation, and the lookups signature
 * verification relies on. A mock cannot reproduce trigger or unique-index
 * behaviour, so these run against real Postgres.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  AgentFingerprintConflictError,
  AgentIdentityKeyStaleError,
  createAgentRepository,
} from '../src/repositories/agent.repository.js';
import { createAgentIdentityKeyRepository } from '../src/repositories/agent-identity-key.repository.js';
import { createDrizzleTransactionRunner } from '../src/transaction-context.js';

let db: Database;
let pool: Pool;
let databaseUrl: string;
let stopContainer: () => Promise<void>;

beforeAll(async () => {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('moltnet')
    .withUsername('moltnet')
    .withPassword('moltnet_secret')
    .start();
  stopContainer = () => container.stop().then(() => undefined);
  databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  ({ db, pool } = createDatabase(databaseUrl));
}, 120_000);

afterAll(async () => {
  await pool.end();
  await stopContainer();
});

let counter = 0;
function nextKey(): { publicKey: string; fingerprint: string } {
  counter += 1;
  const suffix = counter.toString(16).toUpperCase().padStart(4, '0');
  return {
    publicKey: `ed25519:identity-history-key-${counter}`,
    fingerprint: `HIST-0000-0000-${suffix}`,
  };
}

const PROOF = {
  message: 'moltnet:identity:rotate:v1\n...',
  previousPublicKey: 'ed25519:previous',
  previousKeySignature: 'previous-signature',
  newKeySignature: 'new-signature',
};

describe('Agent identity key history (integration)', () => {
  it('opens a history row when an agent is registered', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const key = nextKey();

    const { agent } = await agents.upsertByFingerprint(key);

    const rows = await history.listForAgent(agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      publicKey: key.publicKey,
      fingerprint: key.fingerprint,
      validUntil: null,
      rotationProof: null,
    });
  });

  it('closes the old key and opens the new one on rotation', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const oldKey = nextKey();
    const newKey = nextKey();
    const { agent } = await agents.upsertByFingerprint(oldKey);

    const rotated = await agents.rotateIdentityKey({
      agentId: agent.id,
      currentPublicKey: oldKey.publicKey,
      ...newKey,
    });
    expect(
      await history.attachRotationProof(agent.id, newKey.publicKey, PROOF),
    ).toBe(true);

    expect(rotated).toMatchObject({ id: agent.id, ...newKey });
    const rows = await history.listForAgent(agent.id);
    expect(rows.map((row) => row.fingerprint)).toEqual([
      oldKey.fingerprint,
      newKey.fingerprint,
    ]);
    expect(rows[0].validUntil).toEqual(rows[1].validFrom);
    expect(rows[1].validUntil).toBeNull();
    expect(rows[1].rotationProof).toEqual(PROOF);
    // A retired key's fingerprint still resolves to its agent.
    expect((await history.findByFingerprint(oldKey.fingerprint))?.agentId).toBe(
      agent.id,
    );
  });

  it('finds the key that was valid at signing time', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const oldKey = nextKey();
    const newKey = nextKey();
    const { agent } = await agents.upsertByFingerprint(oldKey);
    const beforeRotation = new Date();
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    await agents.rotateIdentityKey({
      agentId: agent.id,
      currentPublicKey: oldKey.publicKey,
      ...newKey,
    });
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
    const afterRotation = new Date();

    const before = await history.findKeysValidBetween(
      agent.id,
      beforeRotation,
      beforeRotation,
    );
    const after = await history.findKeysValidBetween(
      agent.id,
      afterRotation,
      afterRotation,
    );
    const spanning = await history.findKeysValidBetween(
      agent.id,
      beforeRotation,
      afterRotation,
    );

    expect(before.map((row) => row.publicKey)).toEqual([oldKey.publicKey]);
    expect(after.map((row) => row.publicKey)).toEqual([newKey.publicKey]);
    expect(spanning.map((row) => row.publicKey)).toEqual([
      newKey.publicKey,
      oldKey.publicKey,
    ]);
  });

  it('rejects a rotation whose current key has already moved on', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const oldKey = nextKey();
    const { agent } = await agents.upsertByFingerprint(oldKey);
    await agents.rotateIdentityKey({
      agentId: agent.id,
      currentPublicKey: oldKey.publicKey,
      ...nextKey(),
    });

    await expect(
      agents.rotateIdentityKey({
        agentId: agent.id,
        currentPublicKey: oldKey.publicKey,
        ...nextKey(),
      }),
    ).rejects.toBeInstanceOf(AgentIdentityKeyStaleError);
    expect(await history.listForAgent(agent.id)).toHaveLength(2);
  });

  it('rolls back the key and its history when the transaction fails', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const runner = createDrizzleTransactionRunner(db);
    const oldKey = nextKey();
    const newKey = nextKey();
    const { agent } = await agents.upsertByFingerprint(oldKey);

    await expect(
      runner.runInTransaction(async () => {
        await agents.rotateIdentityKey({
          agentId: agent.id,
          currentPublicKey: oldKey.publicKey,
          ...newKey,
        });
        await history.attachRotationProof(agent.id, newKey.publicKey, PROOF);
        throw new Error('fail after rotating');
      }),
    ).rejects.toThrow('fail after rotating');

    expect(await agents.findById(agent.id)).toMatchObject(oldKey);
    const rows = await history.listForAgent(agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...oldKey, validUntil: null });
    expect(await history.findByFingerprint(newKey.fingerprint)).toBeNull();
  });

  it('rolls back the rotation when attaching the proof fails in the database', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const runner = createDrizzleTransactionRunner(db);
    const oldKey = nextKey();
    const newKey = nextKey();
    const { agent } = await agents.upsertByFingerprint(oldKey);
    // jsonb rejects the NUL escape, so the UPDATE itself fails.
    const unstorableProof = { ...PROOF, message: 'moltnet:identity\u0000' };

    await expect(
      runner.runInTransaction(async () => {
        await agents.rotateIdentityKey({
          agentId: agent.id,
          currentPublicKey: oldKey.publicKey,
          ...newKey,
        });
        await history.attachRotationProof(
          agent.id,
          newKey.publicKey,
          unstorableProof,
        );
      }),
    ).rejects.toThrow();

    expect(await agents.findById(agent.id)).toMatchObject(oldKey);
    const rows = await history.listForAgent(agent.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ...oldKey, validUntil: null });
  });

  it('reports no attachment for a key without an open history row', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const key = nextKey();
    const { agent } = await agents.upsertByFingerprint(key);

    expect(
      await history.attachRotationProof(agent.id, 'ed25519:never-held', PROOF),
    ).toBe(false);
  });

  it('lets exactly one of two concurrent rotations win', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const oldKey = nextKey();
    const firstKey = nextKey();
    const secondKey = nextKey();
    const { agent } = await agents.upsertByFingerprint(oldKey);
    // Each rotation runs on its own pool, so the two transactions hold
    // separate connections and really contend for the agent row.
    const first = createDatabase(databaseUrl);
    const second = createDatabase(databaseUrl);
    const firstAgents = createAgentRepository(first.db);
    const secondAgents = createAgentRepository(second.db);
    let releaseFirst!: () => void;
    const firstHolds = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstRotated!: () => void;
    const firstHasRow = new Promise<void>((resolve) => {
      firstRotated = resolve;
    });

    try {
      const firstTx = createDrizzleTransactionRunner(first.db).runInTransaction(
        async () => {
          const rotated = await firstAgents.rotateIdentityKey({
            agentId: agent.id,
            currentPublicKey: oldKey.publicKey,
            ...firstKey,
          });
          firstRotated();
          await firstHolds;
          return rotated;
        },
      );
      await firstHasRow;
      const secondTx = createDrizzleTransactionRunner(
        second.db,
      ).runInTransaction(() =>
        secondAgents.rotateIdentityKey({
          agentId: agent.id,
          currentPublicKey: oldKey.publicKey,
          ...secondKey,
        }),
      );
      // Commit the first rotation only once the second is waiting on the
      // row lock, so the second re-reads the row after the first commits.
      await expect
        .poll(async () => {
          const result = await db.execute(
            sql`SELECT count(*)::int AS waiting FROM pg_stat_activity
                WHERE wait_event_type = 'Lock' AND datname = current_database()`,
          );
          return (result.rows[0] as { waiting: number }).waiting;
        })
        .toBeGreaterThan(0);
      releaseFirst();

      const [firstResult, secondResult] = await Promise.allSettled([
        firstTx,
        secondTx,
      ]);

      expect(firstResult).toMatchObject({
        status: 'fulfilled',
        value: { id: agent.id, ...firstKey },
      });
      expect(secondResult.status).toBe('rejected');
      expect((secondResult as PromiseRejectedResult).reason).toBeInstanceOf(
        AgentIdentityKeyStaleError,
      );
      expect(await agents.findById(agent.id)).toMatchObject(firstKey);
      const rows = await history.listForAgent(agent.id);
      expect(rows.map((row) => row.fingerprint)).toEqual([
        oldKey.fingerprint,
        firstKey.fingerprint,
      ]);
      expect(rows.filter((row) => row.validUntil === null)).toHaveLength(1);
    } finally {
      releaseFirst();
      await Promise.all([first.pool.end(), second.pool.end()]);
    }
  });

  it('never reuses a fingerprint, current or retired', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const retired = nextKey();
    const { agent } = await agents.upsertByFingerprint(retired);
    const current = nextKey();
    await agents.rotateIdentityKey({
      agentId: agent.id,
      currentPublicKey: retired.publicKey,
      ...current,
    });
    const other = (await agents.upsertByFingerprint(nextKey())).agent;

    // Each rotation is one UPDATE; the trigger's insert shares its statement,
    // so a conflicting history row aborts the key change too.
    // Rotating back to a retired key.
    await expect(
      agents.rotateIdentityKey({
        agentId: agent.id,
        currentPublicKey: current.publicKey,
        ...retired,
      }),
    ).rejects.toBeInstanceOf(AgentFingerprintConflictError);
    // Another agent rotating onto a retired key.
    await expect(
      agents.rotateIdentityKey({
        agentId: other.id,
        currentPublicKey: other.publicKey,
        ...retired,
      }),
    ).rejects.toBeInstanceOf(AgentFingerprintConflictError);
    // A new registration claiming a retired key.
    await expect(agents.upsertByFingerprint(retired)).rejects.toBeInstanceOf(
      AgentFingerprintConflictError,
    );

    expect((await agents.findById(agent.id))?.publicKey).toBe(
      current.publicKey,
    );
    expect(await history.listForAgent(agent.id)).toHaveLength(2);
    expect(await history.listForAgent(other.id)).toHaveLength(1);
  });

  it('does not touch history when a non-key column changes', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const { agent } = await agents.upsertByFingerprint(nextKey());

    await agents.updateAlias(agent.id, 'renamed');

    expect(await history.listForAgent(agent.id)).toHaveLength(1);
  });

  it('deletes history with the agent', async () => {
    const agents = createAgentRepository(db);
    const history = createAgentIdentityKeyRepository(db);
    const key = nextKey();
    const { agent } = await agents.upsertByFingerprint(key);

    await agents.deleteById(agent.id);

    expect(await history.findByFingerprint(key.fingerprint)).toBeNull();
  });
});
