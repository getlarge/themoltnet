/**
 * @moltnet/rest-api — App Factory
 *
 * Creates and configures the Fastify application with all routes.
 * Services are injected via the options parameter.
 */

import swagger from '@fastify/swagger';
import {
  authPlugin,
  type OryClients,
  type PermissionChecker,
  type TokenValidator,
} from '@moltnet/auth';
import Fastify, { type FastifyInstance } from 'fastify';

import { corsPluginFp } from './plugins/cors.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { securityHeadersPlugin } from './plugins/security-headers.js';
import { agentRoutes } from './routes/agents.js';
import { cryptoRoutes } from './routes/crypto.js';
import { diaryRoutes } from './routes/diary.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { problemRoutes } from './routes/problems.js';
import { recoveryRoutes } from './routes/recovery.js';
import { signingRequestRoutes } from './routes/signing-requests.js';
import { vouchRoutes } from './routes/vouch.js';
import { sharedSchemas } from './schemas.js';
import type {
  AgentRepository,
  CryptoService,
  DataSource,
  DiaryService,
  SigningRequestRepository,
  VoucherRepository,
} from './types.js';

export interface SecurityOptions {
  /** Comma-separated list of allowed CORS origins */
  corsOrigins: string;
  /** Max requests per minute for authenticated users */
  rateLimitGlobalAuth: number;
  /** Max requests per minute for anonymous users */
  rateLimitGlobalAnon: number;
  /** Max requests per minute for embedding endpoints */
  rateLimitEmbedding: number;
  /** Max requests per minute for vouch endpoints */
  rateLimitVouch: number;
  /** Max requests per minute for signing request creation */
  rateLimitSigning: number;
}

export interface AppOptions {
  diaryService: DiaryService;
  agentRepository: AgentRepository;
  cryptoService: CryptoService;
  voucherRepository: VoucherRepository;
  /** Signing request repository + dataSource are required together (DBOS) */
  signingRequestRepository: SigningRequestRepository;
  dataSource: DataSource;
  signingTimeoutSeconds?: number;
  permissionChecker: PermissionChecker;
  tokenValidator: TokenValidator;
  webhookApiKey: string;
  recoverySecret: string;
  oryClients: OryClients;
  security: SecurityOptions;
  logger?: boolean;
}

/**
 * Register all REST API middleware and routes on a caller-provided Fastify instance.
 *
 * This is the composable entry point: the combined server calls this to mount
 * the full API on its own Fastify instance alongside static file serving.
 */
export async function registerApiRoutes(
  app: FastifyInstance,
  options: Omit<AppOptions, 'logger'>,
): Promise<void> {
  // Register security plugins first (order matters)
  // 1. Security headers (helmet)
  await app.register(securityHeadersPlugin);

  // 2. CORS
  await app.register(corsPluginFp, {
    origins: options.security.corsOrigins,
  });

  // Register OpenAPI spec generation
  await app.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title: 'MoltNet REST API',
        description:
          'Infrastructure for AI agent autonomy — identity, memory, and authentication.',
        version: '0.1.0',
      },
      servers: [
        { url: 'https://api.themolt.net', description: 'Production' },
        { url: 'http://localhost:8000', description: 'Local development' },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'JWT',
            description: 'OAuth2 access token from Ory Hydra',
          },
        },
      },
    },
    refResolver: {
      buildLocalReference(json) {
        return (json.$id as string) || `def-${Math.random()}`;
      },
    },
  });

  // Register shared schemas for $ref resolution
  for (const schema of sharedSchemas) {
    app.addSchema(schema);
  }

  // Register global error handler (RFC 9457 Problem Details)
  await app.register(errorHandlerPlugin);

  // Register auth plugin (decorates tokenValidator, permissionChecker, request.authContext)
  await app.register(authPlugin, {
    tokenValidator: options.tokenValidator,
    permissionChecker: options.permissionChecker,
  });

  // 3. Rate limiting (AFTER auth so authContext is available)
  await app.register(rateLimitPlugin, {
    globalAuthLimit: options.security.rateLimitGlobalAuth,
    globalAnonLimit: options.security.rateLimitGlobalAnon,
    embeddingLimit: options.security.rateLimitEmbedding,
    vouchLimit: options.security.rateLimitVouch,
    signingLimit: options.security.rateLimitSigning,
  });

  // Decorate with services (guard to allow pre-decoration by DBOS plugin)
  const decorateSafe = (name: string, value: unknown) => {
    if (!app.hasDecorator(name)) {
      app.decorate(name, value);
    }
  };
  decorateSafe('diaryService', options.diaryService);
  decorateSafe('agentRepository', options.agentRepository);
  decorateSafe('cryptoService', options.cryptoService);
  decorateSafe('voucherRepository', options.voucherRepository);
  decorateSafe('signingTimeoutSeconds', options.signingTimeoutSeconds ?? 300);
  decorateSafe('signingRequestRepository', options.signingRequestRepository);
  decorateSafe('dataSource', options.dataSource);

  // Decorate with webhook config for hook routes
  app.decorate('webhookApiKey', options.webhookApiKey);
  app.decorate('oauth2Client', options.oryClients.oauth2);

  // Register routes
  await app.register(hookRoutes);
  await app.register(healthRoutes);
  await app.register(diaryRoutes);
  await app.register(agentRoutes);
  await app.register(cryptoRoutes);
  await app.register(signingRequestRoutes);
  await app.register(recoveryRoutes, {
    recoverySecret: options.recoverySecret,
    identityClient: options.oryClients.identity,
  });
  await app.register(vouchRoutes);
  await app.register(problemRoutes);
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  await registerApiRoutes(app, options);
  return app;
}
