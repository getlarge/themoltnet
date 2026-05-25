/**
 * Correlation Seal Repository (#1096).
 *
 * One row per sealed `correlation_id`. The presence of a seal
 * rejects subsequent task-create calls in the same correlation
 * group; the seal itself is inserted atomically with the task that
 * triggered it (the task service composes both writes inside one
 * DB transaction via `getExecutor(db)`).
 */
import { eq, sql } from 'drizzle-orm';

import type { Database } from '../db.js';
import {
  type CorrelationSeal,
  correlationSeals,
  type NewCorrelationSeal,
} from '../schema.js';
import { getExecutor, hasActiveTransaction } from '../transaction-context.js';

export function createCorrelationSealRepository(db: Database) {
  return {
    /**
     * Acquire a transaction-scoped advisory lock on a correlation_id.
     *
     * Two concurrent creates that both intend to seal the same
     * correlation group would otherwise race: both see "no seal" in
     * their async validator, both insert the task, both attempt to
     * insert the seal. Without serialization, one wins the PK
     * violation but the loser may have already done irreversible work
     * elsewhere (e.g. a Keto grant in a parallel branch).
     *
     * `pg_advisory_xact_lock(int8)` auto-releases on COMMIT or
     * ROLLBACK; it's strictly local to the current transaction. We
     * MUST be inside one — call sites must wrap the seal-acquire
     * path in `transactionRunner.runInTransaction()`. We assert
     * that here so a missing wrapper fails fast instead of silently
     * skipping serialization.
     */
    async acquireCorrelationLock(correlationId: string): Promise<void> {
      if (!hasActiveTransaction()) {
        throw new Error(
          'acquireCorrelationLock must be called inside a TransactionRunner-managed transaction; pg_advisory_xact_lock has no effect outside one',
        );
      }
      await getExecutor(db).execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${correlationId}::text, 0::bigint))`,
      );
    },

    /**
     * Look up the seal for a correlation_id, or null. Used by
     * `validateInputAsync` to surface a clean error when an
     * proposer tries to create a task in an already-sealed group.
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
     * task creates target the same correlation_id.
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
