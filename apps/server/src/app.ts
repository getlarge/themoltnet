/**
 * @moltnet/server — Combined Server Bootstrap
 *
 * Initializes all services (database, Ory, diary, crypto, auth, observability)
 * and registers both the REST API routes and the static landing page on a
 * single Fastify instance.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import {
  createOryClients,
  createPermissionChecker,
  createTokenValidator,
} from '@moltnet/auth';
import { cryptoService } from '@moltnet/crypto-service';
import {
  createAgentRepository,
  createDatabase,
  createDiaryRepository,
  createVoucherRepository,
  type DatabaseConnection,
} from '@moltnet/database';
import { createDiaryService } from '@moltnet/diary-service';
import { createEmbeddingService } from '@moltnet/embedding-service';
import {
  initObservability,
  type ObservabilityContext,
  observabilityPlugin,
} from '@moltnet/observability';
import { registerApiRoutes, resolveOryUrls } from '@moltnet/rest-api';
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from 'fastify';

import type { CombinedConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface BootstrapResult {
  app: FastifyInstance;
  dbConnection: DatabaseConnection;
  observability: ObservabilityContext | null;
}

export async function bootstrap(
  config: CombinedConfig,
): Promise<BootstrapResult> {
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

  const app = (
    observability?.logger
      ? Fastify({ loggerInstance: observability.logger })
      : Fastify({ logger: loggerConfig })
  ) as FastifyInstance;

  // Register @fastify/otel BEFORE routes for full lifecycle tracing
  if (observability?.fastifyOtelPlugin) {
    await app.register(observability.fastifyOtelPlugin);
  }

  // ── Database ───────────────────────────────────────────────────
  if (!config.database.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for the combined server');
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

  // ── Services ───────────────────────────────────────────────────
  const permissionChecker = createPermissionChecker(
    oryClients.permission,
    oryClients.relationship,
  );

  const embeddingService = createEmbeddingService({
    logger: app.log,
  });

  const diaryService = createDiaryService({
    diaryRepository,
    permissionChecker,
    embeddingService,
  });

  const tokenValidator = createTokenValidator(oryClients.oauth2, {
    jwksUri: `${oryUrls.hydraPublicUrl}/.well-known/jwks.json`,
  });

  // ── REST API routes ────────────────────────────────────────────
  await registerApiRoutes(app, {
    diaryService,
    agentRepository,
    cryptoService,
    voucherRepository,
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
    },
  });

  // ── Observability metrics plugin ───────────────────────────────
  if (observability) {
    await app.register(observabilityPlugin, {
      serviceName: 'moltnet-server',
      shutdown: observability.shutdown,
    });
  }

  // ── Static landing page ────────────────────────────────────────
  const staticDir = resolveStaticDir(config.staticDir);

  if (staticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
      wildcard: false,
    });

    // SPA fallback: serve index.html for browser navigation only.
    // API clients (Accept: application/json) get a proper JSON 404.
    app.setNotFoundHandler((request: FastifyRequest, reply: FastifyReply) => {
      const accept = request.headers.accept ?? '';
      if (
        request.method === 'GET' &&
        accept.includes('text/html') &&
        !accept.includes('application/json')
      ) {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not Found' });
    });
  }

  return { app, dbConnection, observability };
}

function resolveStaticDir(configDir?: string): string | null {
  if (configDir) {
    if (!existsSync(configDir)) {
      throw new Error(`STATIC_DIR does not exist: ${configDir}`);
    }
    return configDir;
  }

  const candidates = [
    path.resolve('/app/public'),
    path.resolve(__dirname, '../../landing/dist'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}
