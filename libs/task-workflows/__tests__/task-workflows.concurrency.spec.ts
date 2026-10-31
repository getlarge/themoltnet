import { randomUUID } from 'node:crypto';

import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  agents,
  createDatabase,
  createDrizzleTransactionRunner,
  createRuntimeStoreRepository,
  createTaskRepository,
  type DatabaseConnection,
  executorManifests,
  getExecutor,
  runMigrations,
  runtimePolicySnapshots,
  taskAttempts,
  tasks,
  teams,
} from '@moltnet/database';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  _resetTaskWorkflowsForTesting,
  initTaskWorkflows,
  setTaskWorkflowDeps,
  taskWorkflows,
} from '../src/task-workflows.js';

// Exercise the actual workflow transaction callbacks against PostgreSQL;
// only the durable scheduler is replaced so the interleaving is controlled.
vi.mock('@dbos-inc/dbos-sdk', () => ({
  DBOS: {
    registerStep: (fn: unknown) => fn,
    registerWorkflow: (fn: unknown) => fn,
    now: async () => Date.now(),
    setEvent: vi.fn(),
    recv: vi.fn(),
  },
}));

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('Workflow and Durable lock ordering (PostgreSQL)', () => {
  let connection: DatabaseConnection;
  let stop: () => Promise<void>;
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
    connection = createDatabase(container.getConnectionUri());
    const { db } = connection;
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
    _resetTaskWorkflowsForTesting();
    await connection?.pool.end();
    await stop?.();
  });

  it('lets markRunning and Durable authorization finish when they overlap behind an attempt lock', async () => {
    const { db, pool } = connection;
    const runner = createDrizzleTransactionRunner(db);
    const taskRepo = createTaskRepository(db);
    const stores = createRuntimeStoreRepository(db);
    const workflowPid = deferred<number>();
    const durablePid = deferred<number>();
    const finish = deferred<void>();
    _resetTaskWorkflowsForTesting();
    setTaskWorkflowDeps({
      transactionRunner: {
        runInTransaction: (fn, config) =>
          runner.runInTransaction(async () => {
            await getExecutor(db).execute(
              sql`SET LOCAL statement_timeout = '5s'`,
            );
            if (config?.name === 'task.tx.markRunning') {
              const result = await getExecutor(db).execute(
                sql`SELECT pg_backend_pid() AS pid`,
              );
              workflowPid.resolve(Number(result.rows[0].pid));
            }
            return fn();
          }),
      },
      updateAttempt: (...args) => taskRepo.updateAttempt(...args),
      updateTaskStatus: (...args) => taskRepo.updateStatus(...args),
      updateTaskStatusIfNotIn: (...args) =>
        taskRepo.updateStatusIfNotIn(...args),
      findTaskById: (...args) => taskRepo.findById(...args),
      countAttempts: async () => 1,
      getMaxAttempts: async () => 1,
      removeClaimantTuple: async () => {},
      recomputeAttemptActivityStats: async () => {},
    });
    initTaskWorkflows();
    vi.spyOn(DBOS, 'recv')
      .mockReset()
      .mockResolvedValueOnce({ kind: 'started' })
      .mockImplementationOnce(async () => {
        await finish.promise;
        return { kind: 'completed' };
      });
    // Hold the attempt row to put both callers at the dangerous boundary.
    // Wait on PostgreSQL's actual blocking graph, never a timing-only sleep.
    const blocker = await pool.connect();
    await blocker.query('BEGIN');
    await blocker.query(
      'SELECT 1 FROM task_attempts WHERE task_id = $1 FOR NO KEY UPDATE',
      [taskId],
    );
    let workflow: Promise<unknown> | undefined;
    let durable: Promise<unknown> | undefined;
    const waitBlocked = async (pid: number) => {
      await vi.waitFor(
        async () => {
          const result = await pool.query<{ blockers: number }>(
            'SELECT cardinality(pg_blocking_pids($1)) AS blockers',
            [pid],
          );
          expect(result.rows[0].blockers).toBeGreaterThan(0);
        },
        { timeout: 3_000, interval: 10 },
      );
    };
    try {
      workflow = taskWorkflows.startAttemptWorkflow(
        taskId,
        1,
        agentId,
        `test:${taskId}`,
        300,
        null,
        null,
        3600,
      );
      // Attach handlers immediately so a regression cannot become an unhandled rejection.
      void workflow.catch(() => {});
      await waitBlocked(await workflowPid.promise);
      durable = runner.runInTransaction(async () => {
        await getExecutor(db).execute(sql`SET LOCAL statement_timeout = '5s'`);
        const result = await getExecutor(db).execute(
          sql`SELECT pg_backend_pid() AS pid`,
        );
        durablePid.resolve(Number(result.rows[0].pid));
        return stores.lockAuthority(authority);
      });
      void durable.catch(() => {});
      await waitBlocked(await durablePid.promise);
      await blocker.query('COMMIT');
      await expect(durable).resolves.toMatchObject({
        task: { id: taskId },
        attempt: { status: 'running' },
      });
      finish.resolve(undefined);
      await expect(workflow).resolves.toMatchObject({ status: 'completed' });
    } finally {
      await blocker.query('ROLLBACK');
      blocker.release();
      finish.resolve(undefined);
      await Promise.allSettled([workflow, durable]);
    }
  }, 15_000);
});
