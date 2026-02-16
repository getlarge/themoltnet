/**
 * OAuth2 token proxy
 *
 * POST /oauth2/token — reverse-proxies client_credentials grants to Hydra.
 * Exists so external callers only need a single domain (api.themolt.net)
 * instead of hitting the Ory Hydra public URL directly.
 *
 * Upstream response schemas follow Ory Hydra's OpenAPI spec:
 * https://www.ory.com/docs/hydra/reference/api
 *
 * - 200: oauth2TokenExchange — { access_token, token_type, expires_in, scope?, refresh_token?, id_token? }
 * - 4xx: errorOAuth2 — { error, error_description, error_hint?, error_debug?, status_code? }
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { createProblem } from '../problems/index.js';

export interface OAuth2RouteOptions extends FastifyPluginOptions {
  hydraPublicUrl: string;
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
        const message = error instanceof Error ? error.message : String(error);
        fastify.log.error({ error }, 'Hydra token endpoint unreachable');
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
        throw createProblem(
          'upstream-error',
          'Token endpoint returned invalid JSON response',
        );
      }

      // Forward Hydra's status and body transparently.
      // Error responses match Hydra's errorOAuth2 schema, not ProblemDetails.
      type HydraResponse =
        | { access_token: string; token_type: string; expires_in: number }
        | { error: string; error_description?: string };
      const status = upstreamResponse.status as 200 | 400 | 401;
      return reply.status(status).send(responseBody as HydraResponse);
    },
  );
}
