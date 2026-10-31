import { randomUUID } from 'node:crypto';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq, sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createRuntimeStoreRepository } from '../src/repositories/runtime-store.repository.js';
import { createTaskRepository } from '../src/repositories/task.repository.js';
import {
  agents,
  executorManifests,
  runtimePolicySnapshots,
  runtimeStores,
  taskAttempts,
  tasks,
  teams,
} from '../src/schema.js';
import {
  createDrizzleTransactionRunner,
  getExecutor,
} from '../src/transaction-context.js';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('Runtime store authority and serialization (PostgreSQL)', () => {
  let db: Database;
  let pool: Pool;
  let stop: () => Promise<void>;
  let repo: ReturnType<typeof createRuntimeStoreRepository>;
  let runner: ReturnType<typeof createDrizzleTransactionRunner>;
  const teamId = randomUUID();
  const agentId = randomUUID();
  const taskId = randomUUID();
  const leaseId = randomUUID();
  const authority = {
    teamId,
    agentId,
    taskId,
    attemptN: 1,
    leaseId,
    executorFingerprint: 'bafy-test',
  };
  beforeAll(async () => {
    const container = await new PostgreSqlContainer(
      'pgvector/pgvector:pg16',
    ).start();
    stop = async () => {
      await container.stop();
    };
    await runMigrations(container.getConnectionUri());
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    repo = createRuntimeStoreRepository(db);
    runner = createDrizzleTransactionRunner(db);
    await db.insert(agents).values({
      id: agentId,
      identityId: randomUUID(),
      publicKey: 'ed25519:test',
      fingerprint: 'TEST-TEST-TEST-TEST',
    });
    await db.insert(teams).values({
      id: teamId,
      name: 'runtime-store-test',
      creatorAgentId: agentId,
    });
    await db.insert(tasks).values({
      id: taskId,
      teamId,
      taskType: 'freeform',
      outputKind: 'artifact',
      input: {},
      inputCid: 'cid-input',
      inputSchemaCid: 'cid-schema',
      proposedByAgentId: agentId,
      status: 'running',
      claimAgentId: agentId,
      claimExpiresAt: new Date(Date.now() + 300_000),
    });
    await db.insert(executorManifests).values({
      fingerprint: authority.executorFingerprint,
      schemaVersion: 'moltnet:executor-manifest:v1',
      manifest: {},
    });
    await db.insert(runtimePolicySnapshots).values({
      hash: `sha256:${'a'.repeat(64)}`,
      schemaVersion: 'effective-policy:v1',
      runtimeKind: 'gondolin_pi_durable',
      enforcement: 'enforce',
      allowedTools: ['read'],
      allowedShellCommands: [],
    });
    await db.insert(taskAttempts).values({
      taskId,
      attemptN: 1,
      claimedByAgentId: agentId,
      leaseId,
      runtimeProfileId: randomUUID(),
      runtimeProfileRevision: 1,
      policySnapshotHash: `sha256:${'a'.repeat(64)}`,
      workflowId: `test:${taskId}`,
      status: 'running',
      claimedExecutorFingerprint: authority.executorFingerprint,
    });
  }, 120_000);
  afterAll(async () => {
    await pool?.end();
    await stop?.();
  });
  it('rejects wrong authority and expired leases at the database clock', async () => {
    expect(
      await runner.runInTransaction(() => repo.lockAuthority(authority)),
    ).toBeTruthy();
    for (const patch of [
      { agentId: randomUUID() },
      { teamId: randomUUID() },
      { leaseId: randomUUID() },
      { executorFingerprint: 'other' },
    ]) {
      expect(
        await runner.runInTransaction(() =>
          repo.lockAuthority({ ...authority, ...patch }),
        ),
      ).toBeNull();
    }
    await db
      .update(tasks)
      .set({ claimExpiresAt: new Date(0) })
      .where(eq(tasks.id, taskId));
    expect(
      await runner.runInTransaction(() => repo.lockAuthority(authority)),
    ).toBeNull();
    await db
      .update(tasks)
      .set({ claimExpiresAt: new Date(Date.now() + 300_000) })
      .where(eq(tasks.id, taskId));
  });
  it('serializes concurrent ownership checks and allocates unique IDs', async () => {
    const store = await runner.runInTransaction(() => repo.create(teamId));
    expect(store.nextId).toBe(2);
    const ids = await Promise.all(
      Array.from({ length: 12 }, () =>
        runner.runInTransaction(async () => {
          await repo.lockAuthority(authority);
          const current = await repo.lock(teamId, store.id);
          await repo.update(store.id, { nextId: current!.nextId + 1 });
          return current!.nextId;
        }),
      ),
    );
    expect([...ids].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 12 }, (_, n) => n + 2),
    );
    expect(await repo.get(randomUUID(), store.id)).toBeNull();
  });
  it('allows reporter message foreign keys while Durable holds authority locks', async () => {
    const locked = deferred();
    const release = deferred();
    const writer = runner.runInTransaction(async () => {
      await repo.lockAuthority(authority);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    try {
      await runner.runInTransaction(async () => {
        await getExecutor(db).execute(sql`SET LOCAL lock_timeout = '1s'`);
        await createTaskRepository(db).appendMessages([
          {
            taskId,
            attemptN: 1,
            kind: 'info',
            timestamp: new Date(),
            payload: { event: 'prompt_assembled' },
          },
        ]);
      });
    } finally {
      release.resolve();
      await writer;
    }
  });
  it('rolls back head publication atomically', async () => {
    const store = await runner.runInTransaction(() => repo.create(teamId));
    await expect(
      runner.runInTransaction(async () => {
        await repo.append({
          storeId: store.id,
          seq: 1,
          commitId: randomUUID(),
          sha256: 'a'.repeat(64),
          objectKey: 'test',
          sizeBytes: 5,
          taskId,
          attemptN: 1,
        });
        await repo.saveConversationRecords(store.id, 1, [
          {
            type: 'entry',
            id: 1,
            conversationId: 1,
            address: null,
            value: { id: 1 },
          },
        ]);
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await repo.get(teamId, store.id))?.headSeq).toBe(0);
    expect(await repo.conversationHead(store.id)).toBe(0);
    expect(
      await repo.conversationRecord(store.id, 'entry', 1, 1),
    ).toBeUndefined();
    expect(await repo.listCommits(store.id, 0, 100, 100)).toEqual([]);
    await db.delete(runtimeStores).where(eq(runtimeStores.id, store.id));
  });
  it('installs a valid attempt history index outside the migration transaction', async () => {
    const result = await pool.query<{ indisvalid: boolean }>(`
      SELECT indisvalid FROM pg_index
      WHERE indexrelid = 'runtime_store_commits_attempt_seq_idx'::regclass
    `);
    expect(result.rows).toEqual([{ indisvalid: true }]);
  });
  it('persists eleven thousand small records from a sub-MiB commit', async () => {
    const store = await runner.runInTransaction(() => repo.create(teamId));
    const rows = Array.from({ length: 11000 }, (_, i) => ({
      type: 'entry',
      id: i + 2,
      conversationId: 1,
      address: null,
      value: { id: i + 2, conversationId: 1, kind: 'note' },
    }));
    const writes = rows.map(({ value }) => ({ type: 'entry', value }));
    expect(Buffer.byteLength(JSON.stringify(writes))).toBeLessThan(1024 * 1024);
    await runner.runInTransaction(() =>
      repo.saveConversationRecords(store.id, 1, rows),
    );
    const count = await pool.query<{ count: number }>(
      `
      SELECT count(*)::int AS count FROM runtime_conversation_records WHERE store_id = $1
    `,
      [store.id],
    );
    expect(count.rows[0].count).toBe(11000);
    expect(await repo.conversationHead(store.id)).toBe(1);
    expect(
      (await repo.conversationRecord(store.id, 'entry', 11001, 1))?.value,
    ).toEqual(rows[10999].value);
    await db.delete(runtimeStores).where(eq(runtimeStores.id, store.id));
  });
  it('rolls back earlier insert batches when a later batch fails', async () => {
    const store = await runner.runInTransaction(() => repo.create(teamId));
    const original = {
      type: 'entry',
      id: 1,
      conversationId: 1,
      address: null,
      value: { id: 1, conversationId: 1, kind: 'note' },
    };
    await runner.runInTransaction(() =>
      repo.saveConversationRecords(store.id, 1, [original]),
    );
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      ...original,
      id: i + 2,
      value: { ...original.value, id: i + 2 },
    }));
    // This duplicate is in batch two, after the first thousand inserts succeed.
    rows.push(rows[0]);
    await expect(
      runner.runInTransaction(async () => {
        await repo.append({
          storeId: store.id,
          seq: 1,
          commitId: randomUUID(),
          sha256: 'a'.repeat(64),
          objectKey: 'rollback-batches',
          sizeBytes: 5,
          taskId,
          attemptN: 1,
        });
        await repo.saveConversationRecords(store.id, 2, rows);
      }),
    ).rejects.toMatchObject({ cause: { code: '23505' } });
    expect(await repo.conversationHead(store.id)).toBe(1);
    expect((await repo.get(teamId, store.id))?.headSeq).toBe(0);
    expect(await repo.listCommits(store.id, 0, 100, 100)).toEqual([]);
    const remaining = await pool.query<{ id: string; seq: number }>(
      `
      SELECT id, seq FROM runtime_conversation_records WHERE store_id = $1
    `,
      [store.id],
    );
    expect(remaining.rows).toEqual([{ id: '1', seq: 1 }]);
    await db.delete(runtimeStores).where(eq(runtimeStores.id, store.id));
  });
  it('preserves opaque JSON escapes across document lookup and forks', async () => {
    const value = { text: 'nul\u0000high\ud800low\udfff', retired: false };
    const source = await runner.runInTransaction(async () => {
      const store = await repo.create(teamId);
      await repo.append({
        storeId: store.id,
        seq: 1,
        commitId: randomUUID(),
        sha256: 'a'.repeat(64),
        objectKey: 'opaque-json',
        sizeBytes: 5,
        taskId,
        attemptN: 1,
      });
      await repo.saveConversationRecords(store.id, 1, [
        { type: 'entry', id: 2, conversationId: 1, address: null, value },
        // Recreated address must prefer its live incarnation even when the
        // retired ID is larger. No SQL JSON extraction may decode the payload.
        { type: 'document', id: 4, conversationId: 1, address: 'live', value },
        {
          type: 'document',
          id: 5,
          conversationId: 1,
          address: 'live',
          value: { ...value, retired: true },
        },
      ]);
      return (await repo.lock(teamId, store.id))!;
    });
    const fork = await runner.runInTransaction(() => repo.fork(source));
    for (const storeId of [source.id, fork.id]) {
      expect(
        (await repo.conversationRecord(storeId, 'entry', 2, 1))?.value,
      ).toEqual(value);
      const document = await repo.conversationDocument(storeId, 'live', 1);
      expect(document?.id).toBe(4);
      expect(document?.value).toEqual(value);
      expect(
        (await repo.conversationEntries(storeId, 1, 1, 2, 10))[0]?.value,
      ).toEqual(value);
    }
    await db.delete(runtimeStores).where(eq(runtimeStores.id, fork.id));
    await db.delete(runtimeStores).where(eq(runtimeStores.id, source.id));
  });
  it('bounds historical page index scans before a long continuation', async () => {
    const store = await runner.runInTransaction(() => repo.create(teamId));
    await pool.query(
      `
      INSERT INTO runtime_conversation_records
        (store_id, type, id, seq, conversation_id, value)
      SELECT $1, 'entry', id, CASE WHEN id <= 100 THEN 1 ELSE 2 END,
        1, json_build_object('id', id)
      FROM generate_series(1, 10100) id
    `,
      [store.id],
    );
    await runner.runInTransaction(async () => {
      await repo.saveConversationRecords(store.id, 1, [
        {
          type: 'entry-boundary',
          id: 0,
          conversationId: null,
          address: null,
          value: { maxEntryId: 100 },
        },
      ]);
      await repo.saveConversationRecords(store.id, 2, [
        {
          type: 'entry-boundary',
          id: 0,
          conversationId: null,
          address: null,
          value: { maxEntryId: 10100 },
        },
      ]);
    });
    await pool.query('ANALYZE runtime_conversation_records');
    const boundary = await repo.conversationRecord(
      store.id,
      'entry-boundary',
      0,
      1,
    );
    const maxId = Number(boundary?.value.maxEntryId);
    expect(maxId).toBe(100);
    expect(
      (await repo.conversationEntries(store.id, 1, 1, maxId, 10)).map(
        (r) => r.id,
      ),
    ).toEqual([100, 99, 98, 97, 96, 95, 94, 93, 92, 91]);
    const explain = async (upper: number) => {
      const result = await pool.query(
        `
        EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT * FROM runtime_conversation_records
        WHERE store_id = $1 AND type = 'entry' AND conversation_id = 1
          AND seq <= 1 AND id <= $2 ORDER BY id DESC LIMIT 10
      `,
        [store.id, upper],
      );
      const plan = result.rows[0]['QUERY PLAN'][0].Plan as {
        'Shared Hit Blocks': number;
        'Shared Read Blocks': number;
      };
      return plan['Shared Hit Blocks'] + plan['Shared Read Blocks'];
    };
    // PostgreSQL may use either ID index: seq can be an index condition or
    // a heap filter. Buffer work captures both plans without wall-clock limits.
    const unboundedBlocks = await explain(Number.MAX_SAFE_INTEGER);
    const boundedBlocks = await explain(maxId);
    console.log({ unboundedBlocks, boundedBlocks });
    // Leave room for dead tuples from earlier cases sharing index pages.
    expect(boundedBlocks).toBeLessThan(unboundedBlocks / 2);
    await db.delete(runtimeStores).where(eq(runtimeStores.id, store.id));
  });
  it('forks commit history without sharing subsequent writes', async () => {
    const source = await runner.runInTransaction(async () => {
      const store = await repo.create(teamId);
      await repo.append({
        storeId: store.id,
        seq: 1,
        commitId: randomUUID(),
        sha256: 'a'.repeat(64),
        objectKey: 'original-commit',
        sizeBytes: 5,
        taskId,
        attemptN: 1,
      });
      await repo.saveConversationRecords(store.id, 1, [
        {
          type: 'entry',
          id: 10,
          conversationId: 1,
          address: null,
          value: { id: 10 },
        },
        {
          type: 'entry-boundary',
          id: 0,
          conversationId: null,
          address: null,
          value: { maxEntryId: 10 },
        },
      ]);
      await repo.update(store.id, { nextId: 12 });
      return repo.lock(teamId, store.id);
    });
    // A writer can advance the source after its head was captured for a fork.
    await runner.runInTransaction(async () => {
      await repo.append({
        storeId: source!.id,
        seq: 2,
        commitId: randomUUID(),
        sha256: 'c'.repeat(64),
        objectKey: 'later-source-commit',
        sizeBytes: 5,
        taskId,
        attemptN: 1,
      });
      await repo.saveConversationRecords(source!.id, 2, [
        {
          type: 'entry',
          id: 11,
          conversationId: 1,
          address: null,
          value: { id: 11 },
        },
        {
          type: 'entry-boundary',
          id: 0,
          conversationId: null,
          address: null,
          value: { maxEntryId: 11 },
        },
      ]);
    });
    const fork = await runner.runInTransaction(() => repo.fork(source!));
    expect(await repo.conversationHead(fork.id)).toBe(1);
    expect(
      (await repo.conversationRecord(fork.id, 'entry-boundary', 0, 100))?.value,
    ).toEqual({ maxEntryId: 10 });
    expect(
      await repo.conversationRecord(fork.id, 'entry', 10, 100),
    ).toBeDefined();
    expect(
      await repo.conversationRecord(fork.id, 'entry', 11, 100),
    ).toBeUndefined();
    expect(await repo.listCommits(fork.id, 0, 10, 100)).toHaveLength(1);
    expect(fork.id).not.toBe(source!.id);
    expect(fork.headSeq).toBe(1);
    expect(fork.nextId).toBe(12);
    expect(await repo.listCommits(fork.id, 0, 10, fork.headSeq)).toEqual([
      expect.objectContaining({ seq: 1, objectKey: 'original-commit' }),
    ]);
    expect(await repo.listCommitTaskIds(fork.id)).toEqual([taskId]);
    await runner.runInTransaction(() =>
      repo.append({
        storeId: fork.id,
        seq: 2,
        commitId: randomUUID(),
        sha256: 'b'.repeat(64),
        objectKey: 'fork-only-commit',
        sizeBytes: 6,
        taskId,
        attemptN: 1,
      }),
    );
    expect((await repo.get(teamId, source!.id))?.headSeq).toBe(2);
    expect(await repo.listCommits(source!.id, 0, 10, 2)).toHaveLength(2);
    await db.delete(runtimeStores).where(eq(runtimeStores.id, fork.id));
    await db.delete(runtimeStores).where(eq(runtimeStores.id, source!.id));
  });
});
