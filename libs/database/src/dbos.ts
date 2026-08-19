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
 * 4. Create `TransactionRunner` and wire every workflow dependency
 * 5. `launchDBOS()` — starts DBOS runtime, recovers pending workflows
 * 6. Register persisted queues
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
  /** DBOS system URL — same Postgres database, with workflow state in `dbos`. */
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
 * @param logLevel — DBOS internal logger level (defaults to DBOS's own 'info').
 *                   Pass 'error' from integration tests that intentionally
 *                   trigger retries to avoid swamping output.
 */
export function configureDBOS(
  systemDatabaseUrl: string,
  enableOTLP: boolean = false,
  logLevel?: string,
): void {
  if (configured) return; // Idempotent
  DBOS.setConfig({
    name: 'moltnet-api',
    systemDatabaseUrl,
    enableOTLP,
    // The REST API owns its public HTTP surface. Do not expose DBOS's
    // unauthenticated management server on a second port.
    runAdminServer: false,
    ...(logLevel !== undefined ? { logLevel } : {}),
  });
  configured = true;
}

/**
 * Initialize DBOS with DrizzleDataSource.
 *
 * Call this AFTER configureDBOS() and workflow registration.
 *
 * DBOS creates its own connection pool internally. Workflow-facing repository
 * code must use `createDBOSTransactionRunner(dataSource)` so repository ALS and
 * the DBOS transaction checkpoint share one transaction.
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
 * Get the DBOS DrizzleDataSource for lifecycle wiring and route decoration.
 * Workflow modules receive a repository-aware `TransactionRunner`, not this
 * raw datasource.
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

export interface DBOSRuntimeInventory {
  currentVersion: string;
  latestVersion: string;
  activeWorkflowsByVersion: Record<string, number>;
}

/** Read the version/recovery inventory used by startup logs and operations. */
export async function getDBOSRuntimeInventory(): Promise<DBOSRuntimeInventory> {
  if (!launched) {
    throw new Error('DBOS is not launched');
  }

  const activeWorkflowsByVersion: Record<string, number> = {};
  const pageSize = 1_000;
  for (let offset = 0; ; offset += pageSize) {
    const workflows = await DBOS.listWorkflows({
      status: ['PENDING', 'ENQUEUED', 'DELAYED'],
      limit: pageSize,
      offset,
    });
    for (const workflow of workflows) {
      const version = workflow.applicationVersion || 'unassigned';
      activeWorkflowsByVersion[version] =
        (activeWorkflowsByVersion[version] ?? 0) + 1;
    }
    if (workflows.length < pageSize) break;
  }

  const latest = await DBOS.getLatestApplicationVersion();
  return {
    currentVersion: DBOS.applicationVersion,
    latestVersion: latest.versionName,
    activeWorkflowsByVersion,
  };
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
export { DBOS, DBOSWorkflowConflictError } from '@dbos-inc/dbos-sdk';

// Re-export types used by workflow runners
export type { WorkflowHandle } from '@dbos-inc/dbos-sdk';

// Re-export workflow-relevant error classes.
// The SDK exports most errors only via `export * as Error from './error'` namespace.
// We expose the namespace so consumers can do `instanceof DBOSErrors.DBOSQueueDuplicatedError`.
export { Error as DBOSErrors } from '@dbos-inc/dbos-sdk';

// Re-export DrizzleDataSource type for consumers
export type { DrizzleDataSource } from '@dbos-inc/drizzle-datasource';

/** Type alias for the configured DBOS data source */
export type DataSource = DrizzleDataSource<DBOSDatabase>;
