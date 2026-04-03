/**
 * Health check routes
 *
 * - GET /health       — shallow liveness probe (for Fly.io machine health)
 * - GET /health/ready — deep readiness probe (checks DB + Ory connectivity)
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { HealthSchema, ReadinessSchema } from '../schemas.js';

/** Minimal pool interface for health probing (avoids importing pg types). */
interface HealthPool {
  query(sql: string): Promise<unknown>;
}

export interface HealthRouteOptions {
  pool?: HealthPool;
  oryProjectUrl?: string;
}

interface ComponentResult {
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}

async function probeDatabase(pool: HealthPool): Promise<ComponentResult> {
  const start = performance.now();
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

async function probeOry(oryProjectUrl: string): Promise<ComponentResult> {
  const start = performance.now();
  try {
    const response = await fetch(
      `${oryProjectUrl}/.well-known/openid-configuration`,
      { signal: AbortSignal.timeout(5000) },
    );
    if (!response.ok) {
      return {
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        error: `HTTP ${response.status}`,
      };
    }
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

// eslint-disable-next-line @typescript-eslint/require-await -- Fastify plugin convention
export async function healthRoutes(
  fastify: FastifyInstance,
  opts: HealthRouteOptions,
) {
  fastify.get(
    '/health',
    {
      schema: {
        operationId: 'getHealth',
        tags: ['health'],
        description: 'Shallow liveness probe.',
        response: {
          200: Type.Ref(HealthSchema),
        },
      },
    },
    () => {
      return { status: 'ok', timestamp: new Date().toISOString() };
    },
  );

  fastify.get(
    '/health/ready',
    {
      schema: {
        operationId: 'getReadiness',
        tags: ['health'],
        description:
          'Deep readiness probe. Checks database and Ory connectivity.',
        response: {
          200: Type.Ref(ReadinessSchema),
          503: Type.Ref(ReadinessSchema),
        },
      },
    },
    async (_request, reply) => {
      const [database, ory] = await Promise.all([
        opts.pool
          ? probeDatabase(opts.pool)
          : {
              status: 'error' as const,
              latencyMs: 0,
              error: 'Not configured',
            },
        opts.oryProjectUrl
          ? probeOry(opts.oryProjectUrl)
          : {
              status: 'error' as const,
              latencyMs: 0,
              error: 'Not configured',
            },
      ]);

      const allOk = database.status === 'ok' && ory.status === 'ok';
      const body = {
        status: allOk ? ('ok' as const) : ('degraded' as const),
        timestamp: new Date().toISOString(),
        components: { database, ory },
      };

      return reply.status(allOk ? 200 : 503).send(body);
    },
  );
}
