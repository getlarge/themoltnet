import { mcpAuthProxyPlugin } from '@moltnet/mcp-auth-proxy';
import { MCP_M2M_SCOPES } from '@moltnet/models';
import type { ObservabilityContext } from '@moltnet/observability';
import { observabilityPlugin } from '@moltnet/observability';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  type McpServerConfig,
  resolveHydraUrls,
  resolveMcpAppConfig,
} from './config.js';
import { registerCryptoTools } from './crypto-tools.js';
import { registerDiaryTools } from './diary-tools.js';
import { registerEntryExploreApp } from './entry-explore-app.js';
import { registerGrantTools } from './grant-tools.js';
import { createHydraTokenVerifier } from './hydra-token-verifier.js';
import { registerIdentityTools } from './identity-tools.js';
import { McpRegistry } from './mcp-registry.js';
import { registerMcpRoute } from './mcp-route.js';
import { registerPackTools } from './pack-tools.js';
import { registerPrompts } from './prompts.js';
import { registerRelationTools } from './relation-tools.js';
import { requestContextPlugin } from './request-context-plugin.js';
import { registerResources } from './resources.js';
import { registerTaskApp } from './task-app.js';
import { registerTaskTools } from './task-tools.js';
import { registerTeamTools } from './team-tools.js';
import type { McpDeps } from './types.js';
import { registerProtectedResourceMetadata } from './well-known-metadata.js';

const OPENAI_APPS_CHALLENGE_PATH = '/.well-known/openai-apps-challenge';

export interface AppOptions {
  config: McpServerConfig;
  deps: McpDeps;
  version?: string;
  logger?: boolean | object;
  observability?: ObservabilityContext;
}

export type McpAuthConfig =
  | { enabled: false }
  | {
      enabled: true;
      /** Protected resource URI advertised in metadata and challenges. */
      resourceUri: string;
      /** Public issuer(s) clients are sent to for authorization. */
      authorizationServers: string[];
      jwksUri: string;
      /** Hydra admin introspection, used when JWT verification fails. */
      introspection?: { endpoint: string; bearerToken: string };
    };

export function buildAuthConfig(config: McpServerConfig): McpAuthConfig {
  const authEnabled = config.AUTH_ENABLED === true;
  const hydra = resolveHydraUrls(config);

  if (!authEnabled || !hydra) {
    return { enabled: false };
  }

  return {
    enabled: true,
    resourceUri: config.MCP_RESOURCE_URI ?? `http://localhost:${config.PORT}`,
    authorizationServers: [hydra.publicUrl],
    jwksUri:
      config.ORY_HYDRA_JWKS_URL ?? `${hydra.publicUrl}/.well-known/jwks.json`,
    ...(hydra.apiKey
      ? {
          introspection: {
            endpoint: `${hydra.adminUrl}/admin/oauth2/introspect`,
            bearerToken: hydra.apiKey,
          },
        }
      : {}),
  };
}

function registerMcpCors(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    const origin = request.headers.origin;
    if (!origin) {
      done();
      return;
    }

    // MCP app hosts are user-controlled and not enumerable ahead of time, so
    // reflect the browser Origin while keeping authorization mandatory on MCP
    // requests.
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    reply.header('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
    reply.header(
      'Access-Control-Allow-Headers',
      [
        'Accept',
        'Authorization',
        'Cache-Control',
        'Content-Type',
        'Mcp-Protocol-Version',
        'Mcp-Session-Id',
        'X-Client-Id',
        'X-Client-Secret',
        'X-Requested-With',
      ].join(', '),
    );
    reply.header(
      'Access-Control-Expose-Headers',
      'Mcp-Protocol-Version, Mcp-Session-Id',
    );
    reply.header('Access-Control-Max-Age', '3600');

    if (request.method === 'OPTIONS') {
      reply.status(204).send();
      return;
    }

    done();
  });
}

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const {
    config,
    deps,
    version = '0.0.0',
    logger = true,
    observability,
  } = options;

  const app = (
    observability?.logger
      ? Fastify({ loggerInstance: observability.logger })
      : Fastify({ logger })
  ) as FastifyInstance;
  deps.logger = app.log;
  deps.consoleBaseUrl = config.CONSOLE_BASE_URL;

  registerMcpCors(app);

  // Register @fastify/otel BEFORE routes for full lifecycle tracing
  if (observability?.fastifyOtelPlugin) {
    await app.register(observability.fastifyOtelPlugin);
  }

  // Health checks (excluded from auth)
  app.get('/healthz', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  app.get(OPENAI_APPS_CHALLENGE_PATH, (_request, reply) => {
    if (!config.OPENAI_APPS_CHALLENGE_TOKEN) {
      return reply.status(404).send();
    }

    return reply
      .type('text/plain; charset=utf-8')
      .send(config.OPENAI_APPS_CHALLENGE_TOKEN);
  });

  app.get('/healthz/ready', async (request, reply) => {
    const probe = async (
      name: string,
      url: string,
    ): Promise<{
      status: 'ok' | 'error';
      latencyMs: number;
      error?: string;
    }> => {
      const start = performance.now();
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) {
          return {
            status: 'error',
            latencyMs: Math.round(performance.now() - start),
            error: `http_${res.status}`,
          };
        }
        return {
          status: 'ok',
          latencyMs: Math.round(performance.now() - start),
        };
      } catch (err) {
        request.log.warn({ err, probe: name }, 'Readiness probe failed');
        const isTimeout =
          err instanceof Error &&
          (err.name === 'AbortError' || err.message.includes('timeout'));
        const isConnErr =
          err instanceof Error &&
          (err.message.includes('ECONNREFUSED') ||
            err.message.includes('ENOTFOUND') ||
            err.message.includes('fetch failed'));
        return {
          status: 'error',
          latencyMs: Math.round(performance.now() - start),
          error: isTimeout
            ? 'timeout'
            : isConnErr
              ? 'connection_failed'
              : 'unavailable',
        };
      }
    };

    const [restApi, ory] = await Promise.all([
      probe('rest-api', new URL('/health', config.REST_API_URL).toString()),
      config.ORY_PROJECT_URL
        ? probe(
            'ory',
            new URL(
              '/.well-known/openid-configuration',
              config.ORY_PROJECT_URL,
            ).toString(),
          )
        : {
            status: 'error' as const,
            latencyMs: 0,
            error: 'not_configured',
          },
    ]);

    const allOk = restApi.status === 'ok' && ory.status === 'ok';
    const body = {
      status: allOk ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      components: { restApi, ory },
    };

    return reply.status(allOk ? 200 : 503).send(body);
  });

  // Register client_credentials proxy (before the MCP route so it can inject Bearer tokens)
  const proxyEnabled =
    config.CLIENT_CREDENTIALS_PROXY === true && !!config.ORY_PROJECT_URL;
  if (proxyEnabled) {
    await app.register(mcpAuthProxyPlugin, {
      // Resolved from OIDC discovery, which now advertises the MoltNet proxy
      // (webfinger.oidc_discovery.token_url, issue #1860). Deliberately not
      // hardcoded: discovery is the contract, so if the advertised endpoint
      // ever changes — including reverting the flip — this follows it instead
      // of silently disagreeing with what every other client is told.
      oidcDiscoveryUrl: `${config.ORY_PROJECT_URL}/.well-known/openid-configuration`,
      scopes: [...MCP_M2M_SCOPES],
    });
    app.log.info('Client credentials proxy enabled');
  }

  const authorization = buildAuthConfig(config);
  if (authorization.enabled) {
    app.log.info(
      {
        authorizationServers: authorization.authorizationServers,
        resourceUri: authorization.resourceUri,
      },
      'OAuth2 authorization enabled',
    );
    registerProtectedResourceMetadata(app, authorization);
  } else {
    app.log.info('OAuth2 authorization disabled');
  }

  const mcpAppConfig = resolveMcpAppConfig(config);
  if (mcpAppConfig) {
    app.log.info(
      {
        domain: mcpAppConfig.domain,
        connectDomains: mcpAppConfig.connectDomains,
        resourceDomains: mcpAppConfig.resourceDomains,
        frameDomains: mcpAppConfig.frameDomains,
      },
      'MCP app configuration applied',
    );
  } else {
    app.log.info('No MCP app configuration found');
  }

  await app.register(requestContextPlugin);

  const registry = new McpRegistry({
    resourceUri: authorization.enabled ? authorization.resourceUri : undefined,
    mcpAppConfig: mcpAppConfig ?? undefined,
  });
  registerDiaryTools(registry, deps);
  registerCryptoTools(registry, deps);
  registerIdentityTools(registry, deps);
  registerRelationTools(registry, deps);
  registerPackTools(registry, deps);
  registerGrantTools(registry, deps);
  registerTeamTools(registry, deps);
  registerTaskTools(registry, deps);
  registerTaskApp(registry, deps);
  registerEntryExploreApp(registry);
  registerResources(registry, deps);
  registerPrompts(registry, deps);

  registerMcpRoute(app, {
    registry,
    serverInfo: { name: 'moltnet', version },
    ...(authorization.enabled
      ? {
          auth: {
            verifier: createHydraTokenVerifier({
              jwksUri: authorization.jwksUri,
              introspection: authorization.introspection,
              onJwtFailure: (err) =>
                app.log.warn(
                  { err },
                  'JWT validation failed, trying introspection',
                ),
            }),
            resourceMetadataUrl: `${authorization.resourceUri.replace(/\/+$/, '')}/.well-known/oauth-protected-resource`,
          },
        }
      : {}),
  });

  // Register observability metrics plugin + shutdown hook
  if (observability) {
    await app.register(observabilityPlugin, {
      serviceName: 'moltnet-mcp',
      shutdown: observability.shutdown,
    });
  }

  return app;
}
