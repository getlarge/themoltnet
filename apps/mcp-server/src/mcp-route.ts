/**
 * The MCP Streamable HTTP endpoint, served by `@modelcontextprotocol/server`.
 *
 * Stateless: every request builds a fresh server from the registry, so no
 * session store or message broker is needed and any instance can answer any
 * request. Clients on the 2025 protocol revisions are served through the
 * SDK's stateless legacy path.
 *
 * Authentication happens here, before the SDK sees the request. A missing or
 * invalid token gets the SDK's RFC 6750 challenge (401 with
 * `WWW-Authenticate` pointing at the protected resource metadata), which is
 * how clients discover where to sign in.
 */
import {
  type AuthInfo,
  bearerAuthChallengeResponse,
  createMcpHandler,
  type OAuthTokenVerifier,
  verifyBearerToken,
} from '@modelcontextprotocol/server';
import { setRequestContextField } from '@moltnet/observability';
import type { FastifyInstance, FastifyRequest } from 'fastify';

import type { McpRegistry } from './mcp-registry.js';

export interface McpRouteAuth {
  verifier: OAuthTokenVerifier;
  /** RFC 9728 metadata URL advertised in challenges. */
  resourceMetadataUrl: string;
}

export interface McpRouteOptions {
  registry: McpRegistry;
  serverInfo: { name: string; version: string };
  /** Omit to disable authorization (local development). */
  auth?: McpRouteAuth;
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(', ') : value);
  }
  const hasBody = request.method === 'POST' && request.body !== undefined;
  return new Request(`${request.protocol}://${request.host}${request.url}`, {
    method: request.method,
    headers,
    ...(hasBody
      ? {
          body:
            typeof request.body === 'string'
              ? request.body
              : JSON.stringify(request.body),
        }
      : {}),
  });
}

/**
 * Without authorization, forward whatever bearer token arrived so tools can
 * still call the REST API, which validates it. Nothing is trusted here.
 */
function unverifiedBearer(header: string | undefined): AuthInfo | undefined {
  if (!header?.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token ? { token, clientId: '', scopes: [] } : undefined;
}

export function registerMcpRoute(
  app: FastifyInstance,
  { registry, serverInfo, auth }: McpRouteOptions,
): void {
  const handler = createMcpHandler(() => registry.createServer(serverInfo), {
    legacy: 'stateless',
    onerror: (error) => app.log.error({ err: error }, 'MCP request failed'),
  });

  app.addHook('onClose', () => handler.close());

  app.route({
    method: ['GET', 'POST', 'DELETE'],
    url: '/mcp',
    handler: async (request, reply) => {
      let authInfo: AuthInfo | undefined;
      if (auth) {
        try {
          authInfo = await verifyBearerToken(request.headers.authorization, {
            verifier: auth.verifier,
            resourceMetadataUrl: auth.resourceMetadataUrl,
          });
        } catch (error) {
          request.log.warn({ err: error }, 'MCP token validation failed');
          return reply.send(
            bearerAuthChallengeResponse(error, {
              resourceMetadataUrl: auth.resourceMetadataUrl,
            }),
          );
        }
        const sub = authInfo.extra?.sub;
        if (typeof sub === 'string') setRequestContextField('identityId', sub);
        if (authInfo.clientId) {
          setRequestContextField('clientId', authInfo.clientId);
        }
      } else {
        authInfo = unverifiedBearer(request.headers.authorization);
      }

      const response = await handler.fetch(toWebRequest(request), {
        authInfo,
        parsedBody: request.body,
      });
      return reply.send(response);
    },
  });
}
