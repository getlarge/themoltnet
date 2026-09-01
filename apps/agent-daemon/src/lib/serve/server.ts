/**
 * HTTP surface of `moltnet-agent serve` (#2061), built on the shared
 * loopback-companion security profile (#2066): loopback Host enforcement,
 * exact-origin CORS, Fetch-Metadata guards, strict JSON parsing.
 *
 * Everything under `/v1` except the pairing bootstrap requires a paired
 * origin: the `x-moltnet-serve-token` header must verify against the
 * origin-bound token issued by the one-click pairing ceremony.
 */
import { statSync } from 'node:fs';
import { open } from 'node:fs/promises';

import {
  assertNavigationRequest,
  isLoopbackViolation,
  registerLoopbackSecurity,
  rejectExplicitCrossSite,
  requireOriginHeader,
} from '@moltnet/loopback-companion';
import type { FileSecretProvider } from '@themoltnet/sdk/node';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';

import {
  attachExternalAgent,
  createManagedAgent,
  publicAgentView,
  ServeIdentityError,
} from './identity.js';
import {
  type PairingService,
  renderPairingApprovalPage,
  renderPairingResultPage,
  ServePairingError,
} from './pairing.js';
import { type RunManager, ServeRunError } from './runs.js';
import {
  type ProviderEntry,
  type ServeStore,
  ServeStoreError,
} from './store.js';

export const SERVE_TOKEN_HEADER = 'x-moltnet-serve-token';
const BODY_LIMIT = 64 * 1024;
const LOG_POLL_INTERVAL_MS = 500;

export interface BuildServeServerOptions {
  store: ServeStore;
  secrets: FileSecretProvider;
  pairing: PairingService;
  runs: RunManager;
  allowedOrigins: readonly string[];
  /** The serve base URL origin, so the approval page may CORS to itself. */
  selfOrigin?: string;
  /** Default MoltNet API URL for newly created managed agents. */
  defaultApiUrl: string;
  version: string;
  logger?: FastifyBaseLogger;
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

export function buildServeServer(
  options: BuildServeServerOptions,
): FastifyInstance {
  const { store, pairing, runs } = options;
  const app = options.logger
    ? Fastify({ bodyLimit: BODY_LIMIT, loggerInstance: options.logger })
    : Fastify({ bodyLimit: BODY_LIMIT });

  registerLoopbackSecurity(app, {
    allowedOrigins: options.allowedOrigins,
    ...(options.selfOrigin ? { selfOrigins: [options.selfOrigin] } : {}),
    allowedHeaders: [SERVE_TOKEN_HEADER],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
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

  // ── pairing bootstrap (allowed origin, no token yet) ───────────────────

  app.post('/v1/pairings', async (request, reply) => {
    const origin = requireOriginHeader(request.headers);
    const started = pairing.start(origin);
    return reply.code(201).send(started);
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

  // ── paired surface ─────────────────────────────────────────────────────

  app.get('/v1/status', async (request) => {
    requirePairedOrigin(request);
    return {
      version: options.version,
      platform: process.platform,
      agents: store.listAgents().map((entry) => publicAgentView(entry)),
      providers: Object.fromEntries(
        Object.entries(store.readProviders()).map(([id, provider]) => [
          id,
          providerView(provider),
        ]),
      ),
      runs: runs.list().map((record) => ({
        ...record,
        active: runs.isActive(record.id),
      })),
    };
  });

  app.get('/v1/agents', async (request) => {
    requirePairedOrigin(request);
    return store.listAgents().map((entry) => publicAgentView(entry));
  });

  app.post('/v1/agents', async (request, reply) => {
    requirePairedOrigin(request);
    const body = requireBody<Record<string, unknown>>(request);
    const kind = requireString(body, 'kind');
    if (kind === 'managed') {
      const entry = await createManagedAgent(options.store, options.secrets, {
        name: requireString(body, 'name'),
        apiUrl: optionalString(body, 'apiUrl') ?? options.defaultApiUrl,
        ...(optionalString(body, 'enrollmentToken')
          ? { enrollmentToken: optionalString(body, 'enrollmentToken') }
          : {}),
      });
      return reply.code(201).send(publicAgentView(entry));
    }
    if (kind === 'external') {
      const entry = await attachExternalAgent(options.store, {
        name: requireString(body, 'name'),
        configDir: requireString(body, 'configDir'),
        ...(optionalString(body, 'apiUrl')
          ? { apiUrl: optionalString(body, 'apiUrl') }
          : {}),
      });
      return reply.code(201).send(publicAgentView(entry));
    }
    throw new ServeHttpError(
      400,
      'invalid_body',
      '"kind" must be "managed" or "external"',
    );
  });

  app.get('/v1/providers', async (request) => {
    requirePairedOrigin(request);
    return Object.fromEntries(
      Object.entries(store.readProviders()).map(([id, provider]) => [
        id,
        providerView(provider),
      ]),
    );
  });

  app.put('/v1/providers/:providerId', async (request, reply) => {
    requirePairedOrigin(request);
    const { providerId } = request.params as { providerId: string };
    const body = requireBody<Record<string, unknown>>(request);
    const providers = store.readProviders();
    const entry: ProviderEntry = {
      api: requireString(body, 'api'),
      baseUrl: requireString(body, 'baseUrl'),
      envName: requireString(body, 'envName'),
      models: stringArray(body, 'models'),
    };
    const apiKey = optionalString(body, 'apiKey');
    if (apiKey) {
      const key = `pi-provider/${providerId}`;
      await options.secrets.write(key, apiKey);
      entry.apiKeyRef = `file:${key}`;
    } else if (providers[providerId]?.apiKeyRef) {
      // Absent apiKey on update keeps the stored secret.
      entry.apiKeyRef = providers[providerId].apiKeyRef;
    }
    providers[providerId] = entry;
    store.writeProviders(providers);
    return reply.code(200).send(providerView(entry));
  });

  app.get('/v1/runs', async (request) => {
    requirePairedOrigin(request);
    return runs
      .list()
      .map((record) => ({ ...record, active: runs.isActive(record.id) }));
  });

  app.post('/v1/runs', async (request, reply) => {
    requirePairedOrigin(request);
    const body = requireBody<Record<string, unknown>>(request);
    const record = await runs.start({
      agent: requireString(body, 'agent'),
      teamId: requireString(body, 'teamId'),
      profiles: stringArray(body, 'profiles'),
      taskTypes: stringArray(body, 'taskTypes'),
      mode: requireString(body, 'mode') as 'poll' | 'drain',
    });
    return reply.code(201).send(record);
  });

  app.delete('/v1/runs/:runId', async (request) => {
    requirePairedOrigin(request);
    const { runId } = request.params as { runId: string };
    return runs.stop(runId);
  });

  // SSE log tail: replay the current file, then poll for appended bytes.
  app.get('/v1/runs/:runId/logs', async (request, reply) => {
    requirePairedOrigin(request);
    const { runId } = request.params as { runId: string };
    runs.status(runId); // 404 on unknown run
    const logPath = `${store.runDir(runId)}/daemon.log`;

    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-store',
      connection: 'keep-alive',
      ...corsHeadersFor(request, options),
    });

    let offset = 0;
    let closed = false;
    const push = async (): Promise<void> => {
      let size = 0;
      try {
        size = statSync(logPath).size;
      } catch {
        return;
      }
      if (size <= offset) return;
      const handle = await open(logPath, 'r');
      try {
        const length = size - offset;
        const buffer = Buffer.alloc(length);
        await handle.read(buffer, 0, length, offset);
        offset = size;
        for (const line of buffer.toString('utf8').split('\n')) {
          if (!closed && line.length > 0) {
            reply.raw.write(`data: ${line}\n\n`);
          }
        }
      } finally {
        await handle.close();
      }
    };

    await push();
    const timer = setInterval(() => void push(), LOG_POLL_INTERVAL_MS);
    request.raw.on('close', () => {
      closed = true;
      clearInterval(timer);
      reply.raw.end();
    });
    return reply;
  });

  app.setNotFoundHandler(async (_request, reply) =>
    reply
      .code(404)
      .send({ code: 'not_found', message: 'Route is not available' }),
  );
  app.setErrorHandler(async (error, _request, reply) => {
    const { statusCode, code, message } = normalizeServeError(error);
    return reply.code(statusCode).send({ code, message });
  });

  return app;
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
  if (
    typeof origin === 'string' &&
    (options.allowedOrigins.includes(origin) || origin === options.selfOrigin)
  ) {
    return { 'access-control-allow-origin': origin, vary: 'origin' };
  }
  return {};
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
      statusCode: error.code === 'not_found' ? 404 : 400,
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
  if (error instanceof ServeIdentityError) {
    return {
      statusCode: error.code === 'agent_exists' ? 409 : 400,
      code: error.code,
      message: error.message,
    };
  }
  return {
    statusCode: 500,
    code: 'internal_error',
    message: 'Request failed',
  };
}
