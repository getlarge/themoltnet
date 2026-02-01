import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import type { ServerConfig } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface AppOptions {
  config: ServerConfig;
  logger?: boolean | object;
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, logger = true } = options;

  const app = Fastify({ logger });

  // Health check — registered before static to prevent accidental shadowing
  app.get('/healthz', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Resolve static directory
  const staticDir = resolveStaticDir(config.STATIC_DIR);

  if (staticDir) {
    await app.register(fastifyStatic, {
      root: staticDir,
      prefix: '/',
    });

    // SPA fallback: serve index.html for any unmatched GET request
    app.setNotFoundHandler((request, reply) => {
      if (request.method === 'GET') {
        return reply.sendFile('index.html');
      }
      return reply.status(404).send({ error: 'Not Found' });
    });
  }

  return app;
}

function resolveStaticDir(configDir?: string): string | null {
  if (configDir) {
    if (!existsSync(configDir)) {
      throw new Error(`STATIC_DIR does not exist: ${configDir}`);
    }
    return configDir;
  }

  // Default paths to try (Docker, then local dev)
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
