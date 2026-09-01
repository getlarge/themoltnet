/**
 * HTTP surface of `moltnet-agent serve` (#2061), built on the shared
 * loopback-companion security profile (#2066): loopback Host enforcement,
 * exact-origin CORS, Fetch-Metadata guards, strict JSON parsing.
 *
 * Everything under `/v1` except the pairing bootstrap requires a paired
 * origin: the `x-moltnet-serve-token` header must verify against the
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
  attachExternalAgent,
  createManagedAgent,
  publicAgentView,
  reconcileManagedRegistration,
  ServeIdentityError,
} from './identity.js';
import {
  type PairingService,
  renderPairingApprovalPage,
  renderPairingResultPage,
  ServePairingError,
} from './pairing.js';
import {
  type ProviderLoginService,
  ServeSubscriptionError,
} from './provider-login.js';
import { type RunManager, ServeRunError } from './runs.js';
import {
  assertProviderEnvName,
  assertProviderId,
  type ProviderEntry,
  type ServeStore,
  ServeStoreError,
} from './store.js';

export const SERVE_TOKEN_HEADER = 'x-moltnet-serve-token';
const BODY_LIMIT = 64 * 1024;
const LOG_POLL_INTERVAL_MS = 500;
const LOG_STREAM_MAX_DURATION_MS = 60 * 60 * 1000;
const MAX_LOG_STREAMS = 32;
const LOG_READ_LIMIT_BYTES = 256 * 1024;
const RUN_HISTORY_LIMIT = 100;
const RATE_LIMIT_MAX = 120;
const RATE_LIMIT_WINDOW_MS = 60_000;

export interface ServeLogReadState {
  offset: number;
  fragment: string;
  decoder?: StringDecoder;
  discardingLine?: boolean;
}

export async function readServeLogDelta(
  handle: FileHandle,
  state: ServeLogReadState,
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

export interface BuildServeServerOptions {
  store: ServeStore;
  secrets: FileSecretProvider;
  secretProviders: SecretProviderRegistry;
  externalSecretProviders: SecretProviderRegistry;
  pairing: PairingService;
  runs: RunManager;
  subscriptions: ProviderLoginService;
  allowedOrigins: readonly string[];
  /** The serve base URL origin, so the approval page may CORS to itself. */
  selfOrigin?: string;
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
}

class ServeHttpError extends Error {
  override name = 'ServeHttpError';
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
    throw new ServeHttpError(400, 'invalid_body', 'JSON object body required');
  }
  return body as T;
}

function requireString(body: Record<string, unknown>, field: string): string {
  const value = body[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ServeHttpError(
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
    throw new ServeHttpError(
      400,
      'invalid_body',
      `"${field}" must be a non-empty string when present`,
    );
  }
  return value.trim();
}

function stringArray(body: Record<string, unknown>, field: string): string[] {
  const value = body[field];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== 'string' || item.length === 0)
  ) {
    throw new ServeHttpError(
      400,
      'invalid_body',
      `"${field}" must be a non-empty string array`,
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

export function buildServeServer(
  options: BuildServeServerOptions,
): FastifyInstance {
  const { pairing } = options;
  const app = options.logger
    ? Fastify({ bodyLimit: BODY_LIMIT, loggerInstance: options.logger })
    : Fastify({ bodyLimit: BODY_LIMIT });

  registerLoopbackSecurity(app, {
    allowedOrigins: options.allowedOrigins,
    ...(options.selfOrigin ? { selfOrigins: [options.selfOrigin] } : {}),
    allowedHeaders: [SERVE_TOKEN_HEADER],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  void app.register(rateLimit, {
    global: false,
    max: options.rateLimitMax ?? RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () =>
      new ServeHttpError(429, 'rate_limited', 'Too many requests'),
    keyGenerator: (request) => {
      const origin = request.headers.origin;
      return isConfiguredOrigin(origin, options)
        ? `origin:${origin}`
        : `ip:${request.ip}`;
    },
  });
  app.after(() => app.addHook('onRequest', app.rateLimit()));

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
          new ServeHttpError(400, 'invalid_body', 'Form body is invalid'),
          undefined,
        );
      }
    },
  );

  const requirePairedOrigin = (request: FastifyRequest): string => {
    const origin = requireOriginHeader(request.headers);
    const token = request.headers[SERVE_TOKEN_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      throw new ServeHttpError(
        401,
        'pairing_required',
        'Pairing token is required',
      );
    }
    pairing.verify(origin, token);
    return origin;
  };

  app.get('/health', async () => ({ status: 'ok' }));
  registerPairingRoutes(app, pairing);
  registerStatusRoute(app, options, requirePairedOrigin);
  registerAgentRoutes(app, options, requirePairedOrigin);
  registerProviderRoutes(app, options, requirePairedOrigin);
  registerSubscriptionRoutes(app, options, requirePairedOrigin);
  registerRunRoutes(app, options, requirePairedOrigin);

  app.setNotFoundHandler(async (_request, reply) =>
    reply
      .code(404)
      .send({ code: 'not_found', message: 'Route is not available' }),
  );
  app.setErrorHandler(async (error, request, reply) => {
    const { statusCode, code, message } = normalizeServeError(error);
    if (statusCode === 500) {
      request.log.error(
        {
          ...safeErrorContext(error),
          code: 'serve_request_failed',
          method: request.method,
          route: request.routeOptions.url,
        },
        'Serve request failed',
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
  app.post('/v1/pairings', async (request, reply) => {
    const origin = requireOriginHeader(request.headers);
    return reply.code(201).send(pairing.start(origin));
  });
  app.get('/pairings/:pairingId', async (request, reply) => {
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
  });
  app.post('/pairings/:pairingId/confirm', async (request, reply) => {
    rejectExplicitCrossSite(request.headers);
    const { pairingId } = request.params as { pairingId: string };
    if (!(request.body instanceof URLSearchParams)) {
      throw new ServeHttpError(
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
  });
  app.post('/v1/pairings/:pairingId/claim', async (request) => {
    const origin = requireOriginHeader(request.headers);
    const { pairingId } = request.params as { pairingId: string };
    return pairing.claim(pairingId, origin);
  });
}

function registerStatusRoute(
  app: FastifyInstance,
  options: BuildServeServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { store, runs } = options;
  app.get('/v1/status', async (request) => {
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
  });
}

function registerAgentRoutes(
  app: FastifyInstance,
  options: BuildServeServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { store } = options;
  app.get('/v1/agents', async (request) => {
    requirePairedOrigin(request);
    return store
      .listActivations()
      .map((activation) => publicAgentView(store, activation));
  });
  app.post('/v1/agents', async (request, reply) => {
    requirePairedOrigin(request);
    const body = requireBody<Record<string, unknown>>(request);
    const signal = requestOperationSignal(request, options.shutdownSignal);
    const kind = requireString(body, 'kind');
    if (kind === 'managed') {
      const entry = await createManagedAgent(store, options.secrets, {
        name: requireString(body, 'name'),
        apiUrl: optionalString(body, 'apiUrl') ?? options.defaultApiUrl,
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
    throw new ServeHttpError(
      400,
      'invalid_body',
      '"kind" must be "managed" or "external"',
    );
  });
  app.post('/v1/agents/:agentName/reconcile', async (request) => {
    requirePairedOrigin(request);
    const { agentName } = request.params as { agentName: string };
    const action = requireString(
      requireBody<Record<string, unknown>>(request),
      'action',
    );
    if (action !== 'resume' && action !== 'abandon') {
      throw new ServeHttpError(
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
  });
}

function registerProviderRoutes(
  app: FastifyInstance,
  options: BuildServeServerOptions,
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
  app.get('/v1/providers', async (request) => {
    requirePairedOrigin(request);
    return Object.fromEntries(
      Object.entries(store.readProviders()).map(([id, provider]) => [
        id,
        providerView(provider),
      ]),
    );
  });
  app.post('/v1/providers/:providerId/discover-models', async (request) => {
    requirePairedOrigin(request);
    const { providerId: rawProviderId } = request.params as {
      providerId: string;
    };
    const providerId = assertProviderId(rawProviderId);
    const provider = store.readProviders()[providerId];
    if (!provider) {
      throw new ServeHttpError(
        404,
        'provider_not_found',
        `provider "${providerId}" was not found`,
      );
    }
    const baseUrl = provider.baseUrl.replace(/\/$/, '');
    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new ServeHttpError(
        400,
        'invalid_provider',
        `provider "${providerId}" has an invalid base URL`,
      );
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new ServeHttpError(
        400,
        'invalid_provider',
        `provider "${providerId}" base URL must be http(s)`,
      );
    }
    let apiKey: string | undefined;
    if (provider.apiKeyRef) {
      try {
        apiKey = await options.secretProviders.resolve(
          parseSecretReferenceString(provider.apiKeyRef),
        );
      } catch {
        throw new ServeHttpError(
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
    const models = new Set<string>();
    const tryJson = async (url: string): Promise<unknown | null> => {
      try {
        const response = await fetchImpl(url, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(10_000),
        });
        if (!response.ok) return null;
        return (await response.json()) as unknown;
      } catch {
        return null;
      }
    };
    const openai = (await tryJson(`${baseUrl}/models`)) as {
      data?: { id?: string }[];
    } | null;
    for (const model of openai?.data ?? []) {
      if (typeof model.id === 'string' && model.id) models.add(model.id);
    }
    if (models.size === 0) {
      const tags = (await tryJson(`${parsed.origin}/api/tags`)) as {
        models?: { name?: string }[];
      } | null;
      for (const model of tags?.models ?? []) {
        if (typeof model.name === 'string' && model.name) {
          models.add(model.name);
        }
      }
    }
    if (models.size === 0) {
      throw new ServeHttpError(
        502,
        'discovery_failed',
        `no models discovered for provider "${providerId}"`,
      );
    }
    return { models: [...models].sort() };
  });
  app.put('/v1/providers/:providerId', async (request, reply) => {
    requirePairedOrigin(request);
    const { providerId: rawProviderId } = request.params as {
      providerId: string;
    };
    const providerId = assertProviderId(rawProviderId);
    const body = requireBody<Record<string, unknown>>(request);
    const entry: ProviderEntry = {
      api: requireString(body, 'api'),
      baseUrl: requireString(body, 'baseUrl'),
      envName: assertProviderEnvName(
        providerId,
        requireString(body, 'envName'),
      ),
      models: stringArray(body, 'models'),
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
      }
      providers[providerId] = entry;
      store.writeProviders(providers);
    });
    return reply.code(200).send(providerView(entry));
  });
}

function runViews(runs: RunManager): Array<Record<string, unknown>> {
  return runs
    .list(RUN_HISTORY_LIMIT)
    .map((record) => ({ ...record, active: runs.isActive(record.id) }));
}

function registerSubscriptionRoutes(
  app: FastifyInstance,
  options: BuildServeServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  app.get('/v1/subscriptions', async (request) => {
    requirePairedOrigin(request);
    return options.subscriptions.list();
  });

  app.post('/v1/subscriptions/:providerId/login', async (request, reply) => {
    requirePairedOrigin(request);
    const { providerId } = request.params as { providerId: string };
    const login = await options.subscriptions.start(providerId);
    return reply.code(201).send(login);
  });

  app.get('/v1/subscriptions/:providerId/login', async (request) => {
    requirePairedOrigin(request);
    const { providerId } = request.params as { providerId: string };
    return options.subscriptions.status(providerId);
  });

  app.delete('/v1/subscriptions/:providerId/login', async (request) => {
    requirePairedOrigin(request);
    const { providerId } = request.params as { providerId: string };
    return options.subscriptions.cancel(providerId);
  });
}

function registerRunRoutes(
  app: FastifyInstance,
  options: BuildServeServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { runs } = options;
  app.get('/v1/runs', async (request) => {
    requirePairedOrigin(request);
    return runViews(runs);
  });
  app.post('/v1/runs', async (request, reply) => {
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
    return reply.code(201).send(record);
  });
  app.delete('/v1/runs/:runId', async (request) => {
    requirePairedOrigin(request);
    const { runId } = request.params as { runId: string };
    return runs.stop(runId);
  });
  registerRunLogRoute(app, options, requirePairedOrigin);
}

function registerRunLogRoute(
  app: FastifyInstance,
  options: BuildServeServerOptions,
  requirePairedOrigin: PairedOriginGuard,
): void {
  const { runs, store } = options;
  let openStreams = 0;
  app.get('/v1/runs/:runId/logs', async (request, reply) => {
    requirePairedOrigin(request);
    const { runId } = request.params as { runId: string };
    const record = runs.status(runId);
    store.resolveRunLogPath(record.id);
    if (openStreams >= MAX_LOG_STREAMS) {
      throw new ServeHttpError(
        429,
        'rate_limited',
        'Too many concurrent log streams',
      );
    }
    openStreams += 1;
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      ...corsHeadersFor(request, options),
    });
    const readState: ServeLogReadState = { offset: 0, fragment: '' };
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
        const { lines, omitted } = await readServeLogDelta(handle, readState);
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
          code: 'serve_log_tail_failed',
          runId,
        },
        'serve log tail failed',
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
    request.raw.on('close', () => finish());
    try {
      await push();
      if (runs.isActive(record.id)) schedule();
      else finish();
    } catch (error) {
      fail(error);
    }
    return reply;
  });
}

function safeErrorContext(error: unknown): Record<string, string> {
  const context: Record<string, string> = {
    errorType: error instanceof Error ? error.name : typeof error,
  };
  const applicationCode = safeErrorToken(
    (error as { code?: unknown } | null)?.code,
  );
  if (applicationCode) context['applicationCode'] = applicationCode;
  const cause = error instanceof Error ? error.cause : undefined;
  const fsCode = safeErrorToken((cause as NodeJS.ErrnoException | null)?.code);
  const syscall = safeErrorToken(
    (cause as NodeJS.ErrnoException | null)?.syscall,
  );
  if (fsCode) context['fsCode'] = fsCode;
  if (syscall) context['syscall'] = syscall;
  return context;
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
  options: BuildServeServerOptions,
): Record<string, string> {
  const origin = request.headers.origin;
  if (isConfiguredOrigin(origin, options)) {
    return { 'access-control-allow-origin': origin, vary: 'origin' };
  }
  return {};
}

function isConfiguredOrigin(
  origin: string | undefined,
  options: BuildServeServerOptions,
): origin is string {
  return (
    typeof origin === 'string' &&
    (options.allowedOrigins.includes(origin) || origin === options.selfOrigin)
  );
}

function normalizeServeError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof ServeHttpError) {
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
  if (error instanceof ServePairingError) {
    const statusCode =
      error.code === 'pairing_not_found'
        ? 404
        : error.code === 'pairing_token_invalid' ||
            error.code === 'pairing_not_approved'
          ? 401
          : 403;
    return { statusCode, code: error.code, message: error.message };
  }
  if (error instanceof ServeStoreError) {
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
  if (error instanceof ServeRunError) {
    return {
      statusCode: error.code === 'run_not_found' ? 404 : 400,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof ServeSubscriptionError) {
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
  if (error instanceof ServeIdentityError) {
    return {
      statusCode: error.code === 'agent_exists' ? 409 : 400,
      code: error.code,
      message: error.message,
    };
  }
  // Loopback companion for the operator's own machine: surfacing the real
  // message is a feature — the alternative is a blind "Request failed".
  return {
    statusCode: 500,
    code: 'internal_error',
    message:
      error instanceof Error && error.message
        ? error.message
        : 'Request failed',
  };
}
