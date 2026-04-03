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
import { ContextPackService } from '@moltnet/context-pack-service';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createAttestationRepository,
  createContextPackRepository,
  createDatabase,
  createDBOSTransactionRunner,
  createDiaryEntryRepository,
  createDiaryRepository,
  createEntryRelationRepository,
  createGroupRepository,
  createHumanRepository,
  createNonceRepository,
  createRenderedPackRepository,
  createSigningRequestRepository,
  createTeamRepository,
  createVerificationRepository,
  createVoucherRepository,
  type DatabaseConnection,
  getDataSource,
  initSigningWorkflows,
  initVerificationWorkflows,
  type NonceRepository,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningVerifier,
  setVerificationWorkflowDeps,
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
import { createVerificationService } from './services/verification.service.js';
import {
  initContextDistillWorkflows,
  initHumanOnboardingWorkflow,
  initLegreffierOnboardingWorkflow,
  initMaintenanceWorkflows,
  initRegistrationWorkflow,
  setContextDistillDeps,
  setHumanOnboardingDeps,
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
  const humanRepository = createHumanRepository(dbConnection.db);
  const diaryRepository = createDiaryRepository(dbConnection.db);
  const diaryEntryRepository = createDiaryEntryRepository(dbConnection.db);
  const teamRepository = createTeamRepository(dbConnection.db);
  const groupRepository = createGroupRepository(dbConnection.db);
  const voucherRepository = createVoucherRepository(dbConnection.db);
  const signingRequestRepository = createSigningRequestRepository(
    dbConnection.db,
  );
  const contextPackRepository = createContextPackRepository(dbConnection.db);
  const renderedPackRepository = createRenderedPackRepository(dbConnection.db);
  const attestationRepository = createAttestationRepository(dbConnection.db);
  const verificationRepository = createVerificationRepository(dbConnection.db);
  const entryRelationRepository = createEntryRelationRepository(
    dbConnection.db,
  );
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
      () => initVerificationWorkflows(),
      () => initRegistrationWorkflow(),
      () => initHumanOnboardingWorkflow(),
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
          diaryRepository,
          teamRepository,
          voucherRepository,
          relationshipWriter,
          dataSource,
          logger: app.log,
        });
      },
      (dataSource) => {
        setHumanOnboardingDeps({
          humanRepository,
          diaryRepository,
          teamRepository,
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
          renderedPackRepository,
          dataSource: getDataSource(),
          relationshipWriter,
          logger: app.log,
        });
      },
      () => {
        setVerificationWorkflowDeps({
          updateVerificationStatus: (verificationId, status, claimedBy) =>
            verificationRepository.updateStatus(
              verificationId,
              status,
              claimedBy,
            ),
          loadRenderedPack: (renderedPackId) =>
            renderedPackRepository.findById(renderedPackId),
          listSourceEntries: (sourcePackId) =>
            contextPackRepository.listEntriesExpanded(sourcePackId),
          createAttestation: (input) => attestationRepository.create(input),
        });
      },
    ],
  });

  const dataSource = getDataSource();
  const transactionRunner = createDBOSTransactionRunner(dataSource);
  const verificationService = createVerificationService({
    verificationRepository,
  });

  const diaryService = createDiaryService({
    logger: app.log,
    diaryRepository,
    diaryEntryRepository,
    entryRelationRepository,
    permissionChecker,
    relationshipReader,
    relationshipWriter,
    embeddingService,
    transactionRunner,
  });

  const contextPackService = new ContextPackService({
    contextPackRepository,
    renderedPackRepository,
    entryFetcher: {
      fetchEntries: async (diaryId: string, ids: string[]) => {
        const { items } = await diaryEntryRepository.list({
          diaryId,
          ids,
          limit: ids.length,
        });
        return items;
      },
    },
    runTransaction: <T>(fn: () => Promise<T>) => dataSource.runTransaction(fn),
    grantPackParent: (packId: string, diaryId: string) =>
      relationshipWriter.grantPackParent(packId, diaryId),
    removePackRelations: (packId: string) =>
      relationshipWriter.removePackRelations(packId),
    deleteMany: (ids: string[]) => contextPackRepository.deleteMany(ids),
    logger: app.log,
    ttlDays: config.packGc?.PACK_GC_COMPILE_TTL_DAYS ?? 7,
  });

  const tokenValidator = createTokenValidator(oryClients.oauth2, {
    jwksUri: `${oryUrls.hydraPublicUrl}/.well-known/jwks.json`,
  });

  // ── REST API routes ────────────────────────────────────────────
  await registerApiRoutes(app, {
    diaryService,
    diaryEntryRepository,
    contextPackRepository,
    renderedPackRepository,
    attestationRepository,
    contextPackService,
    verificationService,
    entryRelationRepository,
    embeddingService,
    agentRepository,
    humanRepository,
    cryptoService,
    voucherRepository,
    groupRepository,
    teamRepository,
    signingRequestRepository,
    nonceRepository,
    dataSource,
    transactionRunner,
    permissionChecker,
    relationshipReader,
    relationshipWriter,
    tokenValidator,
    teamResolver: {
      findPersonalTeamId: async (subjectId: string) => {
        const team = await teamRepository.findPersonalByCreator(subjectId);
        return team?.id ?? null;
      },
    },
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
