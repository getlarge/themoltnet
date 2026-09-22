import { constants as fsConstants, realpathSync } from 'node:fs';
import { type FileHandle, open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { StringDecoder } from 'node:string_decoder';

import rateLimit from '@fastify/rate-limit';
import {
  isLoopbackViolation,
  OriginAllowlist,
  registerLoopbackSecurity,
  requireOriginHeader,
} from '@moltnet/loopback-companion';
import { OPERATOR_OAUTH } from '@moltnet/models';
import { PI_MODEL_MODALITIES } from '@themoltnet/pi-runtime/pi-config';
import {
  hasAgentKeyConfiguration,
  type SecretProviderRegistry,
} from '@themoltnet/sdk';
import {
  type FileSecretProvider,
  type ProjectBinding,
  ProjectConfigError,
} from '@themoltnet/sdk/node';
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
import {
  buildCatalogue,
  type CatalogueAgentPort,
  type CatalogueDiaryRecord,
} from './catalogue.js';
import {
  readCatalogueProject,
  readCatalogueProjects,
} from './catalogue-project-reader.js';
import type { ConnectionSettingsStore } from './connection-settings.js';
import { enrollIdentityTeam, type TeamEnrollmentInput } from './enrollment.js';
import { AgentServerHttpError } from './http-error.js';
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
import {
  InvalidOperatorGrantError,
  type OperatorOAuth,
} from './operator-oauth.js';
import { LocalProjectBindings, locationEndpoint } from './project-bindings.js';
import {
  checkUnavailable,
  NATIVE_REQUEST_BUDGET_MS,
  projectUnavailable,
  verifyProjectTarget,
} from './project-target.js';
import {
  AGENT_SERVER_SCHEMAS,
  AgentServerRouteSchemas,
  NATIVE_RUN_FIELDS,
} from './protocol.js';
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
  type RunRecord,
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
  /** Private socket listener accepts only the managed native process grant. */
  nativeOnly?: boolean;
  store: AgentServerStore;
  secrets: FileSecretProvider;
  secretProviders: SecretProviderRegistry;
  externalSecretProviders: SecretProviderRegistry;
  nativeGrant: NativeGrantService;
  connectionSettings?: ConnectionSettingsStore;
  operatorOAuth?: OperatorOAuth;
  operatorApiUrl?: string;
  runs: RunManager;
  subscriptions: ProviderLoginService;
  providers: ProviderConfigurationService;
  allowedOrigins: readonly string[];
  /** The Agent Server base URL origin, so the approval page may CORS to itself. */
  selfOrigin?: string;
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
  /** Override used by focused project-location deadline tests. */
  projectSaveTimeoutMs?: number;
  /** Optional OpenAPI plugin registration used by deterministic codegen. */
  registerOpenApi?: (app: FastifyInstance) => void;
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
  input: BuildAgentServerOptions,
): FastifyInstance {
  const options = { ...input };
  const { nativeGrant } = options;
  const oauth = options.operatorOAuth;
  let restartRequired = false;

  const fastifyOptions = { bodyLimit: BODY_LIMIT };
  const app = options.logger
    ? Fastify({ ...fastifyOptions, loggerInstance: options.logger })
    : Fastify(fastifyOptions);

  app.addHook('onListen', async () => {
    const address = app.server.address();
    if (address && typeof address !== 'string') {
      options.selfOrigin = `http://127.0.0.1:${address.port}`;
    }
  });

  options.registerOpenApi?.(app);
  for (const schema of AGENT_SERVER_SCHEMAS) app.addSchema(schema);

  // Native control is not a browser surface: its private socket and
  // process-scoped token are the authority. Browser-origin configuration
  // belongs exclusively to the separately invoked standalone TCP mode.
  const securityOptions = {
    allowedHeaders: [AGENT_SERVER_TOKEN_HEADER],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  } as const;
  if (options.nativeOnly) {
    registerLoopbackSecurity(app, {
      ...securityOptions,
      isOriginAllowed: (origin) => origin === NATIVE_CLIENT_ORIGIN,
    });
  } else {
    const browserOrigins = new OriginAllowlist(options.allowedOrigins);
    registerLoopbackSecurity(app, {
      ...securityOptions,
      isOriginAllowed: (origin) =>
        origin === NATIVE_CLIENT_ORIGIN ||
        origin === options.selfOrigin ||
        browserOrigins.has(origin),
    });
  }
  // Bound browser signature work before attempting asymmetric verification.
  // A fixed process-wide bucket cannot grow with attacker-chosen origins/IPs;
  // native process grants retain their independent, inexpensive verification.
  let verificationWindow = Date.now();
  let verifications = 0;
  const browserVerification = new WeakMap<FastifyRequest, Promise<void>>();
  function verifyBrowser(
    request: FastifyRequest,
    token: string,
  ): Promise<void> {
    const previous = browserVerification.get(request);
    if (previous) return previous;
    if (Date.now() - verificationWindow >= RATE_LIMIT_WINDOW_MS) {
      verificationWindow = Date.now();
      verifications = 0;
    }
    if (++verifications > RATE_LIMIT_MAX)
      throw new AgentServerHttpError(
        429,
        'rate_limited',
        'Too many authorization attempts',
      );
    if (!oauth)
      throw new AgentServerHttpError(
        503,
        'oauth_unavailable',
        'Local OAuth is not configured',
      );
    const pending = oauth.verifyBrowser(token);
    browserVerification.set(request, pending);
    return pending;
  }
  function hasValidNativeGrant(
    origin: string | undefined,
    token: string | string[] | undefined,
  ): boolean {
    if (
      origin !== NATIVE_CLIENT_ORIGIN ||
      typeof token !== 'string' ||
      token.length === 0
    )
      return false;
    try {
      nativeGrant.verify(origin, token);
      return true;
    } catch (error) {
      if (error instanceof NativeGrantError) return false;
      throw error;
    }
  }
  const nativeVerification = new WeakSet<FastifyRequest>();
  function requireNativeGrant(request: FastifyRequest): void {
    if (nativeVerification.has(request)) return;
    const origin = request.headers.origin;
    const token = request.headers[AGENT_SERVER_TOKEN_HEADER];
    if (hasValidNativeGrant(origin, token)) {
      nativeVerification.add(request);
      return;
    }
    request.log.warn(
      { stage: 'native-control-authorization', outcome: 'rejected' },
      'Native control authorization failed',
    );
    throw new AgentServerHttpError(
      401,
      'native_token_invalid',
      'Native authorization required',
    );
  }
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
            authenticated = hasValidNativeGrant(origin, presented);
          else {
            if (!oauth) return `unauth:${origin}:${request.ip}`;
            await verifyBrowser(request, presented);
            authenticated = true;
          }
        } catch (error) {
          if (error instanceof AgentServerHttpError && error.statusCode === 429)
            throw error;
          if (origin === NATIVE_CLIENT_ORIGIN) throw error;
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
    if (restartRequired)
      throw new AgentServerHttpError(
        409,
        'restart_required',
        'Restart the Agent Server to apply connection settings',
      );
    const origin = requireOriginHeader(request.headers);
    const token = request.headers[AGENT_SERVER_TOKEN_HEADER];
    if (typeof token !== 'string' || token.length === 0) {
      throw new AgentServerHttpError(
        401,
        'authorization_required',
        'Local control token is required',
      );
    }
    if (origin === NATIVE_CLIENT_ORIGIN) {
      requireNativeGrant(request);
    } else {
      try {
        if (!oauth)
          throw new AgentServerHttpError(
            503,
            'oauth_unavailable',
            'Local OAuth is not configured',
          );
        // Consume admission verification once. Later checks on the same SSE
        // request must revalidate expiry and the current operator.
        const admission = browserVerification.get(request);
        browserVerification.delete(request);
        await (admission ?? oauth.verifyBrowser(token));
      } catch (error) {
        if (error instanceof AgentServerHttpError) throw error;
        const code =
          error && typeof error === 'object' && 'code' in error
            ? error.code
            : undefined;
        const rejected =
          error instanceof InvalidOperatorGrantError ||
          (typeof code === 'string' &&
            [
              'ERR_JWT_EXPIRED',
              'ERR_JWT_CLAIM_VALIDATION_FAILED',
              'ERR_JWS_SIGNATURE_VERIFICATION_FAILED',
              'ERR_JWS_INVALID',
              'ERR_JWT_INVALID',
              'ERR_JOSE_ALG_NOT_ALLOWED',
              'ERR_JWKS_NO_MATCHING_KEY',
            ].includes(code));
        request.log.warn(
          {
            stage: 'local-control-authorization',
            outcome: rejected ? 'rejected' : 'unavailable',
            code: typeof code === 'string' ? code : undefined,
          },
          'Local control authorization failed',
        );
        if (!rejected)
          throw new AgentServerHttpError(
            503,
            'authorization_unavailable',
            'Local authorization is unavailable. Check Server settings or retry shortly.',
          );
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
    // preParsing is deliberately after the global onRequest rate limiter and
    // before body parsing and schema validation.
    if (options.nativeOnly) {
      app.addHook('preParsing', async (request) => {
        requireNativeGrant(request);
      });
    }
    app.get(
      '/health',
      { schema: AgentServerRouteSchemas.health },
      async () => ({ status: 'ok' }),
    );
    app.get(
      '/v1/native/connection-settings',
      { schema: { hide: true } },
      async (request) => {
        const settings = await requireNativeOrigin(
          requireAuthorizedOrigin,
          request,
          options.connectionSettings,
        );
        return settings.view();
      },
    );
    app.post(
      '/v1/native/connection-settings',
      { schema: { hide: true } },
      async (request) => {
        const store = await requireNativeOrigin(
          requireAuthorizedOrigin,
          request,
          options.connectionSettings,
        );
        try {
          const settings = options.runs.prepareServerRestart(() =>
            store.save(request.body),
          );
          oauth?.cancel();
          restartRequired = true;
          return settings;
        } catch (error) {
          throw new AgentServerHttpError(
            400,
            'invalid_connection_settings',
            error instanceof Error
              ? error.message
              : 'Invalid connection settings',
          );
        }
      },
    );
    app.get(
      '/oauth/metadata',
      {
        schema: {
          operationId: 'getAgentServerOAuthMetadata',
          tags: ['operator'],
          response: {
            200: {
              type: 'object',
              required: [
                'protocolVersion',
                'instance',
                'issuer',
                'authorizationUrl',
                'tokenUrl',
                'clientId',
                'operatorConfigured',
              ],
              properties: {
                protocolVersion: {
                  type: 'integer',
                  const: OPERATOR_OAUTH.protocolVersion,
                },
                instance: { type: 'string', format: 'uuid' },
                issuer: { type: 'string' },
                authorizationUrl: { type: 'string' },
                tokenUrl: { type: 'string' },
                clientId: { type: 'string' },
                operatorConfigured: { type: 'boolean' },
              },
            },
          },
        },
      },
      async () => {
        if (!oauth)
          throw new AgentServerHttpError(
            503,
            'oauth_unavailable',
            'Local OAuth is not configured',
          );
        return oauth.metadata();
      },
    );
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
        const operator = await requireNativeOrigin(
          requireAuthorizedOrigin,
          request,
          oauth,
        );
        await operator.authorize(
          undefined,
          requestOperationSignal(request, options.shutdownSignal),
        );
        return { state: 'authorized' };
      },
    );
    app.post(
      '/v1/operator/cancel',
      {
        schema: {
          operationId: 'cancelAgentServerOperatorApproval',
          tags: ['operator'],
          security: [{ agentServerToken: [] }],
          response: {
            200: {
              type: 'object',
              properties: { state: { type: 'string', const: 'cancelled' } },
              required: ['state'],
            },
          },
        },
      },
      async (request) => {
        const operator = await requireNativeOrigin(
          requireAuthorizedOrigin,
          request,
          oauth,
        );
        operator.cancel();
        return { state: 'cancelled' };
      },
    );
    app.delete(
      '/v1/operator',
      {
        schema: {
          operationId: 'removeAgentServerOperator',
          tags: ['operator'],
          security: [{ agentServerToken: [] }],
          response: {
            200: {
              type: 'object',
              properties: { state: { type: 'string', const: 'removed' } },
              required: ['state'],
            },
          },
        },
      },
      async (request) => {
        const operator = await requireNativeOrigin(
          requireAuthorizedOrigin,
          request,
          oauth,
        );
        operator.removeOperator();
        return { state: 'removed' };
      },
    );
    registerStatusRoute(app, options, requireAuthorizedOrigin);
    registerAgentRoutes(app, options, requireAuthorizedOrigin);
    registerProviderRoutes(app, options, requireAuthorizedOrigin);
    registerSubscriptionRoutes(app, options, requireAuthorizedOrigin);
    registerRunRoutes(app, options, requireAuthorizedOrigin);
    registerCatalogueRoute(app, options, requireAuthorizedOrigin);
    registerProjectLocationRoutes(app, options, requireAuthorizedOrigin);
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

/**
 * The one native-only gate: a verified Desktop grant, never browser authority.
 * A native-only `resource` that is not configured is refused the same way and
 * returned narrowed otherwise.
 */
async function requireNativeOrigin(
  authorize: AuthorizedOriginGuard,
  request: FastifyRequest,
): Promise<void>;
async function requireNativeOrigin<T>(
  authorize: AuthorizedOriginGuard,
  request: FastifyRequest,
  resource: T | undefined,
): Promise<T>;
async function requireNativeOrigin<T>(
  authorize: AuthorizedOriginGuard,
  request: FastifyRequest,
  ...resource: [T | undefined] | []
): Promise<T | void> {
  if (
    (await authorize(request)) !== NATIVE_CLIENT_ORIGIN ||
    (resource.length > 0 && resource[0] === undefined)
  )
    throw new AgentServerHttpError(
      403,
      'native_required',
      'Native administration required',
    );
  return resource[0];
}

type SaveProjectLocationBody = Omit<ProjectBinding, 'name' | 'apiUrl'> & {
  identity: string;
};

function registerProjectLocationRoutes(
  app: FastifyInstance,
  options: BuildAgentServerOptions,
  authorize: AuthorizedOriginGuard,
): void {
  let locations: LocalProjectBindings | undefined;
  const getLocations = () => {
    const root = options.connectionSettings?.root;
    // Workers inherit MOLTNET_HOME from the same base store; a per-connection
    // root here would write a file no worker reads.
    if (!root)
      throw new AgentServerHttpError(
        503,
        'locations_unavailable',
        'Project locations need the Desktop connection store',
      );
    locations ??= new LocalProjectBindings(root, options.defaultApiUrl, [
      root,
      options.store.root,
      options.store.secretsDir,
    ]);
    return locations;
  };
  const requireNativeRequest = async (request: FastifyRequest) => {
    await requireNativeOrigin(authorize, request);
    if (request.validationError)
      throw new AgentServerHttpError(
        400,
        'invalid_location',
        'Check the project location fields',
      );
  };
  app.get(
    '/v1/native/project-locations',
    { schema: AgentServerRouteSchemas.listProjectLocations },
    async (request) => {
      await requireNativeRequest(request);
      return { locations: await getLocations().list() };
    },
  );
  const saveFields = new Set(
    Object.keys(AgentServerRouteSchemas.saveProjectLocation.body.properties),
  );
  app.put(
    '/v1/native/project-locations/:name',
    {
      schema: AgentServerRouteSchemas.saveProjectLocation,
      attachValidation: true,
      // Ajv strips unknown fields before the handler runs; refuse them here so
      // a caller sending hooks learns they were not saved.
      preValidation: async (request) => {
        await requireNativeOrigin(authorize, request);
        const body = request.body;
        if (
          body &&
          typeof body === 'object' &&
          Object.keys(body).some((key) => !saveFields.has(key))
        )
          throw new AgentServerHttpError(
            400,
            'invalid_location',
            'Check the project location fields',
          );
      },
    },
    async (request) => {
      await requireNativeRequest(request);
      const bindings = getLocations();
      const { name } = request.params as { name: string };
      const { identity, ...location } =
        requireBody<SaveProjectLocationBody>(request);
      const alias = identity.trim();
      requireActivation(options.store, alias);
      const { config } = await loadAgentActivation(options.store, alias);
      if (locationEndpoint(config.endpoints.api) !== bindings.apiUrl)
        throw new AgentServerHttpError(
          400,
          'endpoint_mismatch',
          'Choose an identity for the current server endpoint',
        );
      // One budget for the whole save; a disconnected client also stops it,
      // so nothing is written after Desktop has reported a failure.
      const signal = AbortSignal.any([
        requestOperationSignal(request, options.shutdownSignal),
        AbortSignal.timeout(
          options.projectSaveTimeoutMs ?? NATIVE_REQUEST_BUDGET_MS,
        ),
      ]);
      await verifyLocationTarget(options, alias, location, request.log, signal);
      try {
        return await bindings.save(
          { ...location, name, apiUrl: bindings.apiUrl },
          { signal },
        );
      } catch (error) {
        if (signal.aborted) throw checkUnavailable(error, true);
        throw error;
      }
    },
  );
  app.delete(
    '/v1/native/project-locations/:name',
    {
      schema: AgentServerRouteSchemas.removeProjectLocation,
      attachValidation: true,
    },
    async (request) => {
      await requireNativeRequest(request);
      await getLocations().remove((request.params as { name: string }).name);
      return { removed: true };
    },
  );
}

/**
 * A location save checks only its target team: `readTeam` verifies the team
 * credential and returns its diaries, then the shared check reads the project.
 */
async function verifyLocationTarget(
  options: BuildAgentServerOptions,
  alias: string,
  target: { teamId: string; projectId: string; diaryId?: string },
  logger: FastifyBaseLogger,
  signal: AbortSignal,
): Promise<void> {
  const agent = await catalogueAgent(options, alias);
  if (!agent.teamIds.includes(target.teamId)) throw projectUnavailable();
  let diaries: CatalogueDiaryRecord[] = [];
  await verifyProjectTarget(
    {
      readProject: async (teamId, projectId, readSignal) => {
        const team = await agent.readTeam(teamId, readSignal);
        if (team.team.id !== teamId) throw new Error('Team response mismatch');
        diaries = team.diaries;
        return agent.readProject(teamId, projectId, readSignal);
      },
      readDiary: async (teamId, diaryId) =>
        diaries.find(
          (diary) => diary.id === diaryId && diary.teamId === teamId,
        ) ?? null,
    },
    target,
    { signal, logger },
  );
}

async function catalogueAgent(
  options: BuildAgentServerOptions,
  alias: string,
): Promise<CatalogueAgentPort> {
  return options.catalogueAgentFor
    ? options.catalogueAgentFor(alias)
    : defaultCatalogueAgent(options, alias);
}

async function readIdentityCatalogue(
  options: BuildAgentServerOptions,
  alias: string,
  logger: FastifyBaseLogger,
) {
  // Throws a typed not-found when the alias is not activated here.
  requireActivation(options.store, alias);
  return buildCatalogue({
    agent: await catalogueAgent(options, alias),
    machine: machineCapabilities(options),
    identityDefault: readIdentityDefaultBinding(
      options.store.identityDir(alias),
    ),
    logger,
  });
}

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
      return readIdentityCatalogue(options, alias, request.log);
    },
  );
}

/** Resolve and verify each indexed team independently with its exact key. */
async function defaultCatalogueAgent(
  options: BuildAgentServerOptions,
  alias: string,
): Promise<CatalogueAgentPort> {
  const { config } = await loadAgentActivation(options.store, alias);
  const clients = new Map<
    string,
    ReturnType<typeof requireCredentialSnapshot>['client']
  >();
  const verifiedClient = (teamId: string) => {
    const client = clients.get(teamId);
    if (!client)
      throw new Error('Team must be verified before project discovery');
    return client;
  };
  return {
    teamIds: Object.keys(config.agent_key_refs ?? {}),
    lastVerified: (teamId) =>
      requireActivation(options.store, alias).credentialHealth?.[teamId],
    readTeam: async (teamId, signal) => {
      const activated = await verifyTeamActivation(
        options.store,
        alias,
        options.secretProviders,
        options.externalSecretProviders,
        undefined,
        signal && options.shutdownSignal
          ? AbortSignal.any([signal, options.shutdownSignal])
          : (signal ?? options.shutdownSignal),
        teamId,
      );
      signal?.throwIfAborted();
      const { client, metadata } = requireCredentialSnapshot(activated);
      const [team, diaries, profiles] = await Promise.all([
        client.teams.get(teamId),
        client.diaries.list(),
        client.runtimeProfiles.list({ teamId }),
      ]);
      clients.set(teamId, client);
      return {
        team,
        diaries: diaries.items,
        profiles: profiles.items,
        credential: metadata,
      };
    },
    readProjects: async (teamId) =>
      readCatalogueProjects(verifiedClient(teamId).projects, teamId),
    readProject: async (teamId, projectId, signal) => {
      signal?.throwIfAborted();
      return readCatalogueProject(
        verifiedClient(teamId).projects,
        teamId,
        projectId,
      );
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
      const origin = await requireAuthorizedOrigin(request);
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
        runs: await runViews(runs, origin),
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
        signal: requestOperationSignal(request, options.shutdownSignal),
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
  origin: string,
): Promise<Array<Record<string, unknown>>> {
  return (await runs.listAsync(RUN_HISTORY_LIMIT)).map((record) =>
    runView(record, runs.isActive(record.id), origin),
  );
}

/**
 * Local folders are native-only, as project locations are: other origins see
 * the location name and project, never the path. The snapshot path is
 * daemon-internal for every origin.
 */
function runView(
  record: RunRecord,
  active: boolean,
  origin: string,
): Record<string, unknown> {
  const native = origin === NATIVE_CLIENT_ORIGIN;
  const { source, workspace, ...rest } = record;
  const view: Record<string, unknown> = {
    ...rest,
    ...(native && source !== undefined ? { source } : {}),
    active,
  };
  if (workspace) {
    const {
      configPath: _configPath,
      source: resolvedSource,
      ...shared
    } = workspace;
    view.workspace = {
      ...shared,
      ...(native && resolvedSource !== undefined
        ? { source: resolvedSource }
        : {}),
    };
  }
  return view;
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
      return runViews(runs, await requireAuthorizedOrigin(request));
    },
  );
  app.post(
    '/v1/runs',
    { schema: AgentServerRouteSchemas.startRun, attachValidation: true },
    async (request, reply) => {
      const origin = await requireAuthorizedOrigin(request);
      const body = requireBody<Record<string, unknown>>(request);
      // General work (projectId: null) stays open to every authorized origin.
      if (
        NATIVE_RUN_FIELDS.some(
          (key) => body[key] !== undefined && body[key] !== null,
        )
      )
        await requireNativeOrigin(async () => origin, request);
      if (request.validationError)
        throw new AgentServerHttpError(
          400,
          'invalid_spec',
          `Check the run fields: ${request.validationError.message}`,
        );
      const diaryId = optionalString(body, 'diaryId');
      const record = await runs.start(
        {
          ...(body.projectId === null
            ? { projectId: null }
            : body.projectId !== undefined
              ? { projectId: requireString(body, 'projectId') }
              : {}),
          ...(body.location !== undefined
            ? { location: requireString(body, 'location') }
            : {}),
          ...(body.source !== undefined
            ? { source: requireString(body, 'source') }
            : {}),
          ...(body.strategy !== undefined
            ? {
                strategy: requireString(
                  body,
                  'strategy',
                ) as ProjectBinding['strategy'],
              }
            : {}),
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
        .send(runView(record, runs.isActive(record.id), origin));
    },
  );
  app.delete(
    '/v1/runs/:runId',
    { schema: AgentServerRouteSchemas.stopRun },
    async (request) => {
      const origin = await requireAuthorizedOrigin(request);
      const { runId } = request.params as { runId: string };
      const record = runs.stop(runId);
      return runView(record, runs.isActive(record.id), origin);
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
      const origin = await requireAuthorizedOrigin(request);
      const { runId } = request.params as { runId: string };
      const record = runs.status(runId);
      const redact = localPathRedactor(record, origin, options);
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
          ].map(redact),
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
      const origin = await requireAuthorizedOrigin(request);
      const { runId } = request.params as { runId: string };
      const record = runs.status(runId);
      const redact = localPathRedactor(record, origin, options);
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
          for (const line of lines) await writeData(redact(line));
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

/**
 * Worker logs name local folders (the chosen source, state and HOME under the
 * store). Non-native origins get them replaced, as `runView` does for records.
 * The user's home directory is included so any other path under it cannot
 * reveal the OS account name.
 */
function localPathRedactor(
  record: RunRecord,
  origin: string,
  options: BuildAgentServerOptions,
): (line: string) => string {
  if (origin === NATIVE_CLIENT_ORIGIN) return (line) => line;
  const paths = new Set<string>();
  for (const path of [
    record.source,
    record.workspace?.source,
    options.store.root,
    options.connectionSettings?.root,
    homedir(),
  ]) {
    if (!path) continue;
    paths.add(path);
    try {
      paths.add(realpathSync.native(path));
    } catch {
      // A folder removed since the run keeps only its recorded form.
    }
  }
  // Longest first, so a folder inside the store is not half-replaced.
  const ordered = [...paths].sort((a, b) => b.length - a.length);
  return (line) =>
    ordered.reduce((text, path) => text.split(path).join('<local path>'), line);
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
      (!options.nativeOnly &&
        (options.allowedOrigins.includes(origin) ||
          origin === options.selfOrigin)))
  );
}

function normalizeAgentServerError(error: unknown): {
  statusCode: number;
  code: string;
  message: string;
} {
  if (error instanceof ProjectConfigError) {
    if (error.kind === 'version')
      return {
        statusCode: 409,
        code: 'config_version',
        message:
          'The project locations file was written by a newer MoltNet. Update this app.',
      };
    if (error.kind === 'io')
      // Detail can include local paths; it is logged, not returned.
      return {
        statusCode: 500,
        code: 'config_unavailable',
        message:
          'The project locations file could not be read or written. Check its ownership and permissions.',
      };
    return {
      statusCode: 400,
      code: 'invalid_location',
      message: error.message,
    };
  }
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
      statusCode:
        error.code === 'run_not_found'
          ? 404
          : error.code === 'invalid_store'
            ? 409
            : 400,
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
