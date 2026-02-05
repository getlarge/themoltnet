/**
 * CORS plugin using @fastify/cors
 *
 * Configures Cross-Origin Resource Sharing with explicit origin allowlist.
 */

import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface CorsPluginOptions {
  /** Comma-separated list of allowed origins */
  origins: string;
}

async function corsPlugin(
  fastify: FastifyInstance,
  options: CorsPluginOptions,
) {
  const allowedOrigins = options.origins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  await fastify.register(cors, {
    // Only allow specified origins
    origin: (origin, callback) => {
      // Allow requests with no origin (e.g., same-origin, curl, mobile apps)
      if (!origin) {
        callback(null, true);
        return;
      }

      if (allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error('CORS not allowed'), false);
      }
    },
    // Allow credentials (cookies, authorization headers)
    credentials: true,
    // Allowed methods
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    // Allowed headers
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Correlation-ID',
    ],
    // Exposed headers (accessible to JavaScript)
    exposedHeaders: [
      'X-Request-ID',
      'X-RateLimit-Limit',
      'X-RateLimit-Remaining',
      'X-RateLimit-Reset',
      'Retry-After',
    ],
    // Preflight cache duration (1 hour)
    maxAge: 3600,
  });
}

export const corsPluginFp = fp(corsPlugin, {
  name: 'cors',
});
