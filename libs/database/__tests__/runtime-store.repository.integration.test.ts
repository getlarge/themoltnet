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
    const locked = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
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
        throw new Error('rollback');
      }),
    ).rejects.toThrow('rollback');
    expect((await repo.get(teamId, store.id))?.headSeq).toBe(0);
    expect(await repo.listCommits(store.id, 0, 100, 100)).toEqual([]);
    await db.delete(runtimeStores).where(eq(runtimeStores.id, store.id));
  });
});
