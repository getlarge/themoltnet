import { randomUUID } from 'node:crypto';

import { DBOSClient } from '@dbos-inc/dbos-sdk';
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type DatabaseConnection } from '../src/db.js';
import {
  configureDBOS,
  initDBOS,
  launchDBOS,
  shutdownDBOS,
} from '../src/dbos.js';
import {
  createDiaryEmbeddingQueue,
  DiaryEmbeddingQueueFullError,
} from '../src/diary-embedding-queue.js';
import {
  createDrizzleTransactionRunner,
  getExecutor,
} from '../src/transaction-context.js';

describe('Diary embedding admission (real Postgres)', () => {
  let connection: DatabaseConnection;
  let client: DBOSClient;
  let stop: () => Promise<unknown>;
  const ids: string[] = [];

  beforeAll(async () => {
    const container = await new PostgreSqlContainer(
      'postgres:16-alpine',
    ).start();
    stop = () => container.stop();
    const url = container.getConnectionUri();
    connection = createDatabase(url);
    configureDBOS(url, false, 'error');
    await initDBOS({ databaseUrl: url, systemDatabaseUrl: url });
    await launchDBOS();
    // No diary queue is registered: tests can inspect persisted admission
    // without a consumer racing to complete the deliberately synthetic jobs.
    client = await DBOSClient.create({ systemDatabaseUrl: url });
    await connection.db.execute(
      sql`CREATE TABLE admission_proof (id text PRIMARY KEY)`,
    );
  });
  afterEach(async () => {
    await client.cancelWorkflows(ids.splice(0));
    await connection.db.execute(sql`DELETE FROM admission_proof`);
  });
  afterAll(async () => {
    await client?.destroy();
    await shutdownDBOS();
    await connection?.pool.end();
    await stop?.();
  });

  function input() {
    const workflowId = `diary-embedding:${randomUUID()}:0`;
    ids.push(workflowId);
    return {
      workflowId,
      workflowName: 'diary.embed',
      queueName: 'diary-embeddings',
    };
  }
  function mutate(maxPending: number, job = input()) {
    const queue = createDiaryEmbeddingQueue(connection.db, maxPending);
    return createDrizzleTransactionRunner(connection.db).runInTransaction(
      async () => {
        await getExecutor(connection.db).execute(
          sql`INSERT INTO admission_proof VALUES (${job.workflowId})`,
        );
        return queue.enqueue(job);
      },
    );
  }

  it('serializes competing writers and rolls back every rejected mutation', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 12 }, () => mutate(3)),
    );
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(3);
    const rejected = outcomes.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(9);
    for (const r of rejected) {
      if (r.status === 'rejected') {
        expect(r.reason).toBeInstanceOf(DiaryEmbeddingQueueFullError);
      }
    }
    expect(
      await createDiaryEmbeddingQueue(connection.db, 3).snapshot(),
    ).toMatchObject({
      pending: 3,
    });
    const rows = await connection.db.execute(
      sql`SELECT id FROM admission_proof`,
    );
    expect(rows.rows).toHaveLength(3);
  });

  it('releases admission after terminal work and preserves workflow-ID deduplication when full', async () => {
    const first = input();
    await mutate(1, first);
    const queue = createDiaryEmbeddingQueue(connection.db, 1);
    const runner = createDrizzleTransactionRunner(connection.db);
    await expect(
      runner.runInTransaction(() => queue.enqueue(first)),
    ).resolves.toEqual({
      workflowId: first.workflowId,
    });
    await expect(mutate(1)).rejects.toBeInstanceOf(
      DiaryEmbeddingQueueFullError,
    );
    await client.cancelWorkflows([first.workflowId]);
    await expect(mutate(1)).resolves.toBeDefined();
    expect((await queue.snapshot()).pending).toBe(1);
  });

  it('counts retry handoffs once and retains the initial job age', async () => {
    const first = input();
    await mutate(1, first);
    await new Promise((resolve) => {
      setTimeout(resolve, 1100);
    });
    const retryId = first.workflowId.replace(/:0$/, ':1');
    ids.push(retryId);
    await client.enqueue({
      workflowName: 'diary.embed',
      queueName: 'diary-embeddings',
      workflowID: retryId,
      delaySeconds: 3600,
    });
    const queue = createDiaryEmbeddingQueue(connection.db, 1);
    expect((await queue.snapshot()).pending).toBe(1);
    await client.cancelWorkflows([first.workflowId]);
    const snapshot = await queue.snapshot();
    expect(snapshot.pending).toBe(1);
    expect(snapshot.oldestAgeSeconds).toBeGreaterThanOrEqual(1);
    await expect(mutate(1)).rejects.toBeInstanceOf(
      DiaryEmbeddingQueueFullError,
    );
  });

  it('rolls back the queued job when the enclosing mutation fails', async () => {
    const queue = createDiaryEmbeddingQueue(connection.db, 1);
    await expect(
      createDrizzleTransactionRunner(connection.db).runInTransaction(
        async () => {
          await queue.enqueue(input());
          throw new Error('synthetic mutation failure');
        },
      ),
    ).rejects.toThrow('synthetic mutation failure');
    expect(await queue.snapshot()).toEqual({ pending: 0, oldestAgeSeconds: 0 });
  });

  it('rejects isolation settings that could reuse a stale admission snapshot', async () => {
    await expect(
      createDrizzleTransactionRunner(connection.db).runInTransaction(
        async () => {
          await getExecutor(connection.db).execute(
            sql`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ`,
          );
          return createDiaryEmbeddingQueue(connection.db, 1).enqueue(input());
        },
      ),
    ).rejects.toThrow('requires READ COMMITTED');
  });
});
