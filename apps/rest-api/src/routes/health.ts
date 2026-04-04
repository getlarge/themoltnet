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

/**
 * Classify a probe error into a safe category string.
 * Raw error details are not exposed to avoid leaking internals.
 */
function classifyError(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.message.includes('timeout')) {
      return 'timeout';
    }
    if (
      err.message.includes('ECONNREFUSED') ||
      err.message.includes('ENOTFOUND') ||
      err.message.includes('fetch failed')
    ) {
      return 'connection_failed';
    }
  }
  return 'unavailable';
}

async function probeDatabase(
  pool: HealthPool,
  log: { warn: (obj: object, msg: string) => void },
): Promise<ComponentResult> {
  const start = performance.now();
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    log.warn({ err, probe: 'database' }, 'Readiness probe failed');
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: classifyError(err),
    };
  }
}

async function probeOry(
  oryProjectUrl: string,
  log: { warn: (obj: object, msg: string) => void },
): Promise<ComponentResult> {
  const start = performance.now();
  try {
    const url = new URL(
      '/.well-known/openid-configuration',
      oryProjectUrl,
    ).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) {
      return {
        status: 'error',
        latencyMs: Math.round(performance.now() - start),
        error: `http_${response.status}`,
      };
    }
    return { status: 'ok', latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    log.warn({ err, probe: 'ory' }, 'Readiness probe failed');
    return {
      status: 'error',
      latencyMs: Math.round(performance.now() - start),
      error: classifyError(err),
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
      config: { rateLimit: fastify.rateLimitConfig?.readiness },
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
    async (request, reply) => {
      const [database, ory] = await Promise.all([
        opts.pool
          ? probeDatabase(opts.pool, request.log)
          : {
              status: 'error' as const,
              latencyMs: 0,
              error: 'not_configured',
            },
        opts.oryProjectUrl
          ? probeOry(opts.oryProjectUrl, request.log)
          : {
              status: 'error' as const,
              latencyMs: 0,
              error: 'not_configured',
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
