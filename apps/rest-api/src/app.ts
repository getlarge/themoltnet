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

import { errorHandlerPlugin } from './plugins/error-handler.js';
import { agentRoutes } from './routes/agents.js';
import { cryptoRoutes } from './routes/crypto.js';
import { diaryRoutes } from './routes/diary.js';
import { healthRoutes } from './routes/health.js';
import { hookRoutes } from './routes/hooks.js';
import { problemRoutes } from './routes/problems.js';
import { recoveryRoutes } from './routes/recovery.js';
import { vouchRoutes } from './routes/vouch.js';
import { sharedSchemas } from './schemas.js';
import type {
  AgentRepository,
  CryptoService,
  DiaryService,
  VoucherRepository,
} from './types.js';

export interface AppOptions {
  diaryService: DiaryService;
  agentRepository: AgentRepository;
  cryptoService: CryptoService;
  voucherRepository: VoucherRepository;
  permissionChecker: PermissionChecker;
  tokenValidator: TokenValidator;
  webhookApiKey: string;
  recoverySecret: string;
  oryClients: OryClients;
  logger?: boolean;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });

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

  // Decorate with services
  app.decorate('diaryService', options.diaryService);
  app.decorate('agentRepository', options.agentRepository);
  app.decorate('cryptoService', options.cryptoService);
  app.decorate('voucherRepository', options.voucherRepository);

  // Decorate with webhook config for hook routes
  app.decorate('webhookApiKey', options.webhookApiKey);
  app.decorate('oauth2Client', options.oryClients.oauth2);

  // Register routes
  await app.register(hookRoutes);
  await app.register(healthRoutes);
  await app.register(diaryRoutes);
  await app.register(agentRoutes);
  await app.register(cryptoRoutes);
  await app.register(recoveryRoutes, {
    recoverySecret: options.recoverySecret,
    identityClient: options.oryClients.identity,
  });
  await app.register(vouchRoutes);
  await app.register(problemRoutes);

  return app;
}
