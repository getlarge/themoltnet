/**
 * DBOS Fastify Plugin
 *
 * Initializes DBOS durable execution framework.
 * Workflow registration is externalized via callback arrays:
 *
 * - `registerWorkflows` — called after configureDBOS(), before initDBOS()
 * - `afterLaunch` — called after launchDBOS(), receives the DBOS dataSource
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()              — set DBOS runtime config
 * 2. registerWorkflows callbacks  — register workflow definitions + pre-launch deps
 * 3. initDBOS()                   — create data source
 * 4. launchDBOS()                 — start runtime, recover pending workflows
 * 5. afterLaunch callbacks        — set post-launch deps (persistence, dataSource-dependent)
 */

import {
  configureDBOS,
  type DataSource,
  getDataSource,
  initDBOS,
  launchDBOS,
  shutdownDBOS,
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
  /**
   * Post-launch setup — called after launchDBOS().
   * Receives the DBOS dataSource for deps that need it.
   */
  afterLaunch?: Array<(dataSource: DataSource) => void>;
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

  // 4. Launch DBOS (starts runtime, recovers interrupted workflows)
  await launchDBOS();

  // 5. Decorate Fastify with the dataSource for route handlers
  const dataSource = getDataSource();
  fastify.decorate('dataSource', dataSource);

  // 6. Post-launch setup
  for (const setup of options.afterLaunch ?? []) {
    setup(dataSource);
  }

  // 7. Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down DBOS...');
    await shutdownDBOS();
  });

  fastify.log.info('DBOS initialized');
}

export default fp(dbosPlugin, {
  name: 'dbos',
});
