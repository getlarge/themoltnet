/**
 * DBOS Fastify Plugin
 *
 * Initializes DBOS durable execution framework with Keto workflows.
 * Must be registered after the auth plugin (needs permissionChecker).
 */

import {
  type DataSource,
  getDataSource,
  initDBOS,
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

  // 1. Set the relationship writer for Keto workflows
  setKetoRelationshipWriter(fastify.permissionChecker);

  // 2. Initialize DBOS (creates DrizzleDataSource, sets config)
  await initDBOS({ databaseUrl });

  // 3. Launch DBOS (starts runtime, recovers interrupted workflows)
  await launchDBOS();

  // 4. Decorate Fastify with the dataSource for route handlers
  fastify.decorate('dataSource', getDataSource());

  // 5. Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down DBOS...');
    await shutdownDBOS();
  });

  fastify.log.info('DBOS initialized with Keto workflows');
}

export default fp(dbosPlugin, {
  name: 'dbos',
});
