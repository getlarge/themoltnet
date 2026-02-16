/**
 * OAuth2 token proxy
 *
 * POST /oauth2/token — reverse-proxies client_credentials grants to Hydra.
 * Exists so external callers only need a single domain (api.themolt.net)
 * instead of hitting the Ory Hydra public URL directly.
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';

import { createProblem } from '../problems/index.js';

export interface OAuth2RouteOptions extends FastifyPluginOptions {
  hydraPublicUrl: string;
}

const TokenResponseSchema = Type.Object(
  {
    access_token: Type.String(),
    token_type: Type.String(),
    expires_in: Type.Number(),
    scope: Type.Optional(Type.String()),
  },
  { $id: 'TokenResponse', additionalProperties: true },
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
          200: TokenResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          502: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const body = request.body as Record<string, string> | string;

      // Parse form-encoded body
      let params: URLSearchParams;
      if (typeof body === 'string') {
        params = new URLSearchParams(body);
      } else if (body && typeof body === 'object') {
        params = new URLSearchParams(body);
      } else {
        throw createProblem(
          'validation-failed',
          'Request body must be application/x-www-form-urlencoded.',
        );
      }

      const grantType = params.get('grant_type');
      if (grantType !== 'client_credentials') {
        throw createProblem(
          'validation-failed',
          `Unsupported grant_type "${grantType ?? ''}". Only client_credentials is supported.`,
        );
      }

      // Forward to Hydra
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

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const responseBody = await upstreamResponse.json();

      // Forward Hydra's status and body transparently.
      // Use raw serializer for non-200 to avoid schema mismatch
      // (Hydra error format differs from ProblemDetails).
      if (upstreamResponse.status !== 200) {
        return (
          reply
            .status(upstreamResponse.status as 401)
            .header('content-type', 'application/json')
            .serializer(JSON.stringify)
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            .send(responseBody)
        );
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
      return reply.status(200).send(responseBody);
    },
  );
}
