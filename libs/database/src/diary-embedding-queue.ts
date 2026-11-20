import { sql } from 'drizzle-orm';

import { acquireTransactionAdvisoryLock } from './advisory-lock.js';
import type { Database } from './db.js';
import {
  enqueueWorkflowInCurrentTransaction,
  type TransactionalWorkflowEnqueueInput,
} from './dbos-transactional-enqueue.js';
import { getExecutor } from './transaction-context.js';

export class DiaryEmbeddingQueueFullError extends Error {
  constructor() {
    super('Diary embedding capacity is temporarily exhausted');
    this.name = 'DiaryEmbeddingQueueFullError';
  }
}

export interface DiaryEmbeddingBacklog {
  pending: number;
  oldestAgeSeconds: number;
}

/** Admission for ordinary diary mutations; privileged SDK enqueues bypass it. */
export function createDiaryEmbeddingQueue(db: Database, maxPending: number) {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) {
    throw new RangeError('Diary embedding backlog limit must be positive');
  }

  async function snapshot(workflowId?: string) {
    const result = await getExecutor(db).execute(sql`
      WITH active AS (
        SELECT CASE WHEN workflow_uuid LIKE 'diary-embedding:%'
          THEN regexp_replace(workflow_uuid, ':[0-9]+$', '')
          ELSE workflow_uuid END AS chain_id,
          min(created_at) AS created_at
        FROM dbos.workflow_status
        WHERE queue_name = 'diary-embeddings' AND name = 'diary.embed'
          AND status IN ('PENDING', 'ENQUEUED', 'DELAYED')
        GROUP BY chain_id
      )
      SELECT count(*)::integer AS pending,
        current_setting('transaction_isolation') AS isolation,
        coalesce(greatest(0, (extract(epoch FROM clock_timestamp()) * 1000
          - min(coalesce(initial.created_at, active.created_at))) / 1000), 0)
          AS oldest_age_seconds,
        EXISTS (SELECT 1 FROM dbos.workflow_status
          WHERE workflow_uuid = ${workflowId ?? null}) AS already_enqueued
      FROM active LEFT JOIN dbos.workflow_status initial
        ON initial.workflow_uuid = active.chain_id || ':0'
    `);
    const row = result.rows[0] as {
      pending: number;
      oldest_age_seconds: string | number;
      already_enqueued: boolean;
      isolation: string;
    };
    return {
      pending: Number(row.pending),
      oldestAgeSeconds: Number(row.oldest_age_seconds),
      alreadyEnqueued: row.already_enqueued,
      isolation: row.isolation,
    };
  }

  return {
    async snapshot(): Promise<DiaryEmbeddingBacklog> {
      const { pending, oldestAgeSeconds } = await snapshot();
      return { pending, oldestAgeSeconds };
    },
    async enqueue(input: TransactionalWorkflowEnqueueInput) {
      if (
        input.queueName !== 'diary-embeddings' ||
        input.workflowName !== 'diary.embed' ||
        !input.workflowId
      ) {
        throw new Error('Diary embedding admission requires a stable job ID');
      }
      // READ COMMITTED gives the count a fresh snapshot after the lock wait.
      // This lock and the enqueue join the entry transaction and survive until
      // commit/rollback. An unlocked COUNT-then-enqueue would race across APIs.
      await acquireTransactionAdvisoryLock(
        db,
        'diary-embedding-admission',
        'global',
        'Diary embedding admission',
      );
      const current = await snapshot(input.workflowId);
      if (current.isolation !== 'read committed') {
        throw new Error('Diary embedding admission requires READ COMMITTED');
      }
      if (current.pending >= maxPending && !current.alreadyEnqueued) {
        throw new DiaryEmbeddingQueueFullError();
      }
      return enqueueWorkflowInCurrentTransaction(db, input);
    },
  };
}
