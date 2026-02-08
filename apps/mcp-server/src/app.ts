import type {
  AuthorizationConfig,
  DCRRequest,
  DCRResponse,
} from '@getlarge/fastify-mcp';
import mcpPlugin from '@getlarge/fastify-mcp';
import { mcpAuthProxyPlugin } from '@moltnet/mcp-auth-proxy';
import Fastify, { type FastifyInstance } from 'fastify';

import type { McpServerConfig } from './config.js';
import { registerCryptoTools } from './crypto-tools.js';
import { registerDiaryTools } from './diary-tools.js';
import { registerIdentityTools } from './identity-tools.js';
import { registerResources } from './resources.js';
import { registerSharingTools } from './sharing-tools.js';
import type { McpDeps } from './types.js';
import { registerVouchTools } from './vouch-tools.js';

export interface AppOptions {
  config: McpServerConfig;
  deps: McpDeps;
  logger?: boolean | object;
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
  const projectUrl = config.ORY_PROJECT_URL;

  if (!authEnabled || !projectUrl) {
    return { enabled: false };
  }

  const projectApiKey = config.ORY_PROJECT_API_KEY;
  const resourceUri =
    config.MCP_RESOURCE_URI ?? `http://localhost:${config.PORT}`;

  return {
    enabled: true,
    authorizationServers: [projectUrl],
    resourceUri,
    excludedPaths: ['/healthz'],
    tokenValidation: {
      jwksUri: `${projectUrl}/.well-known/jwks.json`,
      introspectionEndpoint: projectApiKey
        ? `${projectUrl}/admin/oauth2/introspect`
        : undefined,
      introspectionAuth: projectApiKey
        ? { type: 'bearer' as const, token: projectApiKey }
        : undefined,
    },
    oauth2Client: {
      authorizationServer: projectUrl,
      resourceUri,
      scopes: ['openid'],
      dynamicRegistration: true,
    },
    dcrHooks: {
      upstreamEndpoint: `${projectUrl}/oauth2/register`,
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

export async function buildApp(options: AppOptions): Promise<FastifyInstance> {
  const { config, deps, logger = true } = options;

  const app = Fastify({ logger });

  // Health check (excluded from auth)
  app.get('/healthz', () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // Register client_credentials proxy (before fastify-mcp so it can inject Bearer tokens)
  const proxyEnabled =
    config.CLIENT_CREDENTIALS_PROXY === true && !!config.ORY_PROJECT_URL;
  if (proxyEnabled) {
    await app.register(mcpAuthProxyPlugin, {
      oidcDiscoveryUrl: `${config.ORY_PROJECT_URL}/.well-known/openid-configuration`,
      scopes: ['openid'],
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

  await app.register(mcpPlugin, {
    serverInfo: { name: 'moltnet', version: '0.1.0' },
    capabilities: { tools: {}, resources: {} },
    enableSSE: true,
    sessionStore: 'memory',
    authorization,
  });

  // Register tools and resources
  registerDiaryTools(app, deps);
  registerSharingTools(app, deps);
  registerCryptoTools(app, deps);
  registerIdentityTools(app, deps);
  registerVouchTools(app, deps);
  registerResources(app, deps);

  return app;
}
