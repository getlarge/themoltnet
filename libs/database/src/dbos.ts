/**
 * MoltNet DBOS Integration
 *
 * DBOS Transact provides durable workflow execution backed by Postgres.
 * This module initializes DBOS with DrizzleDataSource for atomic
 * DB + workflow persistence.
 *
 * @see https://docs.dbos.dev/typescript/tutorials/transaction-tutorial
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema.js';

export type DBOSDatabase = NodePgDatabase<typeof schema>;

let dataSource: DrizzleDataSource<DBOSDatabase> | null = null;
let initialized = false;

export interface DBOSConfig {
  databaseUrl: string;
  maxConnections?: number;
}

/**
 * Initialize DBOS with DrizzleDataSource.
 *
 * Must be called before any workflow registration or execution.
 * Workflows should be registered before calling DBOS.launch().
 */
export async function initDBOS(config: DBOSConfig): Promise<void> {
  if (initialized) {
    throw new Error('DBOS already initialized. Call shutdownDBOS() first.');
  }

  const { databaseUrl, maxConnections = 10 } = config;

  dataSource = new DrizzleDataSource<DBOSDatabase>(
    'moltnet',
    {
      connectionString: databaseUrl,
      max: maxConnections,
    },
    schema,
  );

  DBOS.setConfig({ name: 'moltnet-api' });
}

/**
 * Launch DBOS after all workflows are registered.
 *
 * This starts the DBOS runtime, which:
 * - Initializes the datasource connection pool
 * - Creates the dbos schema if it doesn't exist
 * - Recovers any interrupted workflows from previous runs
 */
export async function launchDBOS(): Promise<void> {
  if (!dataSource) {
    throw new Error('DBOS not configured. Call initDBOS() first.');
  }

  await DBOS.launch();
  initialized = true;
}

/**
 * Get the DBOS DrizzleDataSource for running transactions.
 *
 * Use `dataSource.runTransaction()` for atomic DB + workflow operations.
 */
export function getDataSource(): DrizzleDataSource<DBOSDatabase> {
  if (!dataSource) {
    throw new Error('DBOS not initialized. Call initDBOS() first.');
  }
  return dataSource;
}

/**
 * Check if DBOS is initialized and ready.
 */
export function isDBOSReady(): boolean {
  return initialized;
}

/**
 * Shutdown DBOS gracefully.
 *
 * Waits for in-flight workflows to complete before closing.
 */
export async function shutdownDBOS(): Promise<void> {
  if (initialized) {
    await DBOS.shutdown();
    initialized = false;
    dataSource = null;
  }
}

// Re-export DBOS for workflow/step registration
export { DBOS } from '@dbos-inc/dbos-sdk';

// Re-export DrizzleDataSource type for consumers
export type { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';

/** Type alias for the configured DBOS data source */
export type DataSource = DrizzleDataSource<DBOSDatabase>;
