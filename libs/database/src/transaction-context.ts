/**
 * Transaction Context — AsyncLocalStorage-based transaction propagation
 *
 * Stores the active Drizzle transaction client in AsyncLocalStorage so
 * repositories can participate in transactions without explicit `tx?` params.
 *
 * Two TransactionRunner implementations:
 * - `createDBOSTransactionRunner` — wraps DBOS DrizzleDataSource (production)
 * - `createDrizzleTransactionRunner` — wraps plain Drizzle db.transaction (tests)
 *
 * Safe alongside DBOS's internal AsyncLocalStorage — separate instances,
 * same underlying Postgres tx client, no cross-reads.
 *
 * @see https://github.com/drizzle-team/drizzle-orm/issues/543
 * @see docs/plans/2026-02-08-transaction-propagation-design.md
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { Database } from './db.js';
import type { DataSource } from './dbos.js';

const txStorage = new AsyncLocalStorage<Database>();

/**
 * Get the active transaction executor.
 * Returns the ALS-stored tx client if inside a transaction,
 * otherwise returns the provided db fallback.
 */
export function getExecutor(db: Database): Database {
  return txStorage.getStore() ?? db;
}

export interface TransactionRunner {
  runInTransaction<T>(
    fn: () => Promise<T>,
    config?: { name?: string },
  ): Promise<T>;
}

/**
 * DBOS-backed TransactionRunner (production).
 * Delegates to `dataSource.runTransaction` and stores the DBOS tx client
 * in our AsyncLocalStorage so repositories pick it up via `getExecutor`.
 */
export function createDBOSTransactionRunner(
  dataSource: DataSource,
): TransactionRunner {
  return {
    async runInTransaction<T>(
      fn: () => Promise<T>,
      config?: { name?: string },
    ) {
      return dataSource.runTransaction(
        () => txStorage.run(dataSource.client as unknown as Database, fn),
        config,
      );
    },
  };
}

/**
 * Plain Drizzle TransactionRunner (unit/integration tests).
 * Uses `db.transaction()` directly and stores the tx in AsyncLocalStorage.
 */
export function createDrizzleTransactionRunner(
  db: Database,
): TransactionRunner {
  return {
    async runInTransaction<T>(fn: () => Promise<T>) {
      return db.transaction((tx) =>
        txStorage.run(tx as unknown as Database, fn),
      );
    },
  };
}
