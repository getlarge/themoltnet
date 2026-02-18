/**
 * MoltNet DBOS Integration
 *
 * DBOS Transact provides durable workflow execution backed by Postgres.
 * This module initializes DBOS with DrizzleDataSource for atomic
 * DB + workflow persistence.
 *
 * ## Initialization Order (CRITICAL)
 *
 * DBOS requires a specific initialization order:
 * 1. `configureDBOS()` — sets DBOS config
 * 2. Call `init*Workflows()` functions — registers workflows via DBOS.registerWorkflow()
 * 3. `initDBOS()` — creates DrizzleDataSource with connection pool
 * 4. `launchDBOS()` — starts DBOS runtime, recovers pending workflows
 *
 * @see https://docs.dbos.dev/typescript/tutorials/transaction-tutorial
 */

import { DBOS } from '@dbos-inc/dbos-sdk';
import { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

import * as schema from './schema.js';

export type DBOSDatabase = NodePgDatabase<typeof schema>;

let dataSource: DrizzleDataSource<DBOSDatabase> | null = null;
let configured = false;
let launched = false;

export interface DBOSConfig {
  /** Application database URL — used by DrizzleDataSource for app tables */
  databaseUrl: string;
  /** DBOS system database URL — used for workflow state, step results, etc. */
  systemDatabaseUrl: string;
  maxConnections?: number;
}

/**
 * Configure DBOS runtime settings.
 *
 * MUST be called BEFORE registering any workflows.
 * Workflow registration via DBOS.registerWorkflow() requires config to be set.
 *
 * @param systemDatabaseUrl — Postgres URL for DBOS system tables (separate from app data)
 * @param enableOTLP — whether to enable OpenTelemetry (OTLP) for DBOS internal metrics/traces
 */
export function configureDBOS(
  systemDatabaseUrl: string,
  enableOTLP: boolean = false,
): void {
  if (configured) return; // Idempotent
  DBOS.setConfig({ name: 'moltnet-api', systemDatabaseUrl, enableOTLP });
  configured = true;
}

/**
 * Initialize DBOS with DrizzleDataSource.
 *
 * Call this AFTER configureDBOS() and workflow registration.
 *
 * Note: DBOS creates its own connection pool internally. When DBOS is active,
 * prefer using dataSource.client for database operations rather than creating
 * a separate pool via createDatabase().
 */
export async function initDBOS(config: DBOSConfig): Promise<void> {
  if (launched) {
    throw new Error('DBOS already launched. Call shutdownDBOS() first.');
  }

  if (!configured) {
    throw new Error(
      'DBOS not configured. Call configureDBOS() before registering workflows.',
    );
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
    throw new Error('DBOS not initialized. Call initDBOS() first.');
  }

  if (launched) {
    return; // Idempotent
  }

  await DBOS.launch();
  launched = true;
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
 * Check if DBOS is launched and ready for workflow execution.
 */
export function isDBOSReady(): boolean {
  return launched;
}

/**
 * Shutdown DBOS gracefully.
 *
 * Waits for in-flight workflows to complete before closing.
 */
export async function shutdownDBOS(): Promise<void> {
  if (launched) {
    await DBOS.shutdown();
    launched = false;
    dataSource = null;
  }
}

// Re-export DBOS for workflow/step registration
export { DBOS } from '@dbos-inc/dbos-sdk';

// Re-export DrizzleDataSource type for consumers
export type { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';

/** Type alias for the configured DBOS data source */
export type DataSource = DrizzleDataSource<DBOSDatabase>;
