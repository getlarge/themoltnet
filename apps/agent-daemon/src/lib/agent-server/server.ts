/**
 * HTTP surface of `moltnet-agent server` (#2061), built on the shared
 * loopback-companion security profile (#2066): loopback Host enforcement,
 * exact-origin CORS, Fetch-Metadata guards, strict JSON parsing.
 *
 * Everything under `/v1` except the pairing bootstrap requires a paired
 * origin: the `x-moltnet-agent-server-token` header must verify against the
 * origin-bound token issued by the one-click pairing ceremony.
 */
import { constants as fsConstants } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

import rateLimit from '@fastify/rate-limit';
import {
  assertNavigationRequest,
  isLoopbackViolation,
  registerLoopbackSecurity,
  rejectExplicitCrossSite,
  requireOriginHeader,
} from '@moltnet/loopback-companion';
import {
  formatSecretReferenceString,
  parseSecretReferenceString,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  FILE_SECRET_PROVIDER,
  type FileSecretProvider,
} from '@themoltnet/sdk/node';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';

import {
  AgentServerIdentityError,
  attachExternalAgent,
  createManagedAgent,
  publicAgentView,
  reconcileManagedRegistration,
} from './identity.js';
import {
  AgentServerModelDiscoveryError,
  type DiscoveryFailure,
  MAX_DISCOVERED_MODELS,
  ModelDiscoveryCollector,
  parseProviderBaseUrl,
} from './model-discovery.js';
import {
  AgentServerPairingError,
  type PairingService,
  renderPairingApprovalPage,
  renderPairingResultPage,
} from './pairing.js';
import { AGENT_SERVER_SCHEMAS, AgentServerRouteSchemas } from './protocol.js';
import {
  AgentServerSubscriptionError,
  type ProviderLoginService,
} from './provider-login.js';
import { AgentServerRunError, type RunManager } from './runs.js';
import {
  type AgentServerStore,
  AgentServerStoreError,
  assertProviderEnvName,
  assertProviderId,
  type ProviderEntry,
} from './store.js';

export const AGENT_SERVER_TOKEN_HEADER = 'x-moltnet-agent-server-token';
const BODY_LIMIT = 64 * 1024;
const LOG_POLL_INTERVAL_MS = 500;
const LOG_STREAM_MAX_DURATION_MS = 60 * 60 * 1000;
const MAX_LOG_STREAMS = 32;
const LOG_READ_LIMIT_BYTES = 256 * 1024;
const RUN_HISTORY_LIMIT = 100;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface AgentServerLogReadState {
  offset: number;
  fragment: string;
  decoder?: StringDecoder;
  discardingLine?: boolean;
}

export async function readAgentServerLogDelta(
  handle: FileHandle,
  state: AgentServerLogReadState,
  limit = LOG_READ_LIMIT_BYTES,
): Promise<{ lines: string[]; omitted: boolean }> {
  const info = await handle.stat();
  if (!info.isFile() || info.size <= state.offset) {
    return { lines: [], omitted: false };
  }

  const size = info.size;
  const start = Math.max(state.offset, size - limit);
  let omitted = start > state.offset;
  const buffer = Buffer.alloc(size - start);
  let totalRead = 0;
  while (totalRead < buffer.length) {
    const { bytesRead } = await handle.read(
      buffer,
      totalRead,
      buffer.length - totalRead,
      start + totalRead,
    );
    if (bytesRead === 0) break;
    totalRead += bytesRead;
  }
  state.offset = start + totalRead;

  if (omitted) {
    state.fragment = '';
    state.decoder = new StringDecoder('utf8');
    state.discardingLine = true;
  }
  state.decoder ??= new StringDecoder('utf8');
  let text =
    state.fragment + state.decoder.write(buffer.subarray(0, totalRead));
  state.fragment = '';
  if (state.discardingLine) {
    const boundary = text.indexOf('\n');
    if (boundary === -1) return { lines: [], omitted };
    text = text.slice(boundary + 1);
    state.discardingLine = false;
  }
  const parts = text.split('\n');
  const fragment = parts.pop() ?? '';
  const lines: string[] = [];
  for (const line of parts) {
    if (line.length > limit) {
      omitted = true;
    } else if (line.length > 0) {
      lines.push(line);
    }
  }
  if (fragment.length > limit) {
    state.discardingLine = true;
    omitted = true;
  } else {
    state.fragment = fragment;
  }
  return { lines, omitted };
}

export interface BuildAgentServerOptions {
  store: AgentServerStore;
  secrets: FileSecretProvider;
  secretProviders: SecretProviderRegistry;
  externalSecretProviders: SecretProviderRegistry;
  pairing: PairingService;
  runs: RunManager;
  subscriptions: ProviderLoginService;
  allowedOrigins: readonly string[];
  /** The Agent Server base URL origin, so the approval page may CORS to itself. */
  selfOrigin?: string;
  /** TLS credentials for the macOS loopback endpoint. */
  tls?: { key: string; cert: string };
  /** Default MoltNet API URL for newly created managed agents. */
  defaultApiUrl: string;
  version: string;
  logger?: FastifyBaseLogger;
  /** Abort in-flight identity operations during supervisor shutdown. */
  shutdownSignal?: AbortSignal;
  /** Override used by focused rate-limit tests. */
  rateLimitMax?: number;
  /** Injectable for tests: outbound fetch used for provider model discovery. */
  discoverFetch?: typeof fetch;
  /** Optional OpenAPI plugin registration used by deterministic codegen. */
  registerOpenApi?: (app: FastifyInstance) => void;
}

class AgentServerHttpError extends Error {
  override name = 'AgentServerHttpError';
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function requireBody<T extends object>(request: FastifyRequest): T {
  const body = request.body;
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new AgentServerHttpError(
      400,
      'invalid_body',
      'JSON object body required',
    );
  }
  return body as T;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentServerHttpError(
      400,
      'invalid_body',
      `"${field}" must be a non-empty string`,
    );
  }
  return value.trim();
}

function optionalString(
  body: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = body[field];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new AgentServerHttpError(
      400,
      'invalid_body',
      `"${field}" must be a non-empty string when present`,
    );
  }
  return value.trim();
}

function stringArray(
  body: Record<string, unknown>,
  field: string,
  options: { allowEmpty?: boolean } = {},
): string[] {
  const value = body[field];
  if (
    !Array.isArray(value) ||
    (!options.allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new AgentServerHttpError(
      400,
      'invalid_body',
      `"${field}" must be ${options.allowEmpty ? 'a' : 'a non-empty'} string array`,
    );
  }
  return value as string[];
}

function requestOperationSignal(
  request: FastifyRequest,
  shutdownSignal?: AbortSignal,
): AbortSignal {
  const disconnected = new AbortController();
  if (request.raw.aborted) disconnected.abort();
  else request.raw.once('aborted', () => disconnected.abort());
  return shutdownSignal
    ? AbortSignal.any([disconnected.signal, shutdownSignal])
    : disconnected.signal;
}

export function buildAgentServer(
  options: BuildAgentServerOptions,
): FastifyInstance {
  const { pairing } = options;
  const fastifyOptions = {
    bodyLimit: BODY_LIMIT,
    ...(options.tls ? { https: options.tls } : {}),
  };
  const app = options.logger
    ? Fastify({ ...fastifyOptions, loggerInstance: options.logger })
    : Fastify(fastifyOptions);

  options.registerOpenApi?.(app);
  for (const schema of AGENT_SERVER_SCHEMAS) app.addSchema(schema);

  registerLoopbackSecurity(app, {
    allowedOrigins: options.allowedOrigins,
    ...(options.selfOrigin ? { selfOrigins: [options.selfOrigin] } : {}),
    allowedHeaders: [AGENT_SERVER_TOKEN_HEADER],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  void app.register(rateLimit, {
    global: false,
    max: options.rateLimitMax ?? RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () =>
      new AgentServerHttpError(429, 'rate_limited', 'Too many requests'),
    keyGenerator: (request) => {
      const origin = request.headers.origin;
      return isConfiguredOrigin(origin, options)
        ? `origin:${origin}`
        : `ip:${request.ip}`;
    },
  });

  app.addContentTypeParser(
    'application/x-www-form-urlencoded',
    { parseAs: 'buffer' },
    (_request, body, done) => {
      try {
        const form = new TextDecoder('utf-8', { fatal: true }).decode(
          typeof body === 'string' ? Buffer.from(body) : body,
        );
        done(null, new URLSearchParams(form));
      } catch {
        done(
          new AgentServerHttpError(400, 'invalid_body', 'Form body is invalid'),
          undefined,
        );
      }
    },
  );

  const requirePairedOrigin = (request: FastifyRequest): string => {
    const origin = requireOriginHeader(request.headers);
    const token = request.headers[AGENT_SERVER_TOKEN_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      throw new AgentServerHttpError(
        401,
        'pairing_required',
        'Pairing token is required',
      );
    }
    pairing.verify(origin, token);
    return origin;
  };

  app.after(() => {
    app.addHook('onRequest', app.rateLimit());
    app.get(
      '/health',
      { schema: AgentServerRouteSchemas.health },
      async () => ({ status: 'ok' }),
    );
    registerPairingRoutes(app, pairing);
    registerStatusRoute(app, options, requirePairedOrigin);
    registerAgentRoutes(app, options, requirePairedOrigin);
    registerProviderRoutes(app, options, requirePairedOrigin);
    registerSubscriptionRoutes(app, options, requirePairedOrigin);
    registerRunRoutes(app, options, requirePairedOrigin);
  });
  app.addHook('onClose', () => {
    options.subscriptions.close();
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply
      .code(404)
      .send({ code: 'not_found', message: 'Route is not available' }),
  );
  app.setErrorHandler(async (error, request, reply) => {
    const { statusCode, code, message } = normalizeAgentServerError(error);
    if (statusCode === 500 || error instanceof AgentServerIdentityError) {
      request.log[statusCode === 500 ? 'error' : 'warn'](
        {
          ...safeErrorContext(error),
          code:
            statusCode === 500
              ? 'agent_server_request_failed'
              : 'agent_server_identity_rejected',
          method: request.method,
          route: request.routeOptions.url,
        },
        statusCode === 500
          ? 'AgentServer request failed'
          : 'AgentServer identity request rejected',
      );
    }
    return reply.code(statusCode).send({ code, message });
  });

  return app;
}

type PairedOriginGuard = (request: FastifyRequest) => string;

function registerPairingRoutes(
  app: FastifyInstance,
  pairing: PairingService,
): void {
  app.post(
    '/v1/pairings',
    { schema: AgentServerRouteSchemas.startPairing },
    async (request, reply) => {
      const origin = requireOriginHeader(request.headers);
      return reply.code(201).send(pairing.start(origin));
    },
  );
  app.get(
    '/pairings/:pairingId',
    { schema: { hide: true } },
    async (request, reply) => {
      assertNavigationRequest(request.headers);
      const { pairingId } = request.params as { pairingId: string };
      const approval = pairing.approval(pairingId);
      return reply.type('text/html; charset=utf-8').send(
        renderPairingApprovalPage({
          pairingId,
          origin: approval.origin,
          confirmToken: approval.confirmToken,
        }),
      );
    },
  );
  app.post(
    '/pairings/:pairingId/confirm',
    { schema: { hide: true } },
    async (request, reply) => {
      rejectExplicitCrossSite(request.headers);
      const { pairingId } = request.params as { pairingId: string };
      if (!(request.body instanceof URLSearchParams)) {
        throw new AgentServerHttpError(
          400,
          'invalid_body',
          'Confirmation form is invalid',
        );
      }
      const { origin } = pairing.confirm(
        pairingId,
        request.body.get('confirmToken') ?? '',
      );
      return reply.type('text/html; charset=utf-8').send(
        renderPairingResultPage({
          title: 'Connection approved',
          message: `${origin} can now manage local MoltNet agents on this machine.`,
        }),
      );
    },
  );
  app.post(
    '/v1/pairings/:pairingId/claim',
    { schema: AgentServerRouteSchemas.claimPairing },
    async (request) => {
      const origin = requireOriginHeader(request.headers);
      const { pairingId } = request.params as { pairingId: string };
      return pairing.claim(pairingId, origin);
    },
  );
}

function registerStatusRoute(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { store, runs } = options;
  app.get(
    '/v1/status',
    { schema: AgentServerRouteSchemas.status },
    async (request) => {
      requirePairedOrigin(request);
      return {
        version: options.version,
        platform: process.platform,
        subscriptions: options.subscriptions.list(),
        agents: store
          .listActivations()
          .map((activation) => publicAgentView(store, activation)),
        providers: Object.fromEntries(
          Object.entries(store.readProviders()).map(([id, provider]) => [
            id,
            providerView(provider),
          ]),
        ),
        runs: runViews(runs),
      };
    },
  );
}

function registerAgentRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { store } = options;
  app.get(
    '/v1/agents',
    { schema: AgentServerRouteSchemas.listAgents },
    async (request) => {
      requirePairedOrigin(request);
      return store
        .listActivations()
        .map((activation) => publicAgentView(store, activation));
    },
  );
  app.post(
    '/v1/agents',
    { schema: AgentServerRouteSchemas.createAgent, attachValidation: true },
    async (request, reply) => {
      requirePairedOrigin(request);
      const body = requireBody<Record<string, unknown>>(request);
      const signal = requestOperationSignal(request, options.shutdownSignal);
      const kind = requireString(body, 'kind');
      if (kind === 'managed') {
        if (body['apiUrl'] !== undefined) {
          throw new AgentServerHttpError(
            400,
            'invalid_body',
            'managed agent registration uses the configured MoltNet API URL; apiUrl cannot be overridden',
          );
        }
        const entry = await createManagedAgent(store, options.secrets, {
          name: requireString(body, 'name'),
          apiUrl: options.defaultApiUrl,
          enrollmentToken: requireString(body, 'enrollmentToken'),
          signal,
        });
        return reply.code(201).send(publicAgentView(store, entry.activation));
      }
      if (kind === 'external') {
        const apiUrl = optionalString(body, 'apiUrl');
        const entry = await attachExternalAgent(
          store,
          options.externalSecretProviders,
          {
            name: requireString(body, 'name'),
            configDir: requireString(body, 'configDir'),
            ...(apiUrl ? { apiUrl } : {}),
            signal,
          },
        );
        return reply.code(201).send(publicAgentView(store, entry.activation));
      }
      throw new AgentServerHttpError(
        400,
        'invalid_body',
        '"kind" must be "managed" or "external"',
      );
    },
  );
  app.post(
    '/v1/agents/:agentName/reconcile',
    { schema: AgentServerRouteSchemas.reconcileAgent, attachValidation: true },
    async (request) => {
      requirePairedOrigin(request);
      const { agentName } = request.params as { agentName: string };
      const action = requireString(
        requireBody<Record<string, unknown>>(request),
        'action',
      );
      if (action !== 'resume' && action !== 'abandon') {
        throw new AgentServerHttpError(
          400,
          'invalid_body',
          '"action" must be "resume" or "abandon"',
        );
      }
      const reconciled = await reconcileManagedRegistration(
        store,
        options.secrets,
        agentName,
        action,
        undefined,
        requestOperationSignal(request, options.shutdownSignal),
      );
      return reconciled
        ? publicAgentView(store, reconciled.activation)
        : { abandoned: true };
    },
  );
}

function registerProviderRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { store } = options;
  let mutationQueue = Promise.resolve();
  const serialize = <T>(mutation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(mutation, mutation);
    mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
  app.get(
    '/v1/providers',
    { schema: AgentServerRouteSchemas.listProviders },
    async (request) => {
      requirePairedOrigin(request);
      return Object.fromEntries(
        Object.entries(store.readProviders()).map(([id, provider]) => [
          id,
          providerView(provider),
        ]),
      );
    },
  );
  app.post(
    '/v1/providers/:providerId/discover-models',
    { schema: AgentServerRouteSchemas.discoverModels },
    async (request) => {
      requirePairedOrigin(request);
      const { providerId: rawProviderId } = request.params as {
        providerId: string;
      };
      const providerId = assertProviderId(rawProviderId);
      const provider = store.readProviders()[providerId];
      if (!provider) {
        throw new AgentServerHttpError(
          404,
          'provider_not_found',
          `provider "${providerId}" was not found`,
        );
      }
      const parsed = parseProviderBaseUrl(provider.baseUrl, providerId);
      const baseUrl = parsed.href.replace(/\/$/u, '');
      let apiKey: string | undefined;
      if (provider.apiKeyRef) {
        try {
          apiKey = await options.secretProviders.resolve(
            parseSecretReferenceString(provider.apiKeyRef),
          );
        } catch (error) {
          request.log.warn(
            {
              ...safeErrorContext(error),
              code: 'agent_server_provider_secret_unavailable',
              providerId,
            },
            'Provider API key could not be resolved for model discovery',
          );
          throw new AgentServerHttpError(
            400,
            'provider_secret_unavailable',
            `provider "${providerId}" API key could not be resolved`,
          );
        }
      }
      const headers: Record<string, string> = apiKey
        ? { authorization: `Bearer ${apiKey}` }
        : {};
      const fetchImpl = options.discoverFetch ?? fetch;
      const failures: DiscoveryFailure[] = [];
      const collector = new ModelDiscoveryCollector();
      const tryJson = async (
        endpoint: 'openai_models' | 'ollama_tags',
        url: string,
      ): Promise<unknown> => {
        let response: Response;
        try {
          response = await fetchImpl(url, {
            headers,
            redirect: 'error',
            signal: AbortSignal.timeout(10_000),
          });
        } catch (error) {
          const errorType = error instanceof Error ? error.name : typeof error;
          failures.push({ kind: 'network', errorType });
          request.log.warn(
            {
              code: 'agent_server_provider_discovery_request_failed',
              endpoint,
              errorType,
              providerId,
            },
            'Provider model discovery request failed',
          );
          return null;
        }
        if (!response.ok) {
          failures.push({ kind: 'http', status: response.status });
          const context = {
            code: 'agent_server_provider_discovery_upstream_error',
            endpoint,
            providerId,
            statusCode: response.status,
          };
          if (
            response.status >= 500 ||
            response.status === 401 ||
            response.status === 403
          ) {
            request.log.warn(context, 'Provider model discovery was rejected');
          } else {
            request.log.info(
              context,
              'Provider model discovery endpoint unavailable',
            );
          }
          return null;
        }
        try {
          return (await response.json()) as unknown;
        } catch {
          failures.push({ kind: 'invalid_response' });
          request.log.warn(
            {
              code: 'agent_server_provider_discovery_invalid_json',
              endpoint,
              providerId,
            },
            'Provider model discovery returned invalid JSON',
          );
          return null;
        }
      };
      collector.addOpenAiResponse(
        await tryJson('openai_models', `${baseUrl}/models`),
      );
      if (collector.size === 0) {
        collector.addOllamaResponse(
          await tryJson('ollama_tags', `${parsed.origin}/api/tags`),
        );
      }
      const result = collector.result(providerId, failures);
      if (result.discoveredCount > result.models.length) {
        request.log.warn(
          {
            code: 'agent_server_provider_discovery_truncated',
            discoveredCount: result.discoveredCount,
            providerId,
            returnedCount: MAX_DISCOVERED_MODELS,
          },
          'Provider model discovery result was truncated',
        );
      }
      request.log.info(
        {
          code: 'agent_server_provider_discovery_completed',
          modelCount: result.models.length,
          providerId,
        },
        'Provider model discovery completed',
      );
      return { models: result.models };
    },
  );
  app.put(
    '/v1/providers/:providerId',
    { schema: AgentServerRouteSchemas.putProvider, attachValidation: true },
    async (request, reply) => {
      requirePairedOrigin(request);
      const { providerId: rawProviderId } = request.params as {
        providerId: string;
      };
      const providerId = assertProviderId(rawProviderId);
      const body = requireBody<Record<string, unknown>>(request);
      const baseUrl = requireString(body, 'baseUrl');
      parseProviderBaseUrl(baseUrl, providerId);
      const entry: ProviderEntry = {
        api: requireString(body, 'api'),
        baseUrl,
        envName: assertProviderEnvName(
          providerId,
          requireString(body, 'envName'),
        ),
        models: stringArray(body, 'models', { allowEmpty: true }),
      };
      const apiKey = optionalString(body, 'apiKey');
      await serialize(async () => {
        const providers = store.readProviders();
        if (apiKey) {
          const key = `pi-provider/${providerId}`;
          await options.secrets.write(key, apiKey);
          entry.apiKeyRef = formatSecretReferenceString({
            provider: FILE_SECRET_PROVIDER,
            key,
          });
        } else if (
          providers[providerId]?.apiKeyRef &&
          providers[providerId].baseUrl === entry.baseUrl
        ) {
          entry.apiKeyRef = providers[providerId].apiKeyRef;
        } else if (providers[providerId]?.apiKeyRef) {
          await options.secrets.delete(`pi-provider/${providerId}`);
        }
        providers[providerId] = entry;
        store.writeProviders(providers);
      });
      return reply.code(200).send(providerView(entry));
    },
  );
  app.delete(
    '/v1/providers/:providerId',
    { schema: AgentServerRouteSchemas.deleteProvider, attachValidation: true },
    async (request, reply) => {
      requirePairedOrigin(request);
      const { providerId: rawProviderId } = request.params as {
        providerId: string;
      };
      const providerId = assertProviderId(rawProviderId);
      await serialize(async () => {
        const providers = store.readProviders();
        const provider = providers[providerId];
        if (!provider) {
          throw new AgentServerHttpError(
            404,
            'agent_server_provider_not_found',
            `Provider ${providerId} was not found`,
          );
        }
        if (provider.apiKeyRef) {
          await options.secrets.delete(`pi-provider/${providerId}`);
        }
        delete providers[providerId];
        store.writeProviders(providers);
      });
      return reply.code(204).send(null);
    },
  );
}

function runViews(runs: RunManager): Array<Record<string, unknown>> {
  return runs
    .list(RUN_HISTORY_LIMIT)
    .map((record) => ({ ...record, active: runs.isActive(record.id) }));
}

function registerSubscriptionRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  app.get(
    '/v1/subscriptions',
    { schema: AgentServerRouteSchemas.listSubscriptions },
    async (request) => {
      requirePairedOrigin(request);
      return options.subscriptions.list();
    },
  );

  app.post(
    '/v1/subscriptions/:providerId/login',
    { schema: AgentServerRouteSchemas.startSubscriptionLogin },
    async (request, reply) => {
      requirePairedOrigin(request);
      const { providerId } = request.params as { providerId: string };
      const login = await options.subscriptions.start(providerId);
      return reply.code(201).send(login);
    },
  );

  app.get(
    '/v1/subscriptions/:providerId/login',
    { schema: AgentServerRouteSchemas.getSubscriptionLogin },
    async (request) => {
      requirePairedOrigin(request);
      const { providerId } = request.params as { providerId: string };
      return options.subscriptions.status(providerId);
    },
  );

  app.delete(
    '/v1/subscriptions/:providerId/login',
    { schema: AgentServerRouteSchemas.cancelSubscriptionLogin },
    async (request) => {
      requirePairedOrigin(request);
      const { providerId } = request.params as { providerId: string };
      return options.subscriptions.cancel(providerId);
    },
  );
}

function registerRunRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { runs } = options;
  app.get(
    '/v1/runs',
    { schema: AgentServerRouteSchemas.listRuns },
    async (request) => {
      requirePairedOrigin(request);
      return runViews(runs);
    },
  );
  app.post(
    '/v1/runs',
    { schema: AgentServerRouteSchemas.startRun, attachValidation: true },
    async (request, reply) => {
      requirePairedOrigin(request);
      const body = requireBody<Record<string, unknown>>(request);
      const record = await runs.start(
        {
          agent: requireString(body, 'agent'),
          teamId: requireString(body, 'teamId'),
          profiles: stringArray(body, 'profiles'),
          taskTypes: stringArray(body, 'taskTypes'),
          mode: requireString(body, 'mode') as 'poll' | 'drain',
        },
        requestOperationSignal(request, options.shutdownSignal),
      );
      return reply
        .code(201)
        .send({ ...record, active: runs.isActive(record.id) });
    },
  );
  app.delete(
    '/v1/runs/:runId',
    { schema: AgentServerRouteSchemas.stopRun },
    async (request) => {
      requirePairedOrigin(request);
      const { runId } = request.params as { runId: string };
      return runs.stop(runId);
    },
  );
  registerRunLogRoute(app, options, requirePairedOrigin);
}

function registerRunLogRoute(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { runs, store } = options;
  let openStreams = 0;
  app.get(
    '/v1/runs/:runId/logs',
    { schema: AgentServerRouteSchemas.streamRunLogs },
    async (request, reply) => {
      requirePairedOrigin(request);
      const { runId } = request.params as { runId: string };
      const record = runs.status(runId);
      store.resolveRunLogPath(record.id);
      if (openStreams >= MAX_LOG_STREAMS) {
        throw new AgentServerHttpError(
          429,
          'rate_limited',
          'Too many concurrent log streams',
        );
      }
      openStreams += 1;
      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
        ...corsHeadersFor(request, options),
      });
      const readState: AgentServerLogReadState = { offset: 0, fragment: '' };
      let closed = false;
      let pollTimer: ReturnType<typeof setTimeout> | undefined;
      const durationTimer = setTimeout(
        () => finish(),
        LOG_STREAM_MAX_DURATION_MS,
      );
      durationTimer.unref();
      function finish(destroy = false): void {
        if (closed) return;
        closed = true;
        openStreams -= 1;
        if (pollTimer) clearTimeout(pollTimer);
        clearTimeout(durationTimer);
        if (destroy) reply.raw.destroy();
        else reply.raw.end();
      }
      const writeData = async (line: string): Promise<void> => {
        if (closed || reply.raw.write(`data: ${line}\n\n`)) return;
        await new Promise<void>((resolvePromise) => {
          const done = (): void => {
            reply.raw.off('drain', done);
            reply.raw.off('close', done);
            resolvePromise();
          };
          reply.raw.once('drain', done);
          reply.raw.once('close', done);
        });
      };
      const push = async (): Promise<void> => {
        const logPath = store.resolveRunLogPath(record.id);
        const handle = await open(
          logPath,
          fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
        );
        try {
          const { lines, omitted } = await readAgentServerLogDelta(
            handle,
            readState,
          );
          if (omitted) await writeData('[older log output omitted]');
          for (const line of lines) await writeData(line);
        } finally {
          await handle.close();
        }
      };
      const fail = (error: unknown): void => {
        if (closed) return;
        request.log.warn(
          {
            ...safeErrorContext(error),
            code: 'agent_server_log_tail_failed',
            runId,
          },
          'Agent Server log tail failed',
        );
        finish(true);
      };
      const schedule = (): void => {
        if (closed) return;
        pollTimer = setTimeout(() => {
          void push()
            .then(() => {
              if (runs.isActive(record.id)) schedule();
              else finish();
            })
            .catch(fail);
        }, LOG_POLL_INTERVAL_MS);
        pollTimer.unref();
      };
      reply.raw.on('close', () => finish());
      try {
        await push();
        if (runs.isActive(record.id)) schedule();
        else finish();
      } catch (error) {
        fail(error);
      }
      return reply;
    },
  );
}

function safeErrorContext(error: unknown): Record<string, string | number> {
  const context: Record<string, string | number> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  const applicationCode = safeErrorToken(
    (error as { code?: unknown } | null)?.code,
  );
  if (applicationCode) context['applicationCode'] = applicationCode;
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause instanceof Error) {
    context['causeType'] = cause.name;
    const causeMessage = safeLogMessage(cause.message);
    if (causeMessage) context['causeMessage'] = causeMessage;
  }
  const fsCode = safeErrorToken((cause as NodeJS.ErrnoException | null)?.code);
  const syscall = safeErrorToken(
    (cause as NodeJS.ErrnoException | null)?.syscall,
  );
  if (fsCode) context['fsCode'] = fsCode;
  if (syscall) context['syscall'] = syscall;
  const causeStatus = (cause as { statusCode?: unknown } | null)?.statusCode;
  if (typeof causeStatus === 'number') context['causeStatusCode'] = causeStatus;
  return context;
}

function safeLogMessage(value: string): string | undefined {
  const normalized = value.replace(/[\r\n\t]/gu, ' ').trim();
  return normalized ? normalized.slice(0, 500) : undefined;
}

function safeErrorToken(value: unknown): string | undefined {
  return typeof value === 'string' && /^[a-z0-9_:-]{1,64}$/iu.test(value)
    ? value
    : undefined;
}

function providerView(provider: ProviderEntry): Record<string, unknown> {
  return {
    api: provider.api,
    baseUrl: provider.baseUrl,
    envName: provider.envName,
    models: provider.models,
    hasApiKey: Boolean(provider.apiKeyRef),
  };
}

function corsHeadersFor(
  request: FastifyRequest,
  options: BuildAgentServerOptions,
): Record<string, string> {
  const origin = request.headers.origin;
  if (isConfiguredOrigin(origin, options)) {
    return { 'access-control-allow-origin': origin, vary: 'origin' };
  }
  return {};
}

function isConfiguredOrigin(
  origin: string | undefined,
  options: BuildAgentServerOptions,
): origin is string {
  return (
    typeof origin === 'string' &&
    (options.allowedOrigins.includes(origin) || origin === options.selfOrigin)
  );
}

function normalizeAgentServerError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof AgentServerHttpError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }
  if (isLoopbackViolation(error)) {
    const origin =
      error.kind === 'origin_required' ||
      error.kind === 'origin_invalid' ||
      error.kind === 'origin_not_allowed';
    return {
      statusCode: origin ? 403 : 400,
      code: error.kind,
      message: error.message,
    };
  }
  if (error instanceof AgentServerPairingError) {
    const statusCode =
      error.code === 'pairing_not_found'
        ? 404
        : error.code === 'pairing_token_invalid' ||
            error.code === 'pairing_not_approved'
          ? 401
          : 403;
    return { statusCode, code: error.code, message: error.message };
  }
  if (error instanceof AgentServerStoreError) {
    return {
      statusCode:
        error.code === 'not_found'
          ? 404
          : error.code === 'io_error'
            ? 500
            : 400,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof AgentServerRunError) {
    return {
      statusCode: error.code === 'run_not_found' ? 404 : 400,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof AgentServerSubscriptionError) {
    return {
      statusCode:
        error.code === 'login_not_found'
          ? 404
          : error.code === 'provider_unknown'
            ? 404
            : 400,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof AgentServerModelDiscoveryError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof AgentServerIdentityError) {
    return {
      statusCode: error.code === 'agent_exists' ? 409 : 400,
      code: error.code,
      message: error.message,
    };
  }
  return {
    statusCode: 500,
    code: 'internal_error',
    message: 'The local supervisor could not complete the request.',
  };
}
