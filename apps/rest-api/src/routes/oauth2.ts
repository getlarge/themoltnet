/**
 * OAuth2 token proxy
 *
 * POST /oauth2/token — reverse-proxies client_credentials grants to Hydra.
 * Exists so external callers only need a single domain (api.themolt.net)
 * instead of hitting the Ory Hydra public URL directly.
 *
 * Successful grants are cached in-process until shortly before they expire,
 * because every upstream call is a billed Ory M2M token (issue #1860). Two
 * consequences worth knowing:
 *
 * - While a token is cached, Hydra being unreachable no longer produces a 502
 *   for that client. The cached token is still valid, so this is deliberate
 *   resilience — but it does mean upstream outages surface later than before.
 * - Revoking a client at Hydra does not take effect here until the cached
 *   token expires. Authorization is still enforced downstream on every
 *   request, so a revoked agent is rejected at the auth chokepoint regardless.
 *
 * Upstream response schemas follow Ory Hydra's OpenAPI spec:
 * https://www.ory.com/docs/hydra/reference/api
 *
 * - 200: oauth2TokenExchange — { access_token, token_type, expires_in, scope?, refresh_token?, id_token? }
 * - 4xx: errorOAuth2 — { error, error_description, error_hint?, error_debug?, status_code? }
 */

import { createHash } from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  createRedisCacheStore,
  createSingleFlightCache,
  createTokenExchangeMetrics,
  entryFromExpiresIn,
  type RedisLikeClient,
  type TokenExchangeMetrics,
} from '@moltnet/oauth-token-cache';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import { Type } from 'typebox';

import { createProblem } from '../problems/index.js';

export interface OAuth2RouteOptions extends FastifyPluginOptions {
  hydraPublicUrl: string;
  /** Seconds shaved off the upstream lifetime so a served token never expires
   * in the caller's hand. Default 30. */
  expiryBufferSeconds?: number;
  /** Override instrumentation (tests). */
  metrics?: TokenExchangeMetrics;
  /** Shared Redis client. Omit to use a process-local store. */
  redis?: RedisLikeClient | null;
  /**
   * Ceiling on how long a `refresh_token` grant may be served from cache.
   * Kept deliberately short — see `GRANT_CACHE_POLICY`. Default 60s.
   */
  refreshGrantCacheSeconds?: number;
}

/**
 * Which grants may be served from cache, and for how long.
 *
 * `client_credentials` is cached for the token's full life: the same
 * credentials always yield an equivalent token, so replaying one leaks
 * nothing that presenting the credentials again would not.
 *
 * `refresh_token` is capped at a short window. Caching it at all trades away
 * part of Hydra's refresh-token reuse detection: normally a stolen refresh
 * token rotates the chain and the legitimate client's next refresh trips the
 * alarm, whereas a cache hit never reaches Hydra and so never rotates. A short
 * window still collapses retry storms and duplicate refreshes — the actual
 * source of churn — while keeping that blind spot to seconds rather than the
 * token's full 24h lifetime. Widen only with metrics showing real refresh
 * cadence, and treat it as a security decision, not a tuning one.
 *
 * `authorization_code` is never cached. The code is single-use by design and
 * Hydra's reuse detection is a security control; serving a second redemption
 * from cache would silently defeat it.
 */
const GRANT_CACHE_POLICY: Record<string, { maxSeconds?: number } | undefined> =
  {
    client_credentials: {},
    refresh_token: { maxSeconds: 60 },
  };

/** Hydra oauth2TokenExchange success payload. */
interface HydraTokenSuccess {
  access_token: string;
  token_type: string;
  expires_in: number;
  scope?: string;
  refresh_token?: string;
  id_token?: string;
}

/** Hydra errorOAuth2 payload. */
interface HydraError {
  error: string;
  error_description?: string;
}

type HydraResponse = HydraError | HydraTokenSuccess;

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Cache key for a grant.
 *
 * Every input that can change the resulting token participates, so a token
 * minted for one scope, audience, secret or refresh token can never be served
 * to a request asking for another.
 *
 * The Authorization header is part of the key and not an afterthought: under
 * `client_secret_basic` and `private_key_jwt` the client's identity lives
 * there and not in the body, so a key built from the body alone would serve
 * one client's token to another. Secrets are hashed, never stored.
 */
function grantCacheKey(
  body: Record<string, string>,
  authorization: string | undefined,
): string {
  return [
    body.grant_type ?? '',
    body.client_id ?? '',
    sha256(body.client_secret ?? ''),
    sha256(body.refresh_token ?? ''),
    sha256(body.code ?? ''),
    body.scope ?? '',
    body.audience ?? '',
    sha256(authorization ?? ''),
  ].join('|');
}

/**
 * Hydra oauth2TokenExchange response (successful token grant).
 * @see https://www.ory.com/docs/hydra/reference/api
 */
const OAuth2TokenResponseSchema = Type.Object(
  {
    access_token: Type.String(),
    token_type: Type.String(),
    expires_in: Type.Number(),
    scope: Type.Optional(Type.String()),
    refresh_token: Type.Optional(Type.String()),
    id_token: Type.Optional(Type.String()),
  },
  { $id: 'OAuth2TokenResponse', additionalProperties: true },
);

/**
 * Hydra errorOAuth2 response (token grant failure).
 * @see https://www.ory.com/docs/hydra/reference/api
 */
const OAuth2ErrorResponseSchema = Type.Object(
  {
    error: Type.String(),
    error_description: Type.Optional(Type.String()),
    error_hint: Type.Optional(Type.String()),
    error_debug: Type.Optional(Type.String()),
    status_code: Type.Optional(Type.Number()),
  },
  // additionalProperties so Fastify's serializer cannot strip fields Hydra
  // sends that we have not enumerated — this is a proxy, not a rewriter.
  { $id: 'OAuth2ErrorResponse', additionalProperties: true },
);

export async function oauth2Routes(
  fastify: FastifyInstance,
  options: OAuth2RouteOptions,
) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const { hydraPublicUrl } = options;
  const expiryBufferSeconds = options.expiryBufferSeconds ?? 30;
  const metrics = options.metrics ?? createTokenExchangeMetrics();
  if (options.refreshGrantCacheSeconds !== undefined) {
    GRANT_CACHE_POLICY.refresh_token = {
      maxSeconds: options.refreshGrantCacheSeconds,
    };
  }

  // Expiry, single-flight and cache metrics come from the shared primitive,
  // the same one the MCP proxy uses. Default store is process-local, so it is
  // per machine and lost on deploy — pass a Redis-backed CacheStore once
  // rest-api scales past one instance (issue #1860).
  const grantCache = createSingleFlightCache<{
    status: number;
    body: HydraResponse;
    headers: Record<string, string>;
  }>({
    store: options.redis
      ? createRedisCacheStore({ client: options.redis })
      : undefined,
    metrics,
    source: 'rest-proxy',
  });
  fastify.log.info(
    { store: options.redis ? 'redis' : 'memory' },
    'OAuth2 grant cache configured',
  );

  // Parse application/x-www-form-urlencoded into a Record<string, string>
  fastify.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'string' },
    (_req, body: string, done) => {
      const parsed: Record<string, string> = {};
      for (const [key, value] of new URLSearchParams(body)) {
        parsed[key] = value;
      }
      done(null, parsed);
    },
  );

  server.post(
    '/oauth2/token',
    {
      schema: {
        operationId: 'getOAuth2Token',
        tags: ['auth'],
        description:
          'OAuth2 token endpoint. Proxies every grant to the upstream ' +
          'identity provider, which remains the authority on which grants ' +
          'and client authentication methods are accepted. Successful ' +
          'client_credentials and refresh_token grants may be served from ' +
          'cache.',
        consumes: ['application/x-www-form-urlencoded'],
        response: {
          200: OAuth2TokenResponseSchema,
          400: OAuth2ErrorResponseSchema,
          401: OAuth2ErrorResponseSchema,
          403: OAuth2ErrorResponseSchema,
          429: OAuth2ErrorResponseSchema,
          500: OAuth2ErrorResponseSchema,
          503: OAuth2ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Content-type parser already gives us Record<string, string>
      const body = request.body as Record<string, string>;
      const grantType = body.grant_type ?? '';
      const authorization = request.headers.authorization;

      // Every grant Hydra supports is forwarded. This endpoint is advertised
      // as the token endpoint, so an allowlist here would silently break any
      // grant Hydra gains later; Hydra stays the authority on what is valid.
      const policy = GRANT_CACHE_POLICY[grantType];
      const cacheKey = grantCacheKey(body, authorization);

      const resolved = await grantCache.resolve(cacheKey, async () => {
        const upstreamHeaders: Record<string, string> = {
          'Content-Type': 'application/x-www-form-urlencoded',
        };
        // client_secret_basic and private_key_jwt carry the client's identity
        // here; dropping it silently broke both.
        if (authorization) upstreamHeaders.Authorization = authorization;
        const dpop = request.headers.dpop;
        if (typeof dpop === 'string') upstreamHeaders.DPoP = dpop;

        let upstreamResponse: Response;
        try {
          upstreamResponse = await fetch(`${hydraPublicUrl}/oauth2/token`, {
            method: 'POST',
            headers: upstreamHeaders,
            body: new URLSearchParams(body).toString(),
          });
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : String(error);
          fastify.log.error({ error }, 'Hydra token endpoint unreachable');
          metrics.recordExchange('rest-proxy', grantType, 'unavailable');
          throw createProblem(
            'upstream-error',
            `Token endpoint unreachable: ${message}`,
          );
        }

        let responseBody: unknown;
        try {
          responseBody = await upstreamResponse.json();
        } catch {
          fastify.log.error('Failed to parse JSON from Hydra token endpoint');
          metrics.recordExchange('rest-proxy', grantType, 'unavailable');
          throw createProblem(
            'upstream-error',
            'Token endpoint returned invalid JSON response',
          );
        }

        const status = upstreamResponse.status;
        const grant = responseBody as HydraResponse;
        const expiresIn = (grant as HydraTokenSuccess).expires_in;
        metrics.recordExchange(
          'rest-proxy',
          grantType,
          status === 200 ? 'success' : 'invalid',
        );

        // Headers Hydra uses to drive the client's next step must survive the
        // proxy, or DPoP nonce negotiation and 401 challenges break.
        const passthroughHeaders: Record<string, string> = {};
        for (const name of ['dpop-nonce', 'www-authenticate']) {
          const value = upstreamResponse.headers?.get?.(name);
          if (value) passthroughHeaders[name] = value;
        }

        const value = { status, body: grant, headers: passthroughHeaders };

        // Omitting expiresAt tells the cache not to store this. Errors are
        // never cached, and neither is any grant outside the policy.
        if (status !== 200 || typeof expiresIn !== 'number' || !policy) {
          return { value };
        }
        const cappedSeconds =
          policy.maxSeconds === undefined
            ? expiresIn
            : Math.min(expiresIn, policy.maxSeconds);
        return entryFromExpiresIn(value, cappedSeconds, expiryBufferSeconds);
      });

      for (const [name, value] of Object.entries(resolved.value.headers)) {
        void reply.header(name, value);
      }

      // A grant served from cache must report the life it has left. A freshly
      // minted one is forwarded verbatim: the token really is valid for the
      // lifetime Hydra returned, and our expiry buffer is a cache policy, not
      // a property of the token.
      const payload =
        resolved.origin === 'hit' &&
        resolved.remainingSeconds !== null &&
        resolved.value.status === 200
          ? {
              ...(resolved.value.body as HydraTokenSuccess),
              expires_in: resolved.remainingSeconds,
            }
          : resolved.value.body;

      // Forward Hydra's status and body transparently. Error responses match
      // Hydra's errorOAuth2 schema, not ProblemDetails.
      // Cast: Hydra is the authority on status, and Fastify forwards any
      // numeric code at runtime. The declared set above covers what Hydra
      // actually returns and is what the published OpenAPI documents.
      return reply
        .status(resolved.value.status as 200 | 400 | 401 | 403 | 429 | 500 | 503)
        .send(payload as HydraResponse);
    },
  );
}
