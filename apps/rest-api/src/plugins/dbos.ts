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
  getDataSource,
  initDBOS,
  initKetoWorkflows,
  initSigningWorkflows,
  launchDBOS,
  setKetoRelationshipWriter,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningTimeoutSeconds,
  setSigningVerifier,
  shutdownDBOS,
} from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface DBOSPluginOptions {
  databaseUrl: string;
  signingTimeoutSeconds?: number;
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

  // 3. Register signing workflows
  initSigningWorkflows();

  // 4. Set the relationship writer for Keto workflows
  setKetoRelationshipWriter(fastify.permissionChecker);

  // 5. Set signing workflow dependencies
  setSigningVerifier(fastify.cryptoService);
  setSigningKeyLookup({
    getPublicKey: async (agentId: string) => {
      const agent = await fastify.agentRepository.findByIdentityId(agentId);
      return agent?.publicKey ?? null;
    },
  });

  if (options.signingTimeoutSeconds) {
    setSigningTimeoutSeconds(options.signingTimeoutSeconds);
  }

  // 6. Initialize DBOS data source
  await initDBOS({ databaseUrl });

  // 7. Launch DBOS (starts runtime, recovers interrupted workflows)
  await launchDBOS();

  // 8. Decorate Fastify with the dataSource for route handlers
  fastify.decorate('dataSource', getDataSource());

  // 9. Set signing request persistence (needs dataSource, so after launch)
  setSigningRequestPersistence({
    updateStatus: async (id, updates) => {
      await fastify.signingRequestRepository.updateStatus(id, updates);
    },
  });

  // 10. Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down DBOS...');
    await shutdownDBOS();
  });

  fastify.log.info('DBOS initialized with Keto and signing workflows');
}

export default fp(dbosPlugin, {
  name: 'dbos',
});
