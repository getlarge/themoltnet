/**
 * @moltnet/rest-api — Server Bootstrap
 *
 * Initializes all services (database, Ory, diary, crypto, auth, observability)
 * and registers the REST API routes on a Fastify instance.
 *
 * DBOS lifecycle is handled by the DBOS plugin.
 * Workflow registration and dependency wiring are passed as callbacks
 * via `registerWorkflows` (pre-launch) and `afterLaunch` (post-launch).
 */

import {
  createOryClients,
  createPermissionChecker,
  createRelationshipReader,
  createRelationshipWriter,
  createTokenValidator,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createContextPackRepository,
  createDatabase,
  createDBOSTransactionRunner,
  createDiaryEntryRepository,
  createDiaryRepository,
  createDiaryShareRepository,
  createEntryRelationRepository,
  createNonceRepository,
  createSigningRequestRepository,
  createVoucherRepository,
  type DatabaseConnection,
  getDataSource,
  initSigningWorkflows,
  type NonceRepository,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningVerifier,
} from '@moltnet/database';
import { createDiaryService } from '@moltnet/diary-service';
import {
  initDiaryWorkflows,
  setDiaryWorkflowDeps,
} from '@moltnet/diary-service/workflows';
import { createEmbeddingService } from '@moltnet/embedding-service';
import {
  initObservability,
  type ObservabilityContext,
  observabilityPlugin,
} from '@moltnet/observability';
import Fastify, { type FastifyInstance } from 'fastify';

import pkg from '../package.json' with { type: 'json' };
import { registerApiRoutes } from './app.js';
import type { AppConfig } from './config.js';
import { resolveOryUrls } from './config.js';
import dbosPlugin from './plugins/dbos.js';
import {
  initContextDistillWorkflows,
  initLegreffierOnboardingWorkflow,
  initMaintenanceWorkflows,
  initRegistrationWorkflow,
  setContextDistillDeps,
  setLegreffierOnboardingDeps,
  setMaintenanceDeps,
  setRegistrationDeps,
} from './workflows/index.js';

export interface BootstrapResult {
  app: FastifyInstance;
  dbConnection: DatabaseConnection;
  observability: ObservabilityContext | null;
  nonceRepository: NonceRepository;
}

export async function bootstrap(config: AppConfig): Promise<BootstrapResult> {
  // ── Observability ──────────────────────────────────────────────
  let observability: ObservabilityContext | null = null;

  const {
    AXIOM_API_TOKEN,
    OTLP_ENDPOINT,
    AXIOM_DATASET,
    AXIOM_METRICS_DATASET,
  } = config.observability;

  if (OTLP_ENDPOINT) {
    const traceAndLogHeaders: Record<string, string> = {
      ...(AXIOM_API_TOKEN
        ? { Authorization: `Bearer ${AXIOM_API_TOKEN}` }
        : {}),
      ...(AXIOM_DATASET ? { 'X-Axiom-Dataset': AXIOM_DATASET } : {}),
    };
    const metricsDataset = AXIOM_METRICS_DATASET ?? AXIOM_DATASET;
    const metricsHeaders: Record<string, string> = {
      ...(AXIOM_API_TOKEN
        ? { Authorization: `Bearer ${AXIOM_API_TOKEN}` }
        : {}),
      ...(metricsDataset ? { 'X-Axiom-Dataset': metricsDataset } : {}),
    };

    observability = initObservability({
      serviceName: 'moltnet-rest-api',
      serviceVersion: pkg.version,
      environment: config.server.NODE_ENV,
      otlp: {
        endpoint: OTLP_ENDPOINT,
        headers: traceAndLogHeaders,
        metricsHeaders,
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
        runtimeMetrics: true,
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
  const diaryEntryRepository = createDiaryEntryRepository(dbConnection.db);
  const voucherRepository = createVoucherRepository(dbConnection.db);
  const signingRequestRepository = createSigningRequestRepository(
    dbConnection.db,
  );
  const contextPackRepository = createContextPackRepository(dbConnection.db);
  const entryRelationRepository = createEntryRelationRepository(
    dbConnection.db,
  );
  const diaryShareRepository = createDiaryShareRepository(dbConnection.db);
  const nonceRepository = createNonceRepository(dbConnection.db);

  // ── Services ───────────────────────────────────────────────────
  const permissionChecker = createPermissionChecker(oryClients.permission);
  const relationshipReader = createRelationshipReader(
    oryClients.relationshipRead,
  );
  const relationshipWriter = createRelationshipWriter(oryClients.relationship);

  const embeddingService = createEmbeddingService({
    cacheDir: config.embedding.EMBEDDING_CACHE_DIR,
    allowRemoteModels: config.embedding.EMBEDDING_ALLOW_REMOTE_MODELS,
    logger: app.log,
  });

  // ── DBOS Plugin (handles full lifecycle) ───────────────────────
  await app.register(dbosPlugin, {
    databaseUrl: config.database.DATABASE_URL,
    systemDatabaseUrl: config.database.DBOS_SYSTEM_DATABASE_URL,
    enableOTLP: !!observability,
    registerWorkflows: [
      () => {
        initSigningWorkflows();
        setSigningVerifier(cryptoService);
        setSigningKeyLookup({
          getPublicKey: async (agentId: string) => {
            const agent = await agentRepository.findByIdentityId(agentId);
            return agent?.publicKey ?? null;
          },
        });
      },
      () => initRegistrationWorkflow(),
      () => initLegreffierOnboardingWorkflow(),
      () => initDiaryWorkflows(),
      () => initContextDistillWorkflows(),
      () => initMaintenanceWorkflows(config.packGc),
    ],
    afterLaunch: [
      () => {
        setSigningRequestPersistence({
          updateStatus: async (id, updates) => {
            await signingRequestRepository.updateStatus(id, updates);
          },
        });
      },
      (dataSource) => {
        setRegistrationDeps({
          identityApi: oryClients.identity,
          oauth2Api: oryClients.oauth2,
          agentRepository,
          voucherRepository,
          relationshipWriter,
          dataSource,
          logger: app.log,
        });
      },
      () => {
        setLegreffierOnboardingDeps({
          voucherRepository,
          identityApi: oryClients.identity,
          logger: app.log,
        });
      },
      (dataSource) => {
        setDiaryWorkflowDeps({
          diaryEntryRepository,
          relationshipWriter,
          embeddingService,
          dataSource,
        });
      },
      () => {
        setContextDistillDeps({
          diaryEntryRepository,
          contextPackRepository,
          entryRelationRepository,
          dataSource: getDataSource(),
          relationshipWriter,
          embeddingService,
          logger: app.log,
          compileTtlDays: config.packGc.PACK_GC_COMPILE_TTL_DAYS,
        });
      },
      () => {
        setMaintenanceDeps({
          nonceRepository,
          contextPackRepository,
          dataSource: getDataSource(),
          relationshipWriter,
          logger: app.log,
        });
      },
    ],
  });

  const dataSource = getDataSource();
  const transactionRunner = createDBOSTransactionRunner(dataSource);

  const diaryService = createDiaryService({
    logger: app.log,
    diaryRepository,
    diaryEntryRepository,
    entryRelationRepository,
    diaryShareRepository,
    agentRepository,
    permissionChecker,
    relationshipReader,
    relationshipWriter,
    embeddingService,
    transactionRunner,
  });

  const tokenValidator = createTokenValidator(oryClients.oauth2, {
    jwksUri: `${oryUrls.hydraPublicUrl}/.well-known/jwks.json`,
  });

  // ── REST API routes ────────────────────────────────────────────
  await registerApiRoutes(app, {
    diaryService,
    diaryEntryRepository,
    contextPackRepository,
    entryRelationRepository,
    embeddingService,
    agentRepository,
    cryptoService,
    voucherRepository,
    signingRequestRepository,
    nonceRepository,
    dataSource,
    transactionRunner,
    permissionChecker,
    relationshipWriter,
    tokenValidator,
    hydraPublicUrl: oryUrls.hydraPublicUrl,
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
      rateLimitPublicSearch: config.security.RATE_LIMIT_PUBLIC_SEARCH,
      rateLimitLegreffierStart: config.security.RATE_LIMIT_LEGREFFIER_START,
      rateLimitLegreffierStatus: config.security.RATE_LIMIT_LEGREFFIER_STATUS,
      rateLimitRegistration: config.security.RATE_LIMIT_REGISTRATION,
      apiBaseUrl: config.security.API_BASE_URL.replace(/\/$/, ''),
      sponsorAgentId: config.security.SPONSOR_AGENT_ID,
    },
    packGcConfig: config.packGc,
  });

  // ── Observability metrics plugin ───────────────────────────────
  if (observability) {
    await app.register(observabilityPlugin, {
      serviceName: 'moltnet-rest-api',
      shutdown: observability.shutdown,
    });
  }

  return { app, dbConnection, observability, nonceRepository };
}
