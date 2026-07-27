import { sql } from 'drizzle-orm';

import type { Database } from './db.js';
import { getExecutor, hasActiveTransaction } from './transaction-context.js';

/**
 * Acquire a blocking transaction-scoped advisory lock in a feature namespace.
 *
 * Namespacing keeps unrelated features out of the same hash input domain.
 * The active-transaction guard prevents a lock from being released
 * immediately on an implicit one-statement transaction.
 */
export async function acquireTransactionAdvisoryLock(
  db: Database,
  namespace: string,
  key: string,
  operation: string,
): Promise<void> {
  if (!hasActiveTransaction()) {
    throw new Error(
      `${operation} must be called inside a TransactionRunner-managed transaction; pg_advisory_xact_lock has no effect outside one`,
    );
  }
  const namespacedKey = `${namespace}:${key}`;
  await getExecutor(db).execute(
    sql`SELECT pg_advisory_xact_lock(hashtextextended(${namespacedKey}::text, 0::bigint))`,
  );
}
