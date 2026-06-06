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

import { resolve } from 'node:path';

import {
  createOryClients,
  createPermissionChecker,
  createRelationshipReader,
  createRelationshipWriter,
  createSessionResolver,
  createTokenValidator,
} from '@moltnet/auth';
import { ContextPackService } from '@moltnet/context-pack-service';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createContextPackRepository,
  createCorrelationSealRepository,
  createDatabase,
  createDBOSTransactionRunner,
  createDiaryEntryRepository,
  createDiaryRepository,
  createDiaryTransferRepository,
  createDrizzleTransactionRunner,
  createEntryRelationRepository,
  createGroupRepository,
  createHumanRepository,
  createNonceRepository,
  createRenderedPackRepository,
  createSigningRequestRepository,
  createTaskRepository,
  createTeamRepository,
  createVoucherRepository,
  type DatabaseConnection,
  getDatabase,
  getDataSource,
  initSigningWorkflows,
  initTaskWorkflows,
  type NonceRepository,
  setSigningKeyLookup,
  setSigningRequestPersistence,
  setSigningVerifier,
  setTaskWorkflowDeps,
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
import { initTaskTypeRegistry } from '@moltnet/tasks';
import Fastify, { type FastifyInstance } from 'fastify';

import pkg from '../package.json' with { type: 'json' };
import { registerApiRoutes } from './app.js';
import type { AppConfig } from './config.js';
import { resolveOryUrls } from './config.js';
import dbosPlugin from './plugins/dbos.js';
import { createAssertDiaryReadable } from './services/diary-readable.js';
import {
  createTaskService,
  type TaskService,
} from './services/task.service.js';
import {
  initDiaryTransferWorkflow,
  initHumanOnboardingWorkflow,
  initLegreffierOnboardingWorkflow,
  initMaintenanceWorkflows,
  initRegistrationWorkflow,
  initTeamFoundingWorkflow,
  setDiaryTransferDeps,
  setHumanOnboardingDeps,
  setLegreffierOnboardingDeps,
  setMaintenanceDeps,
  setRegistrationDeps,
  setTeamFoundingDeps,
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
        ignorePaths: ({ url }) => url.startsWith('/health'),
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

  const ajv = {
    customOptions: {
      removeAdditional: true as const,
      coerceTypes: 'array' as const,
    },
  };
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
  // Seed the getDatabase() singleton so route-level code (e.g. advisory
  // locks) can obtain the shared Drizzle instance without a URL.
  getDatabase(config.database.DATABASE_URL);

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
  const diaryTransferRepository = createDiaryTransferRepository(
    dbConnection.db,
  );
  const groupRepository = createGroupRepository(dbConnection.db);
  const voucherRepository = createVoucherRepository(dbConnection.db);
  const signingRequestRepository = createSigningRequestRepository(
    dbConnection.db,
  );
  const contextPackRepository = createContextPackRepository(dbConnection.db);
  const renderedPackRepository = createRenderedPackRepository(dbConnection.db);
  const correlationSealRepository = createCorrelationSealRepository(
    dbConnection.db,
  );
  const taskRepository = createTaskRepository(dbConnection.db);
  const entryRelationRepository = createEntryRelationRepository(
    dbConnection.db,
  );
  const nonceRepository = createNonceRepository(dbConnection.db);

  // ── Services ───────────────────────────────────────────────────
  const permissionChecker = createPermissionChecker(
    oryClients.permission,
    app.log,
  );
  const relationshipReader = createRelationshipReader(
    oryClients.relationshipRead,
  );
  const relationshipWriter = createRelationshipWriter(oryClients.relationship);

  // EMBEDDING_CACHE_DIR is resolved to an absolute path here because pnpm sets
  // the process cwd to apps/rest-api/ when running the dev script, so a relative
  // path like "./models" would resolve to apps/rest-api/models — not the repo root.
  // For local dev: download the model once with the bench tool (see README.md),
  // then set EMBEDDING_ALLOW_REMOTE_MODELS=false in .env.local.
  const embeddingService = createEmbeddingService({
    cacheDir: config.embedding.EMBEDDING_CACHE_DIR
      ? resolve(config.embedding.EMBEDDING_CACHE_DIR)
      : undefined,
    allowRemoteModels: config.embedding.EMBEDDING_ALLOW_REMOTE_MODELS,
    logger: app.log,
  });

  // Eagerly warm the ONNX pipeline so the first user request doesn't pay
  // the ~5 s cold-start cost (model load + runtime init). The health-check
  // grace period (30 s) absorbs this.
  const warmupStart = performance.now();
  await embeddingService.embedPassage('warmup');
  app.log.info(
    { durationMs: Math.round(performance.now() - warmupStart) },
    'Embedding pipeline warmed',
  );

  await initTaskTypeRegistry();
  const transactionRunner = createDrizzleTransactionRunner(dbConnection.db);
  const taskService: TaskService = createTaskService({
    taskRepository,
    diaryRepository,
    agentRepository,
    contextPackRepository,
    renderedPackRepository,
    correlationSealRepository,
    permissionChecker,
    relationshipWriter,
    transactionRunner,
    logger: app.log,
  });
  const notifyTaskStatusChanged = async (taskId: string): Promise<void> => {
    try {
      await taskService.promoteSatisfiedWaitingTasks({ triggerTaskId: taskId });
    } catch (err) {
      app.log.error({ taskId, err }, 'task.statusChanged.promotionFailed');
    }
  };

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
      () => initTaskWorkflows(),
      () => initRegistrationWorkflow(),
      () => initHumanOnboardingWorkflow(),
      () => initLegreffierOnboardingWorkflow(),
      () => initDiaryWorkflows(),
      () => initMaintenanceWorkflows(config.packGc, config.taskOrphanSweeper),
      () => initTeamFoundingWorkflow(),
      () => initDiaryTransferWorkflow(),
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
        setMaintenanceDeps({
          nonceRepository,
          contextPackRepository,
          renderedPackRepository,
          taskRepository,
          dataSource: getDataSource(),
          transactionRunner: createDrizzleTransactionRunner(dbConnection.db),
          relationshipWriter,
          logger: app.log,
          notifyTaskStatusChanged,
        });
      },
      (dataSource) => {
        setTaskWorkflowDeps({
          dataSource,
          createAttempt: (input) => taskRepository.createAttempt(input),
          updateAttempt: (taskId, attemptN, fields) =>
            taskRepository.updateAttempt(taskId, attemptN, fields),
          updateTaskStatus: (taskId, status, extra) =>
            taskRepository.updateStatus(taskId, status, extra),
          updateTaskStatusIfNotIn: (taskId, status, excluded, extra) =>
            taskRepository.updateStatusIfNotIn(taskId, status, excluded, extra),
          removeClaimantTuple: (taskId, agentId) =>
            relationshipWriter.removeTaskClaimant(taskId, agentId),
          countAttempts: (taskId) => taskRepository.countAttempts(taskId),
          getMaxAttempts: (taskId) => taskRepository.getMaxAttempts(taskId),
          findTaskById: (taskId) => taskRepository.findById(taskId),
          notifyTaskStatusChanged,
        });
      },
      () => {
        setTeamFoundingDeps({
          teamRepository,
          relationshipWriter,
          logger: app.log,
        });
      },
      () => {
        setDiaryTransferDeps({
          diaryRepository,
          diaryTransferRepository,
          relationshipWriter,
          logger: app.log,
        });
      },
    ],
  });

  const dataSource = getDataSource();
  const dbosTransactionRunner = createDBOSTransactionRunner(dataSource);

  const diaryService = createDiaryService({
    logger: app.log,
    diaryRepository,
    diaryEntryRepository,
    entryRelationRepository,
    permissionChecker,
    relationshipReader,
    relationshipWriter,
    embeddingService,
    transactionRunner: dbosTransactionRunner,
  });

  const contextPackService = new ContextPackService({
    contextPackRepository,
    renderedPackRepository,
    diaryEntryRepository,
    permissionChecker,
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
    assertDiaryReadable: createAssertDiaryReadable(diaryService, app.log),
    logger: app.log,
    ttlDays: config.packGc?.PACK_GC_COMPILE_TTL_DAYS ?? 7,
  });

  const tokenValidator = createTokenValidator(oryClients.oauth2, {
    jwksUri: `${oryUrls.hydraPublicUrl}/.well-known/jwks.json`,
  });

  const sessionResolver = createSessionResolver(oryClients.frontend, {
    logger: app.log,
  });

  // ── REST API routes ────────────────────────────────────────────
  await registerApiRoutes(app, {
    diaryService,
    diaryEntryRepository,
    contextPackRepository,
    renderedPackRepository,
    contextPackService,
    entryRelationRepository,
    embeddingService,
    agentRepository,
    humanRepository,
    cryptoService,
    voucherRepository,
    groupRepository,
    teamRepository,
    diaryTransferRepository,
    taskRepository,
    taskService,
    signingRequestRepository,
    nonceRepository,
    dataSource,
    transactionRunner: dbosTransactionRunner,
    permissionChecker,
    relationshipReader,
    relationshipWriter,
    tokenValidator,
    sessionResolver,
    teamResolver: {
      // subjectId is the Kratos identity_id from the JWT/session. For agents
      // it IS the FK target on teams.creator_agent_id. For humans it is
      // NOT the FK target — teams.creator_human_id references humans.id,
      // which we have to look up via humans.identityId.
      findPersonalTeamId: async (subjectId: string) => {
        const agentTeam = await teamRepository.findPersonalByCreator({
          kind: 'agent',
          id: subjectId,
        });
        if (agentTeam) return agentTeam.id;
        const human = await humanRepository.findByIdentityId(subjectId);
        if (!human) return null;
        const humanTeam = await teamRepository.findPersonalByCreator({
          kind: 'human',
          id: human.id,
        });
        return humanTeam?.id ?? null;
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
      rateLimitReadiness: config.security.RATE_LIMIT_READINESS,
      trustProxy: config.security.TRUST_PROXY,
      apiBaseUrl: config.security.API_BASE_URL.replace(/\/$/, ''),
      sponsorAgentId: config.security.SPONSOR_AGENT_ID,
    },
    packGcConfig: config.packGc,
    pool: dbConnection.pool,
    oryProjectUrl: config.ory.ORY_PROJECT_URL,
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
