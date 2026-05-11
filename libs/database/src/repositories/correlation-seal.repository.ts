/**
 * Correlation Seal Repository (#1096).
 *
 * One row per sealed `correlation_id`. The presence of a seal
 * rejects subsequent task-create calls in the same correlation
 * group; the seal itself is inserted atomically with the task that
 * triggered it (the task service composes both writes inside one
 * DB transaction via `getExecutor(db)`).
 */
import { eq } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type CorrelationSeal,
  correlationSeals,
  type NewCorrelationSeal,
} from '../schema.js';
import { getExecutor } from '../transaction-context.js';

export function createCorrelationSealRepository(db: Database) {
  return {
    /**
     * Look up the seal for a correlation_id, or null. Used by
     * `validateInputAsync` to surface a clean error when an
     * imposer tries to create a task in an already-sealed group.
     */
    async findByCorrelationId(
      correlationId: string,
    ): Promise<CorrelationSeal | null> {
      const rows = await getExecutor(db)
        .select()
        .from(correlationSeals)
        .where(eq(correlationSeals.correlationId, correlationId))
        .limit(1);
      return rows[0] ?? null;
    },

    /**
     * Insert a seal row. Throws on conflict (PK violation) — the
     * caller is expected to have already checked via
     * `findByCorrelationId` inside the same transaction. The throw
     * is the last-line-of-defense for races where two concurrent
     * judge creates target the same correlation_id.
     */
    async create(input: NewCorrelationSeal): Promise<CorrelationSeal> {
      const [row] = await getExecutor(db)
        .insert(correlationSeals)
        .values(input)
        .returning();
      return row;
    },

    /**
     * Remove a seal by its sealing task id. Used by the task
     * service's create-rollback path: if a sealing task failed to
     * register ownership in Keto and got cancelled, its seal would
     * otherwise persist and lock the correlation group against
     * recovery. Idempotent (returns the deleted row or null).
     */
    async deleteBySealingTaskId(
      taskId: string,
    ): Promise<CorrelationSeal | null> {
      const [row] = await getExecutor(db)
        .delete(correlationSeals)
        .where(eq(correlationSeals.sealedByTaskId, taskId))
        .returning();
      return row ?? null;
    },
  };
}

export type CorrelationSealRepository = ReturnType<
  typeof createCorrelationSealRepository
>;
