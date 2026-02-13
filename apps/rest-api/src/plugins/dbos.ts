/**
 * DBOS Fastify Plugin
 *
 * Initializes DBOS durable execution framework with all workflows:
 * Keto permissions, signing, and registration.
 *
 * Must be registered after the auth plugin (needs permissionChecker).
 *
 * ## Initialization Order
 *
 * 1. configureDBOS()              — set DBOS runtime config
 * 2. initKetoWorkflows()          — register Keto workflow definitions
 * 3. initSigningWorkflows()       — register signing workflow definitions
 * 4. initRegistrationWorkflow()   — register registration workflow
 * 5. Set workflow dependencies    — inject clients and services
 * 6. initDBOS()                   — create data source
 * 7. launchDBOS()                 — start runtime, recover pending workflows
 * 8. Set post-launch deps         — signing persistence, registration deps
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
import type { IdentityApi, OAuth2Api } from '@ory/client';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import {
  initRegistrationWorkflow,
  setRegistrationDeps,
} from '../workflows/index.js';

export interface DBOSPluginOptions {
  /** Application database URL — used by DrizzleDataSource for app tables */
  databaseUrl: string;
  /** DBOS system database URL — workflow state, step results (separate schema) */
  systemDatabaseUrl: string;
  /** Whether to enable OpenTelemetry (OTLP) for DBOS internal metrics/traces */
  enableOTLP?: boolean;
  signingTimeoutSeconds?: number;
  /** Kratos Admin API client — for registration workflow */
  identityApi: IdentityApi;
  /** Hydra Admin API client — for registration workflow */
  oauth2Api: OAuth2Api;
}

async function dbosPlugin(
  fastify: FastifyInstance,
  options: DBOSPluginOptions,
): Promise<void> {
  const { databaseUrl, systemDatabaseUrl, enableOTLP } = options;

  // Precondition checks: these decorations must exist before DBOS init
  const required = [
    'permissionChecker',
    'cryptoService',
    'agentRepository',
    'voucherRepository',
    'signingRequestRepository',
  ] as const;
  for (const dep of required) {
    if (!fastify[dep]) {
      throw new Error(
        `DBOS plugin requires '${dep}' to be decorated before registration`,
      );
    }
  }

  // 1. Configure DBOS (must be first, before workflow registration)
  configureDBOS(systemDatabaseUrl, enableOTLP);

  // 2. Register Keto workflows (must be after config, before launch)
  initKetoWorkflows();

  // 3. Register signing workflows
  initSigningWorkflows();

  // 4. Register registration workflow
  initRegistrationWorkflow();

  // 5. Set the relationship writer for Keto workflows
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

  // 6. Initialize DBOS data source (app tables via databaseUrl, system via systemDatabaseUrl)
  await initDBOS({ databaseUrl, systemDatabaseUrl });

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

  // 10. Set registration workflow dependencies (needs dataSource from launch)
  setRegistrationDeps({
    identityApi: options.identityApi,
    oauth2Api: options.oauth2Api,
    agentRepository: fastify.agentRepository,
    voucherRepository: fastify.voucherRepository,
    permissionChecker: fastify.permissionChecker,
    dataSource: getDataSource(),
  });

  // 11. Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Shutting down DBOS...');
    await shutdownDBOS();
  });

  fastify.log.info(
    'DBOS initialized with Keto, signing, and registration workflows',
  );
}

export default fp(dbosPlugin, {
  name: 'dbos',
});
