import { constants as fsConstants } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';

import rateLimit from '@fastify/rate-limit';
import {
  isLoopbackViolation,
  OriginAllowlist,
  registerLoopbackSecurity,
  requireOriginHeader,
} from '@moltnet/loopback-companion';
import { PI_MODEL_MODALITIES } from '@themoltnet/pi-runtime/pi-config';
import {
  hasAgentKeyConfiguration,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import { type FileSecretProvider } from '@themoltnet/sdk/node';
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyRequest,
} from 'fastify';

import {
  DEFAULT_LOCAL_OPERATIONAL_SETTINGS,
  type LocalOperationalSettings,
} from '../options.js';
import {
  ProviderConfigurationError,
  type ProviderConfigurationService,
} from '../provider-configuration.js';
import { safeErrorContext } from '../safe-error-context.js';
import { buildCatalogue, type CatalogueAgentPort } from './catalogue.js';
import { enrollIdentityTeam, type TeamEnrollmentInput } from './enrollment.js';
import {
  AgentServerIdentityError,
  attachExternalAgent,
  createManagedAgent,
  loadAgentActivation,
  publicAgentView,
  reconcileManagedRegistration,
  requireActivation,
} from './identity.js';
import { readIdentityDefaultBinding } from './identity-binding.js';
import { AgentServerModelDiscoveryError } from './model-discovery.js';
import {
  NATIVE_CLIENT_ORIGIN,
  NativeGrantError,
  type NativeGrantService,
} from './native-grant-service.js';
import type { OperatorOAuth } from './operator-oauth.js';
import { AGENT_SERVER_SCHEMAS, AgentServerRouteSchemas } from './protocol.js';
import {
  AgentServerSubscriptionError,
  type ProviderLoginService,
} from './provider-login.js';
import type { MachineCapabilities } from './readiness.js';
import {
  AgentServerRunError,
  BUILT_IN_RUNTIME_KIND,
  type RunManager,
} from './runs.js';
import type { RuntimeRegistry } from './runtime-registry.js';
import {
  type AgentServerStore,
  AgentServerStoreError,
  type ProviderModelEntry,
  type ProviderModelModality,
} from './store.js';
import {
  requireCredentialSnapshot,
  TeamCredentialError,
  verifyTeamActivation,
} from './team-credentials.js';

/**
 * HTTP surface of `moltnet-agent server` (#2061), built on the shared
 * loopback-companion security profile (#2066): loopback Host enforcement,
 * exact-origin CORS, Fetch-Metadata guards, strict JSON parsing.
 *
 * Control routes require a native process grant or an OAuth token bound to
 * the native operator and this server instance. Origin checks apply to both.
 */

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
  pairing: NativeGrantService;
  operatorOAuth?: OperatorOAuth;
  operatorApiUrl?: string;
  runs: RunManager;
  subscriptions: ProviderLoginService;
  providers: ProviderConfigurationService;
  allowedOrigins: readonly string[];
  /** The Agent Server base URL origin, so the approval page may CORS to itself. */
  selfOrigin?: string;
  /** TLS credentials for the macOS loopback endpoint. */
  tls?: { key: string; cert: string };
  /** Default MoltNet API URL for newly created managed agents. */
  defaultApiUrl: string;
  /** Effective settings inherited by every child run. */
  runtimeSettings?: LocalOperationalSettings;
  /** Environment-selected identity, ahead of the persisted default. */
  activeIdentity?: string;
  /**
   * Builds the catalogue's view of the MoltNet API for a local identity.
   * Overridable so the surface can be tested without a credential.
   */
  catalogueAgentFor?: (alias: string) => Promise<CatalogueAgentPort>;
  /** Locally registered custom runtime kinds, for profile readiness. */
  runtimeRegistry?: RuntimeRegistry;
  version: string;
  logger?: FastifyBaseLogger;
  /** Abort in-flight identity operations during supervisor shutdown. */
  shutdownSignal?: AbortSignal;
  /** Override used by focused rate-limit tests. */
  rateLimitMax?: number;
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

const MODEL_MODALITIES = new Set<string>(PI_MODEL_MODALITIES);

/** Parse the provider `models` field: `{ id, input? }` entries only. */
function modelArray(
  body: Record<string, unknown>,
  field: string,
): ProviderModelEntry[] {
  const value = body[field];
  const invalid = (detail: string): never => {
    throw new AgentServerHttpError(400, 'invalid_body', detail);
  };
  if (!Array.isArray(value)) {
    return invalid(`"${field}" must be an array of { id, input? } entries`);
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      return invalid(`"${field}" entries must be an { id, input? } object`);
    }
    const entry = item as Record<string, unknown>;
    const id = entry.id;
    if (typeof id !== 'string' || id.length === 0) {
      return invalid(`"${field}" entries must carry a non-empty "id"`);
    }
    if (entry.input === undefined) return { id };
    if (
      !Array.isArray(entry.input) ||
      entry.input.length === 0 ||
      entry.input.some(
        (modality) =>
          typeof modality !== 'string' || !MODEL_MODALITIES.has(modality),
      )
    ) {
      return invalid(
        `"${field}" entry "${id}" must declare "input" as a non-empty array of "text" or "image"`,
      );
    }
    return { id, input: entry.input as ProviderModelModality[] };
  });
}

function requestOperationSignal(
  request: FastifyRequest,
  shutdownSignal?: AbortSignal,
): AbortSignal {
  const disconnected = new AbortController();
  if (request.raw.aborted) disconnected.abort({ source: 'request' });
  else {
    request.raw.once('aborted', () =>
      disconnected.abort({ source: 'request' }),
    );
  }
  return shutdownSignal
    ? AbortSignal.any([disconnected.signal, shutdownSignal])
    : disconnected.signal;
}

export function buildAgentServer(
  options: BuildAgentServerOptions,
): FastifyInstance {
  const { pairing } = options;
  const oauth = options.operatorOAuth;

  const fastifyOptions = {
    bodyLimit: BODY_LIMIT,
    ...(options.tls ? { https: options.tls } : {}),
  };
  const app = options.logger
    ? Fastify({ ...fastifyOptions, loggerInstance: options.logger })
    : Fastify(fastifyOptions);

  options.registerOpenApi?.(app);
  for (const schema of AGENT_SERVER_SCHEMAS) app.addSchema(schema);

  // The native client is not a browser: CORS does not constrain it, its
  // process-scoped token does. The reserved origin uses a scheme no browser
  // can present, and `OriginAllowlist` only accepts https/loopback-http, so it
  // is admitted through the predicate rather than the allowlist. Admitting it
  // only lets the request reach the token check in `requireAuthorizedOrigin`.
  const browserOrigins = new OriginAllowlist(options.allowedOrigins);
  registerLoopbackSecurity(app, {
    isOriginAllowed: (origin) =>
      origin === NATIVE_CLIENT_ORIGIN || browserOrigins.has(origin),
    ...(options.selfOrigin ? { selfOrigins: [options.selfOrigin] } : {}),
    allowedHeaders: [AGENT_SERVER_TOKEN_HEADER],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });
  void app.register(rateLimit, {
    global: true,
    max: options.rateLimitMax ?? RATE_LIMIT_MAX,
    timeWindow: RATE_LIMIT_WINDOW_MS,
    errorResponseBuilder: () =>
      new AgentServerHttpError(429, 'rate_limited', 'Too many requests'),
    keyGenerator: async (request) => {
      const origin = request.headers.origin;
      if (!isConfiguredOrigin(origin, options)) return `ip:${request.ip}`;
      // Claiming an origin is free; proving the grant is not. An unauthenticated
      // caller asserting the native origin must not share the desktop client's
      // budget, or any local process could deny it service without ever holding
      // the token. Verify before choosing the authenticated bucket: arbitrary
      // non-empty values must stay in the bounded pre-auth bucket.
      const presented = request.headers[AGENT_SERVER_TOKEN_HEADER];
      let authenticated = false;
      if (typeof presented === 'string' && presented.length > 0) {
        try {
          if (origin === NATIVE_CLIENT_ORIGIN)
            pairing.verify(origin, presented);
          else {
            if (!oauth) return `unauth:${origin}:${request.ip}`;
            await oauth.verifyBrowser(presented);
          }
          authenticated = true;
        } catch (error) {
          if (
            origin === NATIVE_CLIENT_ORIGIN &&
            !(error instanceof NativeGrantError)
          )
            throw error;
        }
      }
      return authenticated
        ? `origin:${origin}`
        : `unauth:${origin}:${request.ip}`;
    },
  });

  const requireAuthorizedOrigin = async (
    request: FastifyRequest,
  ): Promise<string> => {
    const origin = requireOriginHeader(request.headers);
    const token = request.headers[AGENT_SERVER_TOKEN_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      throw new AgentServerHttpError(
        401,
        'authorization_required',
        'Local control token is required',
      );
    }
    if (origin === NATIVE_CLIENT_ORIGIN) pairing.verify(origin, token);
    else {
      try {
        if (!oauth) throw new Error('OAuth unavailable');
        await oauth.verifyBrowser(token);
      } catch {
        throw new AgentServerHttpError(
          401,
          'authorization_required',
          'Sign in to authorize local control',
        );
      }
    }
    return origin;
  };

  app.after(() => {
    app.get(
      '/health',
      { schema: AgentServerRouteSchemas.health },
      async () => ({ status: 'ok' }),
    );
    for (const [method, url, operationId] of [
      ['POST', '/v1/pairings', 'startAgentServerPairing'],
      ['POST', '/v1/pairings/:pairingId/claim', 'claimAgentServerPairing'],
    ] as const) {
      app.route({
        method,
        url,
        schema: {
          operationId,
          deprecated: true,
          tags: ['compatibility'],
          response: {
            410: {
              type: 'object',
              properties: {
                code: { type: 'string' },
                message: { type: 'string' },
              },
              required: ['code', 'message'],
            },
          },
        },
        handler: async (_request, reply) =>
          reply.code(410).send({
            code: 'pairing_replaced',
            message:
              'Sign in through Desktop, then connect Console using OAuth PKCE.',
          }),
      });
    }
    app.get('/oauth/metadata', async () => {
      if (!oauth)
        throw new AgentServerHttpError(
          503,
          'oauth_unavailable',
          'Local OAuth is not configured',
        );
      return oauth.metadata();
    });
    app.post(
      '/v1/operator/sign-in',
      {
        schema: {
          operationId: 'signInAgentServerOperator',
          response: {
            200: {
              type: 'object',
              properties: { state: { type: 'string' } },
              required: ['state'],
            },
          },
        },
      },
      async (request) => {
        if (
          (await requireAuthorizedOrigin(request)) !== NATIVE_CLIENT_ORIGIN ||
          !oauth
        )
          throw new AgentServerHttpError(
            403,
            'native_required',
            'Native administration required',
          );
        await oauth.authorize(
          undefined,
          requestOperationSignal(request, options.shutdownSignal),
        );
        return { state: 'authorized' };
      },
    );
    app.post('/v1/operator/cancel', async (request) => {
      if (
        (await requireAuthorizedOrigin(request)) !== NATIVE_CLIENT_ORIGIN ||
        !oauth
      )
        throw new AgentServerHttpError(
          403,
          'native_required',
          'Native administration required',
        );
      oauth.cancel();
      return { state: 'cancelled' };
    });
    app.delete('/v1/operator', async (request) => {
      if (
        (await requireAuthorizedOrigin(request)) !== NATIVE_CLIENT_ORIGIN ||
        !oauth
      )
        throw new AgentServerHttpError(
          403,
          'native_required',
          'Native administration required',
        );
      oauth.removeOperator();
      return { state: 'removed' };
    });
    registerStatusRoute(app, options, requireAuthorizedOrigin);
    registerAgentRoutes(app, options, requireAuthorizedOrigin);
    registerProviderRoutes(app, options, requireAuthorizedOrigin);
    registerSubscriptionRoutes(app, options, requireAuthorizedOrigin);
    registerRunRoutes(app, options, requireAuthorizedOrigin);
    registerCatalogueRoute(app, options, requireAuthorizedOrigin);
  });
  app.addHook('preClose', async () => {
    options.operatorOAuth?.cancel();
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

type AuthorizedOriginGuard = (request: FastifyRequest) => Promise<string>;

function registerCatalogueRoute(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  app.get(
    '/v1/catalogue',
    { schema: AgentServerRouteSchemas.catalogue, attachValidation: true },
    async (request) => {
      await requireAuthorizedOrigin(request);
      const { identity } = (request.query ?? {}) as { identity?: string };
      if (!identity || identity.trim().length === 0) {
        throw new AgentServerHttpError(
          400,
          'invalid_query',
          '"identity" is required',
        );
      }
      const alias = identity.trim();
      // Throws a typed not-found when the alias is not activated here.
      requireActivation(options.store, alias);
      const agent = await (options.catalogueAgentFor
        ? options.catalogueAgentFor(alias)
        : defaultCatalogueAgent(options, alias));
      return buildCatalogue({
        agent,
        machine: machineCapabilities(options),
        identityDefault: readIdentityDefaultBinding(
          options.store.identityDir(alias),
        ),
      });
    },
  );
}

/** Resolve and verify each indexed team independently with its exact key. */
async function defaultCatalogueAgent(
  options: BuildAgentServerOptions,
  alias: string,
): Promise<CatalogueAgentPort> {
  const { config } = await loadAgentActivation(options.store, alias);
  return {
    teamIds: Object.keys(config.agent_key_refs ?? {}),
    lastVerified: (teamId) =>
      requireActivation(options.store, alias).credentialHealth?.[teamId],
    readTeam: async (teamId) => {
      const activated = await verifyTeamActivation(
        options.store,
        alias,
        options.secretProviders,
        options.externalSecretProviders,
        undefined,
        options.shutdownSignal,
        teamId,
      );
      const { client, metadata } = requireCredentialSnapshot(activated);
      const [team, diaries, profiles] = await Promise.all([
        client.teams.get(teamId),
        client.diaries.list(),
        client.runtimeProfiles.list({ teamId }),
      ]);
      return {
        team,
        diaries: diaries.items,
        profiles: profiles.items,
        credential: metadata,
      };
    },
  };
}

/** What this machine can execute right now: provider keys and runtime kinds. */
function machineCapabilities(
  options: BuildAgentServerOptions,
): MachineCapabilities {
  const providerEnv = new Map<string, boolean>();
  for (const provider of Object.values(options.providers.list())) {
    // Several providers can share an environment name. Availability is the
    // union: one configured key satisfies the variable, and iteration order
    // must not decide the answer.
    const configured = providerEnv.get(provider.envName) === true;
    providerEnv.set(provider.envName, configured || provider.hasApiKey);
  }
  const runtimeKinds = new Set<string>([BUILT_IN_RUNTIME_KIND]);
  for (const entry of options.runtimeRegistry?.list() ?? []) {
    // `resolve` re-hashes the module and its lockfile and throws when either
    // drifted — the same check run start performs. Using `list` here would
    // advertise a modified runtime as ready and fail at start instead.
    try {
      if (options.runtimeRegistry?.resolve(entry.kind, { forDisplay: true })) {
        runtimeKinds.add(entry.kind);
      }
    } catch {
      // Drifted or missing: not available until it is registered again.
    }
  }
  return { providerEnv, runtimeKinds };
}

function registerStatusRoute(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  const { store, runs } = options;
  app.get(
    '/v1/status',
    { schema: AgentServerRouteSchemas.status },
    async (request) => {
      await requireAuthorizedOrigin(request);
      const selected = selectedIdentity(store, options.activeIdentity);
      return {
        version: options.version,
        platform: process.platform,
        subscriptions: options.subscriptions.list(),
        agents: store
          .listActivations()
          .map((activation) => publicAgentView(store, activation)),
        identities: identityViews(store),
        ...(selected ? { selectedIdentity: selected } : {}),
        providers: options.providers.list(),
        runs: await runViews(runs),
        runtimeSettings:
          options.runtimeSettings ?? DEFAULT_LOCAL_OPERATIONAL_SETTINGS,
      };
    },
  );
}

function registerAgentRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  const { store } = options;
  app.get(
    '/v1/agents',
    { schema: AgentServerRouteSchemas.listAgents },
    async (request) => {
      await requireAuthorizedOrigin(request);
      return store
        .listActivations()
        .map((activation) => publicAgentView(store, activation));
    },
  );
  app.post(
    '/v1/agents',
    { schema: AgentServerRouteSchemas.createAgent, attachValidation: true },
    async (request, reply) => {
      await requireAuthorizedOrigin(request);
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
        const identityAlias = requireString(body, 'identityAlias');
        const entry = await attachExternalAgent(
          store,
          options.externalSecretProviders,
          {
            name: identityAlias,
            configDir: store.identityDir(identityAlias),
            ...(typeof body['teamId'] === 'string'
              ? { teamId: body['teamId'] }
              : {}),
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
    '/v1/agents/:agentName/teams',
    { schema: AgentServerRouteSchemas.enrollTeam },
    async (request) => {
      await requireAuthorizedOrigin(request);
      const { agentName } = request.params as { agentName: string };
      if (
        request.headers.origin !== NATIVE_CLIENT_ORIGIN ||
        !options.operatorOAuth ||
        !options.operatorApiUrl
      )
        throw new AgentServerHttpError(
          403,
          'native_required',
          'Native OAuth enrollment required',
        );
      return enrollIdentityTeam({
        oauth: options.operatorOAuth,
        apiUrl: options.operatorApiUrl,
        store,
        alias: agentName,
        managed: options.secretProviders,
        external: options.externalSecretProviders,
        input: request.body as TeamEnrollmentInput,
      });
    },
  );
  app.post(
    '/v1/agents/:agentName/reconcile',
    { schema: AgentServerRouteSchemas.reconcileAgent, attachValidation: true },
    async (request) => {
      await requireAuthorizedOrigin(request);
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

function selectedIdentity(
  store: AgentServerStore,
  activeIdentity?: string,
): string | undefined {
  try {
    return store.resolveIdentityAlias(undefined, activeIdentity);
  } catch (error) {
    if (error instanceof AgentServerStoreError && error.code === 'not_found') {
      return undefined;
    }
    throw error;
  }
}

function identityViews(store: AgentServerStore) {
  const activated = new Set(
    store.listActivations().map((activation) => activation.alias),
  );
  return store.listIdentityAliases().map((alias) => ({
    alias,
    activated: activated.has(alias),
    hasAgentKey: hasAgentKeyConfiguration(store.readAgentConfig(alias) ?? {}),
  }));
}

function registerProviderRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  app.get(
    '/v1/providers',
    { schema: AgentServerRouteSchemas.listProviders },
    async (request) => {
      await requireAuthorizedOrigin(request);
      return options.providers.list();
    },
  );
  app.post(
    '/v1/providers/:providerId/discover-models',
    { schema: AgentServerRouteSchemas.discoverModels },
    async (request) => {
      await requireAuthorizedOrigin(request);
      const { providerId } = request.params as {
        providerId: string;
      };
      return options.providers.discover(providerId, {
        signal: requestOperationSignal(request, options.shutdownSignal),
      });
    },
  );
  app.put(
    '/v1/providers/:providerId',
    { schema: AgentServerRouteSchemas.putProvider, attachValidation: true },
    async (request, reply) => {
      await requireAuthorizedOrigin(request);
      const { providerId } = request.params as {
        providerId: string;
      };
      const body = requireBody<Record<string, unknown>>(request);
      const entry = await options.providers.set(providerId, {
        api: requireString(body, 'api'),
        baseUrl: requireString(body, 'baseUrl'),
        envName: requireString(body, 'envName'),
        models: modelArray(body, 'models'),
        ...(optionalString(body, 'apiKey')
          ? { apiKey: optionalString(body, 'apiKey') }
          : {}),
      });
      return reply.code(200).send(entry);
    },
  );
  app.delete(
    '/v1/providers/:providerId',
    { schema: AgentServerRouteSchemas.deleteProvider, attachValidation: true },
    async (request, reply) => {
      await requireAuthorizedOrigin(request);
      const { providerId } = request.params as {
        providerId: string;
      };
      try {
        await options.providers.remove(providerId);
      } catch (error) {
        if (
          error instanceof ProviderConfigurationError &&
          error.code === 'provider_not_found'
        ) {
          throw new AgentServerHttpError(
            404,
            'agent_server_provider_not_found',
            error.message,
          );
        }
        throw error;
      }
      return reply.code(204).send(null);
    },
  );
}

async function runViews(
  runs: RunManager,
): Promise<Array<Record<string, unknown>>> {
  return (await runs.listAsync(RUN_HISTORY_LIMIT)).map((record) => ({
    ...record,
    active: runs.isActive(record.id),
  }));
}

function registerSubscriptionRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  app.get(
    '/v1/subscriptions',
    { schema: AgentServerRouteSchemas.listSubscriptions },
    async (request) => {
      await requireAuthorizedOrigin(request);
      return options.subscriptions.list();
    },
  );

  app.post(
    '/v1/subscriptions/:providerId/login',
    { schema: AgentServerRouteSchemas.startSubscriptionLogin },
    async (request, reply) => {
      await requireAuthorizedOrigin(request);
      const { providerId } = request.params as { providerId: string };
      const login = await options.subscriptions.start(providerId);
      return reply.code(201).send(login);
    },
  );

  app.get(
    '/v1/subscriptions/:providerId/login',
    { schema: AgentServerRouteSchemas.getSubscriptionLogin },
    async (request) => {
      await requireAuthorizedOrigin(request);
      const { providerId } = request.params as { providerId: string };
      return options.subscriptions.status(providerId);
    },
  );

  app.delete(
    '/v1/subscriptions/:providerId/login',
    { schema: AgentServerRouteSchemas.cancelSubscriptionLogin },
    async (request) => {
      await requireAuthorizedOrigin(request);
      const { providerId } = request.params as { providerId: string };
      return options.subscriptions.cancel(providerId);
    },
  );
}

function registerRunRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  const { runs } = options;
  app.get(
    '/v1/runs',
    { schema: AgentServerRouteSchemas.listRuns },
    async (request) => {
      await requireAuthorizedOrigin(request);
      return runViews(runs);
    },
  );
  app.post(
    '/v1/runs',
    { schema: AgentServerRouteSchemas.startRun, attachValidation: true },
    async (request, reply) => {
      await requireAuthorizedOrigin(request);
      const body = requireBody<Record<string, unknown>>(request);
      const diaryId = optionalString(body, 'diaryId');
      const record = await runs.start(
        {
          agent: requireString(body, 'agent'),
          teamId: requireString(body, 'teamId'),
          ...(diaryId ? { diaryId } : {}),
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
      await requireAuthorizedOrigin(request);
      const { runId } = request.params as { runId: string };
      return runs.stop(runId);
    },
  );
  registerRunLogRoute(app, options, requireAuthorizedOrigin);
}

function registerRunLogRoute(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  requireAuthorizedOrigin: AuthorizedOriginGuard,
): void {
  const { runs, store } = options;
  app.get(
    '/v1/runs/:runId/logs/snapshot',
    {
      schema: {
        operationId: 'getAgentServerRunLogSnapshot',
        tags: ['runs'],
        security: [{ agentServerToken: [] }],
        params: {
          type: 'object',
          required: ['runId'],
          properties: { runId: { type: 'string', minLength: 1 } },
        },
        response: {
          200: {
            type: 'object',
            required: ['lines'],
            properties: { lines: { type: 'array', items: { type: 'string' } } },
          },
        },
      },
    },
    async (request) => {
      requirePairedOrigin(request);
      const { runId } = request.params as { runId: string };
      const record = runs.status(runId);
      const handle = await open(
        store.resolveRunLogPath(record.id),
        fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW,
      );
      try {
        const state: AgentServerLogReadState = { offset: 0, fragment: '' };
        const { lines, omitted } = await readAgentServerLogDelta(handle, state);
        return {
          lines: [
            ...(omitted ? ['[older log output omitted]'] : []),
            ...lines,
            ...(state.fragment ? [state.fragment] : []),
          ],
        };
      } finally {
        await handle.close();
      }
    },
  );
  let openStreams = 0;
  app.get(
    '/v1/runs/:runId/logs',
    { schema: AgentServerRouteSchemas.streamRunLogs },
    async (request, reply) => {
      await requireAuthorizedOrigin(request);
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
        // Revalidate before forwarding more output: browser authority expires
        // normally even when a stream was opened before expiry or removal.
        if (request.headers.origin !== NATIVE_CLIENT_ORIGIN)
          await requireAuthorizedOrigin(request);
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
    (origin === NATIVE_CLIENT_ORIGIN ||
      options.allowedOrigins.includes(origin) ||
      origin === options.selfOrigin)
  );
}

function normalizeAgentServerError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof TeamCredentialError)
    return {
      statusCode: 400,
      code: error.blocker.code,
      message: error.blocker.message,
    };
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
  if (error instanceof NativeGrantError) {
    return { statusCode: 401, code: error.code, message: error.message };
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
  if (error instanceof ProviderConfigurationError) {
    return {
      statusCode: error.statusCode,
      code: error.code,
      message: error.message,
    };
  }
  if (error instanceof AgentServerIdentityError) {
    return {
      // Both conflict with existing local state: an agent, or a pending
      // registration that must be reconciled before a retry.
      statusCode:
        error.code === 'agent_exists' ||
        error.code === 'registration_incomplete'
          ? 409
          : 400,
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
