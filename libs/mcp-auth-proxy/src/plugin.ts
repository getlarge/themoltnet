import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

import { MemoryTokenCache } from './cache/memory.js';
import {
  createTokenExchanger,
  discoverTokenEndpoint,
  type TokenExchanger,
} from './token-exchange.js';
import type { McpAuthProxyOptions } from './types.js';

const DEFAULT_EXPIRY_BUFFER_SECONDS = 30;
const DEFAULT_MAX_FAILURES = 5;
const DEFAULT_COOLDOWN_MS = 60_000;
const DEFAULT_CLIENT_ID_HEADER = 'x-client-id';
const DEFAULT_CLIENT_SECRET_HEADER = 'x-client-secret';

export const mcpAuthProxyPlugin = fp(
  async function mcpAuthProxyPluginImpl(
    fastify: FastifyInstance,
    opts: McpAuthProxyOptions,
  ) {
    let tokenEndpoint: string;
    if (opts.tokenEndpoint) {
      tokenEndpoint = opts.tokenEndpoint;
    } else if (opts.oidcDiscoveryUrl) {
      tokenEndpoint = await discoverTokenEndpoint(opts.oidcDiscoveryUrl);
      fastify.log.info({ tokenEndpoint }, 'Discovered token endpoint via OIDC');
    } else {
      throw new Error(
        '@moltnet/mcp-auth-proxy: either tokenEndpoint or oidcDiscoveryUrl must be provided',
      );
    }

    const cache = opts.cache ?? new MemoryTokenCache();
    const expiryBufferSeconds =
      opts.expiryBufferSeconds ?? DEFAULT_EXPIRY_BUFFER_SECONDS;
    const maxFailures = opts.rateLimit?.maxFailures ?? DEFAULT_MAX_FAILURES;
    const cooldownMs = opts.rateLimit?.cooldownMs ?? DEFAULT_COOLDOWN_MS;

    const clientIdHeader = (
      opts.clientHeaderNames?.clientId ?? DEFAULT_CLIENT_ID_HEADER
    ).toLowerCase();
    const clientSecretHeader = (
      opts.clientHeaderNames?.clientSecret ?? DEFAULT_CLIENT_SECRET_HEADER
    ).toLowerCase();

    const exchanger: TokenExchanger = createTokenExchanger({
      tokenEndpoint,
      scopes: opts.scopes,
      audience: opts.audience,
      expiryBufferSeconds,
      cache,
      rateLimit: { maxFailures, cooldownMs },
      log: fastify.log,
    });

    fastify.addHook('onRequest', async (request, reply) => {
      if (request.headers.authorization) return;

      const clientId = request.headers[clientIdHeader];
      const clientSecret = request.headers[clientSecretHeader];

      if (!clientId || !clientSecret) return;
      if (typeof clientId !== 'string' || typeof clientSecret !== 'string') {
        return;
      }

      try {
        const token = await exchanger.exchange(clientId, clientSecret);
        request.headers.authorization = `Bearer ${token}`;
      } catch (err) {
        const error = err as Error & {
          statusCode?: number;
          code?: string;
          detail?: string;
        };
        reply.code(error.statusCode ?? 502).send({
          error: error.code ?? 'BAD_GATEWAY',
          message: error.detail ?? error.message,
        });
        return reply;
      }

      delete request.headers[clientIdHeader];
      delete request.headers[clientSecretHeader];
    });

    fastify.addHook('onClose', async () => {
      exchanger.close();
      await cache.close();
    });
  },
  {
    name: '@moltnet/mcp-auth-proxy',
    fastify: '5.x',
  },
);
