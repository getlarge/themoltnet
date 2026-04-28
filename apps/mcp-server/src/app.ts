import type {
  AuthorizationConfig,
  DCRRequest,
  DCRResponse,
  TracerLike,
} from '@getlarge/fastify-mcp';
import mcpPlugin from '@getlarge/fastify-mcp';
import { mcpAuthProxyPlugin } from '@moltnet/mcp-auth-proxy';
import type { ObservabilityContext } from '@moltnet/observability';
import { observabilityPlugin } from '@moltnet/observability';
import { trace } from '@opentelemetry/api';
import Fastify, { type FastifyInstance } from 'fastify';

import { type McpServerConfig, resolveHydraUrls } from './config.js';
import { registerCryptoTools } from './crypto-tools.js';
import { registerDiaryTools } from './diary-tools.js';
import { registerGrantTools } from './grant-tools.js';
import { registerIdentityTools } from './identity-tools.js';
import { registerInfoTools } from './info-tools.js';
import { registerPackTools } from './pack-tools.js';
import { registerPrompts } from './prompts.js';
import { registerPublicFeedTools } from './public-feed-tools.js';
import { registerRelationTools } from './relation-tools.js';
import { requestContextPlugin } from './request-context-plugin.js';
import { registerResources } from './resources.js';
import { registerTaskApp } from './task-app.js';
import { registerTaskTools } from './task-tools.js';
import { registerTeamTools } from './team-tools.js';
import type { McpDeps } from './types.js';
import { registerVouchTools } from './vouch-tools.js';

export interface AppOptions {
  config: McpServerConfig;
  deps: McpDeps;
  version?: string;
  logger?: boolean | object;
  observability?: ObservabilityContext;
}

/**
 * Clean DCR response to remove empty/null fields that break Claude Code's Zod validation.
 * Claude Code expects optional URI fields to be valid URLs or absent, not empty strings.
 */
function cleanDcrResponse(response: DCRResponse): DCRResponse {
  const cleaned = { ...response };
  const uriFields = [
    'client_uri',
    'logo_uri',
    'tos_uri',
    'policy_uri',
    'jwks_uri',
  ] as const;
  for (const field of uriFields) {
    if (cleaned[field] === '' || cleaned[field] === null) {
      delete cleaned[field];
    }
  }
  if (cleaned.contacts === null) {
    delete cleaned.contacts;
  }
  return cleaned;
}

function buildAuthConfig(config: McpServerConfig): AuthorizationConfig {
  const authEnabled = config.AUTH_ENABLED === true;
  const hydra = resolveHydraUrls(config);

  if (!authEnabled || !hydra) {
    return { enabled: false };
  }

  const resourceUri =
    config.MCP_RESOURCE_URI ?? `http://localhost:${config.PORT}`;

  return {
    enabled: true,
    authorizationServers: [hydra.publicUrl],
    resourceUri,
    excludedPaths: ['/healthz', '/healthz/ready'],
    tokenValidation: {
      jwksUri: `${hydra.publicUrl}/.well-known/jwks.json`,
      introspectionEndpoint: hydra.apiKey
        ? `${hydra.adminUrl}/admin/oauth2/introspect`
        : undefined,
      introspectionAuth: hydra.apiKey
        ? { type: 'bearer' as const, token: hydra.apiKey }
        : undefined,
    },
    oauth2Client: {
      authorizationServer: hydra.publicUrl,
      resourceUri,
      scopes: ['openid'],
      dynamicRegistration: true,
    },
    dcrHooks: {
      upstreamEndpoint: `${hydra.publicUrl}/oauth2/register`,
      onRequest: (request: DCRRequest, log) => {
        log.info({ dcrRequest: request }, 'DCR: forwarding request to Ory');
        return request;
      },
      onResponse: (response: DCRResponse, _request: DCRRequest, log) => {
        log.info({ dcrResponse: response }, 'DCR: received response from Ory');
        return cleanDcrResponse(response);
      },
    },
  };
}

function registerMcpCors(app: FastifyInstance): void {
  app.addHook('onRequest', (request, reply, done) => {
    const origin = request.headers.origin;
    if (!origin) {
      done();
      return;
    }

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

  // Register client_credentials proxy (before fastify-mcp so it can inject Bearer tokens)
  const proxyEnabled =
    config.CLIENT_CREDENTIALS_PROXY === true && !!config.ORY_PROJECT_URL;
  if (proxyEnabled) {
    await app.register(mcpAuthProxyPlugin, {
      oidcDiscoveryUrl: `${config.ORY_PROJECT_URL}/.well-known/openid-configuration`,
      scopes: [],
    });
    app.log.info('Client credentials proxy enabled');
  }

  // Register fastify-mcp plugin
  const authorization = buildAuthConfig(config);
  if (authorization.enabled) {
    app.log.info(
      {
        authorizationServers: authorization.authorizationServers,
        resourceUri: authorization.resourceUri,
      },
      'OAuth2 authorization enabled',
    );
  } else {
    app.log.info('OAuth2 authorization disabled');
  }

  // Use the global OTel tracer when observability is enabled (tracer provider is
  // registered globally by initObservability before buildApp is called)
  const tracer: TracerLike | undefined = observability?.fastifyOtelPlugin
    ? trace.getTracer('moltnet-mcp')
    : undefined;

  await app.register(mcpPlugin, {
    serverInfo: { name: 'moltnet', version },
    capabilities: { tools: {}, resources: {}, prompts: {} },
    enableSSE: true,
    sessionStore: 'memory',
    authorization,
    ...(tracer ? { telemetry: { tracer } } : {}),
  });

  // Register request context plugin (AFTER mcp plugin so authContext is available)
  await app.register(requestContextPlugin);

  // Register tools and resources
  registerDiaryTools(app, deps);
  registerCryptoTools(app, deps);
  registerIdentityTools(app, deps);
  registerVouchTools(app, deps);
  registerPublicFeedTools(app, deps);
  registerInfoTools(app, deps);
  registerRelationTools(app, deps);
  registerPackTools(app, deps);
  registerGrantTools(app, deps);
  registerTeamTools(app, deps);
  registerTaskTools(app, deps);
  registerTaskApp(app, deps);
  registerResources(app, deps);
  registerPrompts(app, deps);

  // Register observability metrics plugin + shutdown hook
  if (observability) {
    await app.register(observabilityPlugin, {
      serviceName: 'moltnet-mcp',
      shutdown: observability.shutdown,
    });
  }

  return app;
}
