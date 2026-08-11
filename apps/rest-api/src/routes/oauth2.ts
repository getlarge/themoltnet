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
}

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

/**
 * Cache key for a grant.
 *
 * Every parameter that can change the resulting token participates, so a
 * token minted for one scope, audience or secret can never be served to a
 * request asking for another. The secret is hashed, never stored.
 */
function grantCacheKey(body: Record<string, string>): string {
  const secretHash = createHash('sha256')
    .update(body.client_secret ?? '')
    .digest('hex');
  return [
    body.grant_type ?? '',
    body.client_id ?? '',
    secretHash,
    body.scope ?? '',
    body.audience ?? '',
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
  { $id: 'OAuth2ErrorResponse' },
);

export async function oauth2Routes(
  fastify: FastifyInstance,
  options: OAuth2RouteOptions,
) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const { hydraPublicUrl } = options;
  const expiryBufferSeconds = options.expiryBufferSeconds ?? 30;
  const metrics = options.metrics ?? createTokenExchangeMetrics();

  // Expiry, single-flight and cache metrics come from the shared primitive,
  // the same one the MCP proxy uses. Default store is process-local, so it is
  // per machine and lost on deploy — pass a Redis-backed CacheStore once
  // rest-api scales past one instance (issue #1860).
  const grantCache = createSingleFlightCache<{
    status: number;
    body: HydraResponse;
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
          'Exchange OAuth2 client credentials for an access token. ' +
          'Only the client_credentials grant type is supported. ' +
          'Proxies the request to the upstream identity provider.',
        consumes: ['application/x-www-form-urlencoded'],
        response: {
          200: OAuth2TokenResponseSchema,
          400: OAuth2ErrorResponseSchema,
          401: OAuth2ErrorResponseSchema,
        },
      },
    },
    async (request, reply) => {
      // Content-type parser already gives us Record<string, string>
      const body = request.body as Record<string, string>;

      const grantType = body.grant_type;
      if (grantType !== 'client_credentials') {
        return reply.status(400).send({
          error: 'unsupported_grant_type',
          error_description:
            `Unsupported grant_type "${grantType ?? ''}". ` +
            'Only client_credentials is supported.',
        });
      }

      // Serve an unexpired token for identical credentials and parameters
      // without touching Hydra. Every upstream call is a billed M2M token
      // (issue #1860), and the CLI re-authenticates on every process start so
      // its own in-memory cache never hits.
      const resolved = await grantCache.resolve(grantCacheKey(body), async () => {
        // Forward to Hydra as form-encoded
        const params = new URLSearchParams(body);
        let upstreamResponse: Response;
        try {
          upstreamResponse = await fetch(`${hydraPublicUrl}/oauth2/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
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

        // Omitting expiresAt tells the cache not to store this. Error
        // responses must never be replayed — rotated credentials have to
        // reach Hydra on the next attempt.
        if (status !== 200 || typeof expiresIn !== 'number') {
          return { value: { status, body: grant } };
        }
        return entryFromExpiresIn(
          { status, body: grant },
          expiresIn,
          expiryBufferSeconds,
        );
      });

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

      // Forward Hydra's status and body transparently.
      // Error responses match Hydra's errorOAuth2 schema, not ProblemDetails.
      return reply
        .status(resolved.value.status as 200 | 400 | 401)
        .send(payload);
    },
  );
}
