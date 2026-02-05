/**
 * DBOS Fastify Plugin
 *
 * Initializes DBOS durable execution framework with Keto workflows.
 * Must be registered after the auth plugin (needs permissionChecker).
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()              — set DBOS runtime config
 * 2. initKetoWorkflows()          — register workflow definitions
 * 3. setKetoRelationshipWriter()  — inject Keto client
 * 4. initDBOS()                   — create data source (optionally with shared pool)
 * 5. launchDBOS()                 — start runtime, recover pending workflows
 */

import {
  configureDBOS,
  type DataSource,
  getDataSource,
  initDBOS,
  initKetoWorkflows,
  launchDBOS,
  setKetoRelationshipWriter,
  shutdownDBOS,
} from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface DBOSPluginOptions {
  databaseUrl: string;
}

declare module 'fastify' {
  interface FastifyInstance {
    dataSource: DataSource;
  }
}

async function dbosPlugin(
  fastify: FastifyInstance,
  options: DBOSPluginOptions,
): Promise<void> {
  const { databaseUrl } = options;

  // permissionChecker is decorated by authPlugin — it implements KetoRelationshipWriter
  if (!fastify.permissionChecker) {
    throw new Error(
      'DBOS plugin requires authPlugin to be registered first (needs permissionChecker)',
    );
  }

  // 1. Configure DBOS (must be first, before workflow registration)
  configureDBOS();

  // 2. Register Keto workflows (must be after config, before launch)
  initKetoWorkflows();

  // 3. Set the relationship writer for Keto workflows
  setKetoRelationshipWriter(fastify.permissionChecker);

  // 4. Initialize DBOS data source
  await initDBOS({ databaseUrl });

  // 5. Launch DBOS (starts runtime, recovers interrupted workflows)
  await launchDBOS();

  // 6. Decorate Fastify with the dataSource for route handlers
  fastify.decorate('dataSource', getDataSource());

  // 7. Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down DBOS...');
    await shutdownDBOS();
  });

  fastify.log.info('DBOS initialized with Keto workflows');
}

export default fp(dbosPlugin, {
  name: 'dbos',
});
