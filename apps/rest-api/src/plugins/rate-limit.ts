/**
 * Rate limiting plugin using @fastify/rate-limit
 *
 * Configures global and per-route rate limits with RFC 9457 Problem Details
 * format for rate limit exceeded responses.
 */

import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

import { getTypeUri } from '../problems/registry.js';
import { createPreResolveThrottle } from './pre-resolve-throttle.js';

/** Redis key prefix so MoltNet rate-limit keys are identifiable in shared Redis. */
const REDIS_NAMESPACE = 'moltnet-rl-';

export interface RateLimitPluginOptions {
  /** Max requests per minute for authenticated users (default: 100) */
  globalAuthLimit: number;
  /** Max requests per minute for anonymous users (default: 30) */
  globalAnonLimit: number;
  /** Max requests per minute for embedding endpoints (default: 20) */
  embeddingLimit: number;
  /** Max requests per minute for vouch endpoints (default: 10) */
  vouchLimit: number;
  /** Max requests per minute for signing request creation (default: 5) */
  signingLimit: number;
  /** Max requests per minute for recovery endpoints (default: 5) */
  recoveryLimit: number;
  /** Max requests per minute for public verify endpoints (default: 10) */
  publicVerifyLimit: number;
  /** Max requests per minute for public feed search (default: 15) */
  publicSearchLimit: number;
  /** Max requests per day for LeGreffier onboarding start (default: 3) */
  legreffierStartLimit: number;
  /** Max requests per minute for LeGreffier status polling (default: 120) */
  legreffierStatusLimit: number;
  /** Max requests per minute for registration endpoint (default: 5) */
  registrationLimit: number;
  /** Max requests per minute for readiness probes (default: 12) */
  readinessLimit: number;
  /**
   * Max requests per minute for authenticated GET reads (default: 150). All
   * read routes share this one per-identity bucket (groupId 'read'), kept
   * separate from — and more generous than — the global mutation budget so a
   * burst of reads cannot starve writes. See issue #1336.
   */
  readLimit: number;
  /** Exact request paths exempt from rate limiting (e.g. liveness probes). */
  allowList: readonly string[];
  /**
   * ioredis client for the SHARED rate-limit store (per-identity budgets
   * coherent across instances). When omitted, the limiter uses an in-memory
   * store (single-instance). On a Redis error the limiter fails OPEN
   * (skipOnError) so a Redis outage never 500s the API — the error surfaces via
   * the client's own 'error' event (logged at bootstrap), not here.
   */
  redis?: Redis;
}

export interface PreResolveThrottleOptions {
  /**
   * Max requests per minute per client IP allowed BEFORE auth-context
   * resolution. A coarse anti-amplification ceiling protecting Hydra/Kratos from
   * spray, not the per-principal budget. Should be generous.
   */
  preResolveIpLimit: number;
  /** Exact request paths exempt from rate limiting (e.g. liveness probes). */
  allowList: readonly string[];
}

const ONE_MINUTE_MS = 60_000;

/**
 * Build an exact-path allowList predicate from a list of paths. Shared by the
 * pre-resolve throttle and the main limiter so both honor the same public
 * exemptions configured via RATE_LIMIT_ALLOWLIST.
 */
function makeAllowList(paths: readonly string[]): (url: string) => boolean {
  const set = new Set(paths);
  return (url: string) => set.has(url);
}

/**
 * Register a pre-resolution IP throttle as an `onRequest` hook. MUST be
 * registered BEFORE the auth plugin so it runs before `populateAuthContext`
 * (which does network auth resolution). Caps resolution attempts per IP so a
 * single-IP spray cannot amplify load onto Hydra/Kratos. Shares the configured
 * allowList and the RFC 9457 429 shape with the main limiter.
 */
export function registerPreResolveThrottle(
  fastify: FastifyInstance,
  options: PreResolveThrottleOptions,
): void {
  const throttle = createPreResolveThrottle(
    options.preResolveIpLimit,
    ONE_MINUTE_MS,
  );
  const isAllowListed = makeAllowList(options.allowList);

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      if (isAllowListed(request.url)) return;

      const retryAfter = throttle.hit(request.ip, Date.now());
      if (retryAfter !== null) {
        reply
          .code(429)
          .header('retry-after', String(retryAfter))
          .send(buildRateLimitResponse(request, retryAfter));
      }
    },
  );
}

/**
 * Build RFC 9457 Problem Details response for rate limit exceeded.
 */
function buildRateLimitResponse(request: FastifyRequest, retryAfter: number) {
  return {
    type: getTypeUri('rate-limit-exceeded'),
    title: 'Rate Limit Exceeded',
    status: 429,
    statusCode: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    detail: `Too many requests. Please retry after ${retryAfter} seconds.`,
    instance: request.url,
    retryAfter,
  };
}

async function rateLimitPluginImpl(
  fastify: FastifyInstance,
  options: RateLimitPluginOptions,
) {
  const {
    globalAuthLimit,
    globalAnonLimit,
    embeddingLimit,
    vouchLimit,
    signingLimit,
    recoveryLimit,
    publicVerifyLimit,
    publicSearchLimit,
    legreffierStartLimit,
    legreffierStatusLimit,
    registrationLimit,
    readinessLimit,
    readLimit,
    allowList,
    redis,
  } = options;

  const isAllowListed = makeAllowList(allowList);

  // Register global rate limiter
  await fastify.register(rateLimit, {
    global: true,
    // Shared store across instances when Redis is configured; otherwise the
    // plugin's default in-memory store. skipOnError makes the limiter fail OPEN
    // on a Redis error (a protective control must not 500 the whole API on a
    // Redis blip) — the error is surfaced via the ioredis client's 'error'
    // event, logged at bootstrap. nameSpace keeps keys identifiable in Redis.
    ...(redis ? { redis, nameSpace: REDIS_NAMESPACE, skipOnError: true } : {}),
    // Key by the VERIFIED principal so all of one identity's tokens/sessions
    // share a single budget. request.authContext is populated by the auth
    // plugin's global `populateAuthContext` onRequest hook, which is registered
    // BEFORE this plugin and therefore runs first — so authContext is available
    // here despite both hooks being at the onRequest phase. Anonymous/public
    // requests (no credential) fall back to the (proxy-aware) client IP.
    // See issue #1336: the earlier bug was that authContext was resolved at the
    // auth preHandler (after this hook), so it was always null here.
    keyGenerator: (request: FastifyRequest) =>
      request.authContext?.identityId ?? request.ip,
    // Authenticated principals get the higher auth limit; anonymous requests get
    // the stricter anon limit.
    max: (request: FastifyRequest) =>
      request.authContext?.identityId ? globalAuthLimit : globalAnonLimit,
    // 1 minute window
    timeWindow: '1 minute',
    // Add standard rate limit headers
    addHeadersOnExceeding: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
    },
    addHeaders: {
      'x-ratelimit-limit': true,
      'x-ratelimit-remaining': true,
      'x-ratelimit-reset': true,
      'retry-after': true,
    },
    // Custom error response using RFC 9457 Problem Details
    errorResponseBuilder: (
      request: FastifyRequest,
      context: { max: number; ttl: number },
    ) => {
      const retryAfter = Math.ceil(context.ttl / 1000);
      return buildRateLimitResponse(request, retryAfter);
    },
    // Skip rate limiting for the configured public paths (e.g. liveness probe —
    // Fly.io polls /health every 30s — and the problem registry). Shared with
    // the pre-resolve throttle via the same allowList.
    allowList: (request: FastifyRequest) => isAllowListed(request.url),
  });

  // Store route-specific configs for use in route definitions
  fastify.decorate('rateLimitConfig', {
    embedding: {
      max: embeddingLimit,
      timeWindow: '1 minute',
    },
    vouch: {
      max: vouchLimit,
      timeWindow: '1 minute',
    },
    signing: {
      max: signingLimit,
      timeWindow: '1 minute',
    },
    recovery: {
      max: recoveryLimit,
      timeWindow: '1 minute',
    },
    publicVerify: {
      max: publicVerifyLimit,
      timeWindow: '1 minute',
    },
    publicSearch: {
      max: publicSearchLimit,
      timeWindow: '1 minute',
    },
    legreffierStart: {
      max: legreffierStartLimit,
      timeWindow: '1 day',
    },
    legreffierStatus: {
      max: legreffierStatusLimit,
      timeWindow: '1 minute',
    },
    registration: {
      max: registrationLimit,
      timeWindow: '1 minute',
    },
    readiness: {
      max: readinessLimit,
      timeWindow: '1 minute',
    },
    // Shared bucket for authenticated GET reads. `groupId: 'read'` makes every
    // route that uses this config draw from ONE per-identity bucket, distinct
    // from the global mutation budget. Apply via `config.rateLimit` on read
    // routes (see e.g. tasks.ts GET handlers).
    read: {
      max: readLimit,
      timeWindow: '1 minute',
      groupId: 'read',
    },
  });
}

export const rateLimitPlugin = fp(rateLimitPluginImpl, {
  name: 'rate-limit',
});

// Type augmentation for Fastify
declare module 'fastify' {
  interface FastifyInstance {
    rateLimitConfig: {
      embedding: { max: number; timeWindow: string };
      vouch: { max: number; timeWindow: string };
      signing: { max: number; timeWindow: string };
      recovery: { max: number; timeWindow: string };
      publicVerify: { max: number; timeWindow: string };
      publicSearch: { max: number; timeWindow: string };
      legreffierStart: { max: number; timeWindow: string };
      legreffierStatus: { max: number; timeWindow: string };
      registration: { max: number; timeWindow: string };
      readiness: { max: number; timeWindow: string };
      read: { max: number; timeWindow: string; groupId: string };
    };
  }
}
