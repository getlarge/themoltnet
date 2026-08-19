/**
 * DBOS Fastify Plugin
 *
 * Initializes DBOS durable execution framework.
 * Workflow registration is externalized via callback arrays:
 *
 * - `registerWorkflows` — called after configureDBOS(), before initDBOS()
 * - `wireDependencies` — called after datasource init, before recovery
 * - `registerQueues` — called after launch, as required by persisted queues
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()              — set DBOS runtime config
 * 2. registerWorkflows callbacks  — register workflow definitions + pre-launch deps
 * 3. initDBOS()                   — create data source
 * 4. wireDependencies callbacks   — make recovery dependencies available
 * 5. launchDBOS()                 — start runtime, recover pending workflows
 * 6. registerQueues callbacks     — persist queue configuration
 */

import {
  configureDBOS,
  createDBOSTransactionRunner,
  getDataSource,
  getDBOSRuntimeInventory,
  initDBOS,
  launchDBOS,
  shutdownDBOS,
  type TransactionRunner,
} from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface DBOSPluginOptions {
  /** Application database URL — used by DrizzleDataSource for app tables */
  databaseUrl: string;
  /** DBOS system database URL — workflow state, step results (separate schema) */
  systemDatabaseUrl: string;
  /** Whether to enable OpenTelemetry (OTLP) for DBOS internal metrics/traces */
  enableOTLP?: boolean;
  /**
   * Workflow init functions — called after configureDBOS(), before initDBOS().
   * Each function should call DBOS.registerWorkflow() and set pre-launch deps.
   */
  registerWorkflows?: Array<() => void>;
  /** Dependency wiring completed before launch/recovery begins. */
  wireDependencies?: Array<
    (transactionRunner: TransactionRunner) => void | Promise<void>
  >;
  /** Persist queue configuration after DBOS.launch(). */
  registerQueues?: Array<() => void | Promise<void>>;
}

async function dbosPlugin(
  fastify: FastifyInstance,
  options: DBOSPluginOptions,
): Promise<void> {
  const { databaseUrl, systemDatabaseUrl, enableOTLP } = options;

  // 1. Configure DBOS (must be first, before workflow registration)
  configureDBOS(systemDatabaseUrl, enableOTLP);

  // 2. Register all workflows (pre-launch)
  for (const register of options.registerWorkflows ?? []) {
    register();
  }

  // 3. Initialize DBOS data source
  await initDBOS({ databaseUrl, systemDatabaseUrl });

  // 4. Wire every dependency before recovery can execute workflow code.
  const dataSource = getDataSource();
  const transactionRunner = createDBOSTransactionRunner(dataSource);
  for (const setup of options.wireDependencies ?? []) {
    await setup(transactionRunner);
  }

  // 5. Launch DBOS (starts runtime, recovers interrupted workflows)
  await launchDBOS();

  // 6. Persist queue configuration only after launch.
  for (const register of options.registerQueues ?? []) {
    await register();
  }

  // 7. Decorate Fastify with the dataSource for route handlers
  fastify.decorate('dataSource', dataSource);

  // 8. Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down DBOS...');
    await shutdownDBOS();
  });

  const inventory = await getDBOSRuntimeInventory();
  fastify.log.info(inventory, 'DBOS initialized');
}

export default fp(dbosPlugin, {
  name: 'dbos',
});
