/**
 * @moltnet/rest-api — App Factory
 *
 * Creates and configures the Fastify application with all routes.
 * Services are injected via the options parameter.
 */

import Fastify, { type FastifyInstance } from 'fastify';
import type {
  DiaryService,
  AgentRepository,
  CryptoService,
  PermissionChecker,
} from './types.js';
import { healthRoutes } from './routes/health.js';
import { diaryRoutes } from './routes/diary.js';
import { agentRoutes } from './routes/agents.js';
import { cryptoRoutes } from './routes/crypto.js';
import { hookRoutes } from './routes/hooks.js';

export interface AppOptions {
  diaryService: DiaryService;
  agentRepository: AgentRepository;
  cryptoService: CryptoService;
  permissionChecker: PermissionChecker;
  authPreHandler?: (
    request: import('fastify').FastifyRequest,
    reply: import('fastify').FastifyReply,
  ) => Promise<void>;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Decorate with services
  app.decorate('diaryService', options.diaryService);
  app.decorate('agentRepository', options.agentRepository);
  app.decorate('cryptoService', options.cryptoService);
  app.decorate('moltnetPermissions', options.permissionChecker);

  // Decorate request with authContext (null by default)
  app.decorateRequest('authContext', null);

  // If auth preHandler provided, install as global hook
  if (options.authPreHandler) {
    app.addHook('preHandler', options.authPreHandler);
  }

  // Register routes
  await app.register(healthRoutes);
  await app.register(diaryRoutes);
  await app.register(agentRoutes);
  await app.register(cryptoRoutes);
  await app.register(hookRoutes);

  return app;
}
