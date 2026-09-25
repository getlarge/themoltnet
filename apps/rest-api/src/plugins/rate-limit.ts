/**
 * Rate limiting plugin using @fastify/rate-limit
 *
 * Configures global and per-route rate limits. The OAuth token endpoint uses
 * its declared OAuth error response; other routes use RFC 9457 Problem Details.
 */

import { BlockList, isIP } from 'node:net';

import rateLimit from '@fastify/rate-limit';
import { KRATOS_COOKIE_NAME_REGEX, SESSION_TOKEN_HEADER } from '@moltnet/auth';
import { createMetricCounter } from '@moltnet/observability';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';
import type { Redis } from 'ioredis';

import { getTypeUri } from '../problems/registry.js';
import { oauthErrorBody } from '../routes/oauth2.js';
import { createPreResolveThrottle } from './pre-resolve-throttle.js';

/** Redis key prefix so MoltNet rate-limit keys are identifiable in shared Redis. */
const REDIS_NAMESPACE = 'moltnet-rl-';

export interface RateLimitPluginOptions {
  /** Max requests per minute for authenticated users (default: 100) */
  globalAuthLimit: number;
  /** Max requests per minute for anonymous users (default: 30) */
  globalAnonLimit: number;
  /** Token requests per minute per client IP. */
  tokenIpLimit: number;
  /** Operator consent requests per minute per verified identity or client IP. */
  oauthConsentLimit: number;
  /** Operator provisioning requests per minute per verified identity or client IP. */
  oauthProvisionLimit: number;
  /** Max requests per minute for embedding endpoints (default: 20) */
  embeddingLimit: number;
  /** Max requests per minute for signing request creation (default: 5) */
  signingLimit: number;
  /** Max requests per minute shared by agent-key lifecycle writes (default: 5) */
  agentKeyLimit: number;
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
  /** Max requests per minute for task artifact uploads (default: 20) */
  taskArtifactUploadLimit: number;
  /**
   * Max requests per minute for authenticated GET reads (default: 150). All
   * read routes share this one per-identity bucket (groupId 'read'), kept
   * separate from — and more generous than — the global mutation budget so a
   * burst of reads cannot starve writes. See issue #1336.
   */
  readLimit: number;
  /** Exact request paths exempt from rate limiting (e.g. liveness probes). */
  allowList: readonly string[];
  /** Header overwritten with the client address by the trusted ingress. */
  clientIpHeader?: string;
  /** Peer CIDRs permitted to supply the client IP header. */
  trustedProxyCidrs?: readonly string[];
  /**
   * ioredis client for the SHARED rate-limit store (per-identity budgets
   * coherent across instances). When omitted, the limiter uses an in-memory
   * store (single-instance). On a Redis error the limiter fails open
   * (skipOnError); callback failures are counted and logged here.
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
  /** Reserved pre-auth budget for each operator OAuth route. */
  oauthApprovalIpLimit: number;
  /** Exact request paths exempt from rate limiting (e.g. liveness probes). */
  allowList: readonly string[];
  /** Header overwritten with the client address by the trusted ingress. */
  clientIpHeader?: string;
  /** Peer CIDRs permitted to supply the client IP header. */
  trustedProxyCidrs?: readonly string[];
}

const ONE_MINUTE_MS = 60_000;

/** Trust an ingress header only from configured peers; direct callers use request.ip. */
function createClientIpResolver(
  clientIpHeader?: string,
  trustedProxyCidrs: readonly string[] = [],
): (request: FastifyRequest) => string {
  if (clientIpHeader && trustedProxyCidrs.length === 0) {
    throw new TypeError('Client IP header requires trusted proxy CIDRs');
  }
  const trustedPeers = new BlockList();
  for (const cidr of trustedProxyCidrs) {
    const [address, bits, ...extra] = cidr.split('/');
    const family = isIP(address ?? '');
    const prefix = Number(bits);
    if (
      extra.length ||
      !family ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > (family === 4 ? 32 : 128)
    ) {
      throw new TypeError(`Invalid trusted proxy CIDR: ${cidr}`);
    }
    trustedPeers.addSubnet(address, prefix, family === 4 ? 'ipv4' : 'ipv6');
  }
  const headerName = clientIpHeader?.toLowerCase();
  return (request) => {
    const peer = request.raw.socket.remoteAddress;
    if (!headerName || !peer) return request.ip;
    // Fastify's request.ip may reflect a caller-supplied X-Forwarded-For on
    // direct private connections. The socket peer is the safe fallback there.
    if (!trustedPeers.check(peer)) return peer;
    const value = request.headers[headerName];
    if (typeof value !== 'string' || value.includes('%')) return request.ip;
    const family = isIP(value);
    if (family === 4) return value;
    if (family === 6) {
      try {
        // URL parsing canonicalizes IPv6 and rejects scoped addresses.
        return new URL(`http://[${value}]/`).hostname.slice(1, -1);
      } catch {
        return request.ip;
      }
    }
    return request.ip;
  };
}

/** Group IPv6 callers by /64 while keeping IPv4-mapped peers per IPv4 address. */
export function clientAddressBucket(address: string): string {
  if (isIP(address) !== 6) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const [left, right] = canonical.split('::');
  const leftGroups = left ? left.split(':') : [];
  const rightGroups = right ? right.split(':') : [];
  const groups = [
    ...leftGroups,
    ...Array.from(
      { length: 8 - leftGroups.length - rightGroups.length },
      () => '0',
    ),
    ...rightGroups,
  ];
  const values = groups.map((group) => Number.parseInt(group, 16));
  if (
    values.slice(0, 5).every((value) => value === 0) &&
    values[5] === 0xffff
  ) {
    return [
      values[6] >> 8,
      values[6] & 0xff,
      values[7] >> 8,
      values[7] & 0xff,
    ].join('.');
  }
  return `${groups
    .slice(0, 4)
    .map((group) => group.padStart(4, '0'))
    .join(':')}::/64`;
}

/**
 * Build an exact-path allowList predicate from a list of paths. Shared by the
 * pre-resolve throttle and the main limiter so both honor the same public
 * exemptions configured via RATE_LIMIT_ALLOWLIST.
 */
function makeAllowList(paths: readonly string[]): (url: string) => boolean {
  const set = new Set([
    ...paths,
    '/docs',
    '/docs/',
    '/docs/openapi.json',
    '/docs/openapi.yaml',
    '/docs/js/scalar.js',
  ]);
  return (url: string) => set.has(url.split('?')[0]);
}

/** Only credentials that auth may resolve consume the shared IP guard. */
function hasResolvableCredential(request: FastifyRequest): boolean {
  const { authorization } = request.headers;
  const cookie = request.headers.cookie as string | string[] | undefined;
  const sessionToken = request.headers[SESSION_TOKEN_HEADER];
  return Boolean(
    authorization ||
    sessionToken ||
    (Array.isArray(cookie)
      ? cookie.some((value) => KRATOS_COOKIE_NAME_REGEX.test(value))
      : cookie && KRATOS_COOKIE_NAME_REGEX.test(cookie)),
  );
}

/**
 * Name the rate-limit bucket a request was throttled by, for the onExceeded log.
 * Read routes carry `groupId: 'read'`; everything else is the global/per-route
 * bucket. Low-cardinality string for log filtering.
 */
function bucketLabel(request: FastifyRequest): string {
  const cfg = request.routeOptions?.config as
    | {
        rateLimit?: { groupId?: string } | false;
        rateLimitBucket?: string;
      }
    | undefined;
  const routeGroupId =
    typeof cfg?.rateLimit === 'object' ? cfg.rateLimit.groupId : undefined;
  return routeGroupId ?? cfg?.rateLimitBucket ?? 'global';
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
  const consentThrottle = createPreResolveThrottle(
    options.oauthApprovalIpLimit,
    ONE_MINUTE_MS,
  );
  const provisionThrottle = createPreResolveThrottle(
    options.oauthApprovalIpLimit,
    ONE_MINUTE_MS,
  );
  const approvalThrottles = new Map([
    ['oauth-consent', consentThrottle],
    ['oauth-provision', provisionThrottle],
  ]);
  const isAllowListed = makeAllowList(options.allowList);
  const clientIp = createClientIpResolver(
    options.clientIpHeader,
    options.trustedProxyCidrs,
  );

  fastify.addHook(
    'onRequest',
    async (request: FastifyRequest, reply: FastifyReply) => {
      // This guard exists for auth-context resolution on other routes. The
      // token route has its own onRequest limiter before body parsing.
      if (
        isAllowListed(request.url) ||
        request.routeOptions?.config?.oauth2TokenRoute
      ) {
        return;
      }

      const route = request.routeOptions?.url;
      const bucket = (
        request.routeOptions?.config as { rateLimitBucket?: string } | undefined
      )?.rateLimitBucket;
      if (
        !approvalThrottles.has(bucket ?? '') &&
        !hasResolvableCredential(request)
      ) {
        return;
      }
      const selectedThrottle = approvalThrottles.get(bucket ?? '') ?? throttle;
      const retryAfter = selectedThrottle.hit(
        clientAddressBucket(clientIp(request)),
        Date.now(),
      );
      if (retryAfter !== null) {
        request.log.warn(
          {
            bucket: approvalThrottles.has(bucket ?? '')
              ? `pre-resolve-${bucket}`
              : 'pre-resolve',
            method: request.method,
            route: route ?? request.url.split('?')[0],
          },
          'rate limit exceeded',
        );
        reply
          .code(429)
          .header('retry-after', String(retryAfter))
          .send(buildRateLimitResponse(request, retryAfter));
      }
    },
  );
}

/**
 * Build the response required by the route's 429 schema.
 */
function buildRateLimitResponse(request: FastifyRequest, retryAfter: number) {
  if (request.routeOptions?.config?.oauth2TokenRoute)
    return oauthErrorBody(
      429,
      `Too many requests. Please retry after ${retryAfter} seconds.`,
    );

  return {
    type: getTypeUri('rate-limit-exceeded'),
    title: 'Rate Limit Exceeded',
    status: 429,
    statusCode: 429,
    code: 'RATE_LIMIT_EXCEEDED',
    detail: `Too many requests. Please retry after ${retryAfter} seconds.`,
    instance: request.routeOptions?.url ?? request.url.split('?')[0],
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
    tokenIpLimit,
    oauthConsentLimit,
    oauthProvisionLimit,
    embeddingLimit,
    signingLimit,
    agentKeyLimit,
    recoveryLimit,
    publicVerifyLimit,
    publicSearchLimit,
    legreffierStartLimit,
    legreffierStatusLimit,
    registrationLimit,
    readinessLimit,
    taskArtifactUploadLimit,
    readLimit,
    allowList,
    clientIpHeader,
    trustedProxyCidrs,
    redis,
  } = options;

  const isAllowListed = makeAllowList(allowList);
  const clientIp = createClientIpResolver(clientIpHeader, trustedProxyCidrs);
  const storeBypasses = createMetricCounter(
    'moltnet-rest-api',
    'auth.rate_limit.store_bypasses',
    'Requests whose Redis rate-limit check failed open',
  );
  let lastStoreErrorLog = 0;
  // @fastify/rate-limit's skipOnError catches store callback errors internally.
  // Observe that callback so a bypass is counted even when ioredis emits no
  // connection-level error event (for example, a command timeout).
  const observedRedis = redis
    ? new Proxy(redis, {
        get(target, property) {
          const value: unknown = Reflect.get(target, property, target);
          if (typeof value !== 'function') return value;
          const method = value as (...args: unknown[]) => unknown;
          const boundMethod: (...args: unknown[]) => unknown =
            method.bind(target);
          if (property !== 'rateLimit') return boundMethod;
          return (...args: unknown[]) => {
            const rawCallback: unknown = args.at(-1);
            if (typeof rawCallback === 'function') {
              const callback = rawCallback as (
                error: Error | null,
                result: unknown,
              ) => void;
              args[args.length - 1] = (
                error: Error | null,
                result: unknown,
              ) => {
                if (error) {
                  storeBypasses.add(1);
                  const now = Date.now();
                  if (now - lastStoreErrorLog >= 60_000) {
                    lastStoreErrorLog = now;
                    fastify.log.error(
                      { err: error },
                      'rate-limit Redis store check bypassed',
                    );
                  }
                }
                callback(error, result);
              };
            }
            return boundMethod(...args);
          };
        },
      })
    : undefined;
  fastify.decorate('tokenRateLimitKey', (request: FastifyRequest) =>
    clientAddressBucket(clientIp(request)),
  );

  // Register global rate limiter
  await fastify.register(rateLimit, {
    global: true,
    // Shared store across instances when Redis is configured; otherwise the
    // plugin's default in-memory store. skipOnError keeps a Redis blip from
    // failing API requests; observedRedis counts and logs each bypass.
    // nameSpace keeps keys identifiable in Redis.
    ...(observedRedis
      ? {
          redis: observedRedis,
          nameSpace: REDIS_NAMESPACE,
          skipOnError: true,
        }
      : {}),
    // Key by the VERIFIED principal so all of one identity's tokens/sessions
    // share a single budget. request.authContext is populated by the auth
    // plugin's global `populateAuthContext` onRequest hook, which is registered
    // BEFORE this plugin and therefore runs first — so authContext is available
    // here despite both hooks being at the onRequest phase. Anonymous/public
    // requests (no credential) fall back to the (proxy-aware) client IP.
    // See issue #1336: the earlier bug was that authContext was resolved at the
    // auth preHandler (after this hook), so it was always null here.
    keyGenerator: (request: FastifyRequest) =>
      request.authContext?.identityId ?? clientIp(request),
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
    // Skip rate limiting for the configured public paths (e.g. liveness probes
    // and the problem registry). Shared with
    // the pre-resolve throttle via the same allowList.
    allowList: (request: FastifyRequest) => isAllowListed(request.url),
    // Emit a structured warn on every 429 so rate-limit events are filterable in
    // logs/traces by bucket + subject_type + route (closes the #1336
    // observability gap). identityId/teamId already ride along as pino child
    // bindings set by the auth plugin, so we don't add them here (and keep the
    // explicit fields low-cardinality). A dedicated OTel counter was considered
    // and dropped as redundant with trace-based 429 queries — see issue #1336.
    onExceeded: (request: FastifyRequest) => {
      request.log.warn(
        {
          bucket: bucketLabel(request),
          subjectType: request.authContext?.subjectType ?? 'anonymous',
          method: request.method,
          route: request.routeOptions?.url ?? request.url,
        },
        'rate limit exceeded',
      );
    },
  });

  // Route-level configs get isolated child stores in @fastify/rate-limit, even
  // when they repeat a groupId. Reuse handlers when distinct routes must
  // consume one budget with either the local or Redis store.
  const agentKeyRateLimit = fastify.rateLimit({
    max: agentKeyLimit,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      `${request.authContext?.identityId ?? clientIp(request)}:agent-key`,
  });
  const publicVerifyRateLimit = fastify.rateLimit({
    max: publicVerifyLimit,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) =>
      `${clientIp(request)}:public-verify`,
  });
  fastify.decorate('rateLimitHooks', {
    agentKey: agentKeyRateLimit as onRequestAsyncHookHandler,
    publicVerify: publicVerifyRateLimit as onRequestAsyncHookHandler,
  });

  // Store route-specific configs for use in route definitions
  fastify.decorate('rateLimitConfig', {
    token: {
      max: tokenIpLimit,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) =>
        clientAddressBucket(clientIp(request)),
    },
    oauthConsent: {
      max: oauthConsentLimit,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) =>
        request.authContext?.identityId ??
        clientAddressBucket(clientIp(request)),
    },
    oauthProvision: {
      max: oauthProvisionLimit,
      timeWindow: '1 minute',
      keyGenerator: (request: FastifyRequest) =>
        request.authContext?.identityId ??
        clientAddressBucket(clientIp(request)),
    },
    embedding: {
      max: embeddingLimit,
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
    taskArtifactUpload: {
      max: taskArtifactUploadLimit,
      timeWindow: '1 minute',
      groupId: 'task-artifact-upload',
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
  interface FastifyContextConfig {
    rateLimitBucket?: string;
    oauth2TokenRoute?: boolean;
  }

  interface FastifyInstance {
    rateLimitHooks: {
      agentKey: onRequestAsyncHookHandler;
      publicVerify: onRequestAsyncHookHandler;
    };
    rateLimitConfig: {
      token: {
        max: number;
        timeWindow: string;
        keyGenerator: (request: FastifyRequest) => string;
      };
      oauthConsent: {
        max: number;
        timeWindow: string;
        keyGenerator: (request: FastifyRequest) => string;
      };
      oauthProvision: {
        max: number;
        timeWindow: string;
        keyGenerator: (request: FastifyRequest) => string;
      };
      embedding: { max: number; timeWindow: string };
      signing: { max: number; timeWindow: string };
      recovery: { max: number; timeWindow: string };
      publicSearch: { max: number; timeWindow: string };
      legreffierStart: { max: number; timeWindow: string };
      legreffierStatus: { max: number; timeWindow: string };
      registration: { max: number; timeWindow: string };
      readiness: { max: number; timeWindow: string };
      taskArtifactUpload: {
        max: number;
        timeWindow: string;
        groupId: string;
      };
      read: { max: number; timeWindow: string; groupId: string };
    };
    tokenRateLimitKey(request: FastifyRequest): string;
  }
}
