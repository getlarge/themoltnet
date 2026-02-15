/**
 * @moltnet/rest-api — Server Bootstrap
 *
 * Initializes all services (database, Ory, diary, crypto, auth, observability)
 * and registers the REST API routes on a Fastify instance.
 *
 * DBOS lifecycle is handled by the DBOS plugin.
 * The plugin requires cryptoService, agentRepository, voucherRepository,
 * signingRequestRepository, and permissionChecker to be decorated before
 * it registers. It also takes identityApi and oauth2Api for the
 * registration workflow.
 */

import {
  createOryClients,
  createPermissionChecker,
  createTokenValidator,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createDatabase,
  createDBOSTransactionRunner,
  createDiaryRepository,
  createNonceRepository,
  createSigningRequestRepository,
  createVoucherRepository,
  type DatabaseConnection,
  getDataSource,
} from '@moltnet/database';
import { createDiaryService } from '@moltnet/diary-service';
import { createEmbeddingService } from '@moltnet/embedding-service';
import {
  initObservability,
  type ObservabilityContext,
  observabilityPlugin,
} from '@moltnet/observability';
import Fastify, { type FastifyInstance } from 'fastify';

import { registerApiRoutes } from './app.js';
import type { AppConfig } from './config.js';
import { resolveOryUrls } from './config.js';
import dbosPlugin from './plugins/dbos.js';

export interface BootstrapResult {
  app: FastifyInstance;
  dbConnection: DatabaseConnection;
  observability: ObservabilityContext | null;
}

export async function bootstrap(config: AppConfig): Promise<BootstrapResult> {
  // ── Observability ──────────────────────────────────────────────
  let observability: ObservabilityContext | null = null;

  if (config.observability.AXIOM_API_TOKEN) {
    observability = initObservability({
      serviceName: 'moltnet-server',
      serviceVersion: '0.1.0',
      environment: config.server.NODE_ENV,
      otlp: {
        endpoint: 'https://api.axiom.co',
        headers: {
          Authorization: `Bearer ${config.observability.AXIOM_API_TOKEN}`,
          'X-Axiom-Dataset':
            config.observability.AXIOM_TRACES_DATASET ?? 'moltnet-traces',
        },
      },
      logger: {
        level: config.server.NODE_ENV === 'production' ? 'info' : 'debug',
        pretty: config.server.NODE_ENV !== 'production',
      },
      tracing: {
        enabled: true,
        ignorePaths: '/health',
      },
      metrics: {
        enabled: true,
      },
    });
  }

  // ── Fastify ────────────────────────────────────────────────────
  const loggerConfig = {
    level: config.server.NODE_ENV === 'production' ? 'info' : 'debug',
    ...(config.server.NODE_ENV !== 'production'
      ? { transport: { target: 'pino-pretty' } }
      : {}),
  };

  const ajv = { customOptions: { removeAdditional: true as const } };
  const app = (
    observability?.logger
      ? Fastify({ loggerInstance: observability.logger, ajv })
      : Fastify({ logger: loggerConfig, ajv })
  ) as FastifyInstance;

  // Register @fastify/otel BEFORE routes for full lifecycle tracing
  if (observability?.fastifyOtelPlugin) {
    await app.register(observability.fastifyOtelPlugin);
  }

  // ── Database ───────────────────────────────────────────────────
  if (!config.database.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }

  const dbConnection = createDatabase(config.database.DATABASE_URL);

  // ── Ory clients ────────────────────────────────────────────────
  const oryUrls = resolveOryUrls(config.ory);
  const oryClients = createOryClients({
    baseUrl: oryUrls.hydraAdminUrl,
    apiKey: oryUrls.apiKey,
    kratosPublicUrl: oryUrls.kratosPublicUrl,
    kratosAdminUrl: oryUrls.kratosAdminUrl,
    hydraAdminUrl: oryUrls.hydraAdminUrl,
    ketoReadUrl: oryUrls.ketoPublicUrl,
    ketoWriteUrl: oryUrls.ketoAdminUrl,
  });

  // ── Repositories ───────────────────────────────────────────────
  const agentRepository = createAgentRepository(dbConnection.db);
  const diaryRepository = createDiaryRepository(dbConnection.db);
  const voucherRepository = createVoucherRepository(dbConnection.db);
  const signingRequestRepository = createSigningRequestRepository(
    dbConnection.db,
  );
  const nonceRepository = createNonceRepository(dbConnection.db);

  // ── Services ───────────────────────────────────────────────────
  const permissionChecker = createPermissionChecker(
    oryClients.permission,
    oryClients.relationship,
  );

  // ── Pre-decorate services required by DBOS plugin ──────────────
  app.decorate('cryptoService', cryptoService);
  app.decorate('agentRepository', agentRepository);
  app.decorate('voucherRepository', voucherRepository);
  app.decorate('signingRequestRepository', signingRequestRepository);
  app.decorate('permissionChecker', permissionChecker);

  // ── DBOS Plugin (handles full lifecycle) ───────────────────────
  await app.register(dbosPlugin, {
    databaseUrl: config.database.DATABASE_URL,
    systemDatabaseUrl: config.database.DBOS_SYSTEM_DATABASE_URL,
    enableOTLP: !!observability,
    identityApi: oryClients.identity,
    oauth2Api: oryClients.oauth2,
  });

  const dataSource = getDataSource();
  const transactionRunner = createDBOSTransactionRunner(dataSource);

  const embeddingService = createEmbeddingService({
    logger: app.log,
  });

  const diaryService = createDiaryService({
    diaryRepository,
    permissionChecker,
    embeddingService,
    transactionRunner,
  });

  const tokenValidator = createTokenValidator(oryClients.oauth2, {
    jwksUri: `${oryUrls.hydraPublicUrl}/.well-known/jwks.json`,
  });

  // ── REST API routes ────────────────────────────────────────────
  await registerApiRoutes(app, {
    diaryService,
    diaryRepository,
    agentRepository,
    cryptoService,
    voucherRepository,
    signingRequestRepository,
    nonceRepository,
    dataSource,
    transactionRunner,
    permissionChecker,
    tokenValidator,
    webhookApiKey: config.webhook.ORY_ACTION_API_KEY,
    recoverySecret: config.recovery.RECOVERY_CHALLENGE_SECRET,
    oryClients,
    security: {
      corsOrigins: config.security.CORS_ORIGINS,
      rateLimitGlobalAuth: config.security.RATE_LIMIT_GLOBAL_AUTH,
      rateLimitGlobalAnon: config.security.RATE_LIMIT_GLOBAL_ANON,
      rateLimitEmbedding: config.security.RATE_LIMIT_EMBEDDING,
      rateLimitVouch: config.security.RATE_LIMIT_VOUCH,
      rateLimitSigning: config.security.RATE_LIMIT_SIGNING,
      rateLimitRecovery: config.security.RATE_LIMIT_RECOVERY,
      rateLimitPublicVerify: config.security.RATE_LIMIT_PUBLIC_VERIFY,
    },
  });

  // ── Observability metrics plugin ───────────────────────────────
  if (observability) {
    await app.register(observabilityPlugin, {
      serviceName: 'moltnet-server',
      shutdown: observability.shutdown,
    });
  }

  return { app, dbConnection, observability };
}
