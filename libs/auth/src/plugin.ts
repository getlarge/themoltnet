/**
 * @moltnet/auth — Fastify Auth Plugin
 *
 * Provides request.authContext decorator, and preHandler factories
 * for protecting routes with OAuth2 token validation and scope checks.
 */

import { setRequestContextField } from '@moltnet/observability';
import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  onRequestAsyncHookHandler,
  onRouteHookHandler,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import {
  KRATOS_COOKIE_NAME_REGEX,
  SESSION_TOKEN_HEADER,
  TEAM_HEADER,
} from './constants.js';
import { KetoNamespace } from './keto-constants.js';
import type { PermissionChecker } from './permission-checker.js';
import type { RelationshipWriter } from './relationship-writer.js';
import { RemoteAuthenticationError } from './remote-auth-error.js';
import type { CredentialScope } from './scopes.js';
import type { SessionResolver } from './session-resolver.js';
import type { TokenValidator } from './token-validator.js';
import type { AuthContext } from './types.js';

type AuthResolutionOutcome =
  | { status: 'authenticated'; context: AuthContext }
  | { status: 'invalid' | 'missing' }
  | { status: 'upstream-error'; error: unknown };

export interface TeamResolver {
  /** Find the personal team ID for a subject. Returns null if none exists yet. */
  findPersonalTeamId(subjectId: string): Promise<string | null>;
}

export interface AuthPluginOptions {
  tokenValidator: TokenValidator;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  teamResolver: TeamResolver;
  /** Optional Kratos session resolver for direct session-based auth (dashboard). */
  sessionResolver?: SessionResolver;
  /** Phased scope rollout. Defaults to `enforce` for library consumers. */
  scopeEnforcementMode?: ScopeEnforcementMode;
  /** Low-cardinality sink for would-be and enforced scope denials. */
  onScopeDenial?: (event: ScopeDenialEvent) => void | Promise<void>;
  /** Fail route registration when principal-auth policy is incomplete. */
  enforceRouteScopeDeclarations?: boolean;
}

export type ScopeEnforcementMode = 'measure' | 'warn' | 'enforce';

export interface ScopeDenialEvent {
  mode: ScopeEnforcementMode;
  operationId: string;
  requiredScope: string;
  subjectType: AuthContext['subjectType'];
}

declare module 'fastify' {
  interface FastifyContextConfig {
    auth?: {
      deferInaccessibleTeamAuthorization?: boolean;
      /**
       * Route classification for credentials bound to one team.
       *
       * Unclassified routes deny bound credentials. `identity` routes are
       * team-agnostic and operate without any team selection. `team` routes
       * resolve the bound team: an explicit `x-moltnet-team-id` header must
       * match the binding, and when the header is omitted the binding's single
       * team is inferred (see `resolveTeamContext`). Resolving the team is a
       * request-context ceiling only — a handler that addresses a specific
       * team-owned resource by id must still enforce that the resource belongs
       * to the resolved `currentTeamId`, or a caller with cross-team access
       * could reach a resource outside the bound team.
       */
      credentialBindingScope?: 'identity' | 'team';
      /**
       * Credential scopes required by this route. An explicitly empty array
       * declares that authentication is required but no credential scope is.
       */
      requiredScopes?: readonly CredentialScope[];
    };
  }
  interface FastifyInstance {
    tokenValidator: TokenValidator;
    permissionChecker: PermissionChecker;
    relationshipWriter: RelationshipWriter;
    teamResolver: TeamResolver;
    sessionResolver: SessionResolver | null;
    scopeEnforcementMode: ScopeEnforcementMode;
    onScopeDenial: ((event: ScopeDenialEvent) => void | Promise<void>) | null;
  }
  interface FastifyRequest {
    authContext: AuthContext | null;
    authResolution: Promise<AuthResolutionOutcome> | null;
  }
}

function extractSessionToken(request: FastifyRequest): string | null {
  const header = request.headers[SESSION_TOKEN_HEADER];
  const token = Array.isArray(header) ? header[0] : header;
  return token?.trim() || null;
}

/**
 * Extract the raw `Cookie` request header for Kratos browser session auth.
 * The value is forwarded unchanged to Kratos, which extracts
 * `ory_kratos_session` (or whichever cookie name its deployment uses) itself.
 * We intentionally do not parse or rename cookies here.
 */
function extractCookieHeader(request: FastifyRequest): string | null {
  const header = request.headers.cookie as string | string[] | undefined;
  // RFC 6265 says browsers MUST send a single Cookie header, but proxies
  // and test harnesses can produce arrays. Join so a session cookie in any
  // element is still forwarded to Kratos.
  const value = Array.isArray(header) ? header.join('; ') : header;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Does the raw Cookie header contain a Kratos session cookie by NAME?
 * Uses the shared {@link KRATOS_COOKIE_NAME_REGEX} so this gating and the
 * rate-limit key extractor recognize the same cookie names.
 *
 * This avoids a Kratos round-trip for every anonymous browser request
 * (e.g. on public endpoints that also accept optional auth).
 */
function cookieLooksLikeKratosSession(cookie: string): boolean {
  return KRATOS_COOKIE_NAME_REGEX.test(cookie);
}

function extractBearerToken(request: FastifyRequest): string | null {
  const header = request.headers.authorization;
  if (!header) return null;

  const parts = header.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') return null;

  const token = parts[1].trim();
  return token || null;
}

export const authPlugin = fp(
  async function authPluginImpl(
    fastify: FastifyInstance,
    opts: AuthPluginOptions,
  ) {
    const decorateSafe = (name: string, value: unknown) => {
      if (!fastify.hasDecorator(name)) {
        fastify.decorate(name, value);
      }
    };

    fastify.decorateRequest('authContext', null);
    fastify.decorateRequest('authResolution', null);
    decorateSafe('tokenValidator', opts.tokenValidator);
    decorateSafe('permissionChecker', opts.permissionChecker);
    decorateSafe('relationshipWriter', opts.relationshipWriter);
    decorateSafe('teamResolver', opts.teamResolver);
    decorateSafe('sessionResolver', opts.sessionResolver ?? null);
    decorateSafe(
      'scopeEnforcementMode',
      opts.scopeEnforcementMode ?? 'enforce',
    );
    decorateSafe('onScopeDenial', opts.onScopeDenial ?? null);

    if (opts.enforceRouteScopeDeclarations) {
      fastify.addHook('onRoute', assertRouteScopeDeclarations);
    }

    // Resolve authContext early (non-fatally) so onRequest-phase consumers —
    // notably @fastify/rate-limit, which keys on identityId — see the verified
    // principal. Enforcement still happens per-route via requireAuth/requireScopes
    // at preHandler. Registered as a global onRequest hook; because the auth
    // plugin is registered before the rate-limit plugin, this runs first.
    fastify.addHook('onRequest', populateAuthContext);
  },
  {
    name: '@moltnet/auth',
    fastify: '5.x',
  },
);

function createAuthError(message: string): Error & {
  statusCode: number;
  code: string;
  detail: string;
} {
  const error = new Error(message) as Error & {
    statusCode: number;
    code: string;
    detail: string;
  };
  error.statusCode = 401;
  error.code = 'UNAUTHORIZED';
  error.detail = message;
  return error;
}

export function routeUsesPrincipalAuth(routeOptions: {
  preHandler?: unknown;
  schema?: unknown;
}): boolean {
  const handlers = Array.isArray(routeOptions.preHandler)
    ? routeOptions.preHandler
    : routeOptions.preHandler
      ? [routeOptions.preHandler]
      : [];
  if (handlers.includes(requireAuth) || handlers.includes(optionalAuth)) {
    return true;
  }

  const schema =
    typeof routeOptions.schema === 'object' && routeOptions.schema !== null
      ? (routeOptions.schema as Record<string, unknown>)
      : null;
  if (!Array.isArray(schema?.security)) return false;
  return schema.security.some((requirement) => {
    if (typeof requirement !== 'object' || requirement === null) return false;
    return (
      'bearerAuth' in requirement ||
      'sessionAuth' in requirement ||
      'cookieAuth' in requirement
    );
  });
}

const assertRouteScopeDeclarations: onRouteHookHandler = function (
  routeOptions,
): void {
  if (!routeUsesPrincipalAuth(routeOptions)) return;

  const schema =
    typeof routeOptions.schema === 'object' && routeOptions.schema !== null
      ? (routeOptions.schema as Record<string, unknown>)
      : null;
  const operation =
    (typeof schema?.operationId === 'string' ? schema.operationId : null) ??
    `${String(routeOptions.method)} ${routeOptions.url ?? '<unknown>'}`;
  const auth = routeOptions.config?.auth;
  if (!auth?.credentialBindingScope) {
    throw new Error(
      `Authenticated route ${operation} must declare credentialBindingScope`,
    );
  }
  if (!Object.hasOwn(auth, 'requiredScopes')) {
    throw new Error(
      `Authenticated route ${operation} must declare requiredScopes`,
    );
  }
};

/**
 * Assign authContext to the request and propagate identity fields into
 * the observability ALS store + bind them as pino child bindings on
 * request.log. Centralized here so every code path that resolves an
 * auth context (Kratos session, OAuth bearer, dual flow) gets the
 * same enrichment without duplicating the wire-up.
 *
 * The ALS write feeds the pino mixin (used by app.log calls in service
 * layer); the request.log child binding feeds Fastify's request logger
 * (used by route handlers and the per-request lifecycle logs Fastify
 * itself emits).
 */
function applyAuthContext(
  request: FastifyRequest,
  authContext: AuthContext,
): void {
  request.authContext = authContext;
  setRequestContextField('identityId', authContext.identityId);
  setRequestContextField('subjectType', authContext.subjectType);
  if (authContext.clientId)
    setRequestContextField('clientId', authContext.clientId);
  if (authContext.currentTeamId)
    setRequestContextField('currentTeamId', authContext.currentTeamId);

  const bindings: Record<string, string> = {
    identityId: authContext.identityId,
    subjectType: authContext.subjectType,
  };
  if (authContext.clientId) bindings.clientId = authContext.clientId;
  if (authContext.currentTeamId)
    bindings.currentTeamId = authContext.currentTeamId;
  request.log = request.log.child(bindings);
}

/**
 * Resolve team context from x-moltnet-team-id header.
 * Shared by requireAuth and optionalAuth.
 */
async function resolveTeamContext(
  request: FastifyRequest,
  authContext: AuthContext,
): Promise<void> {
  const teamIdHeader = request.headers[TEAM_HEADER];
  const rawRequestedTeamId = Array.isArray(teamIdHeader)
    ? teamIdHeader[0]
    : teamIdHeader;

  if (rawRequestedTeamId !== undefined && !rawRequestedTeamId.trim()) {
    const error = createAuthError('Team header must not be empty');
    error.statusCode = 400;
    error.code = 'BAD_REQUEST';
    throw error;
  }

  const requestedTeamId = rawRequestedTeamId?.trim();

  const constrainedTeamId =
    authContext.subjectType === 'agent'
      ? authContext.credentialBinding?.boundTeamId
      : undefined;

  const credentialScope =
    request.routeOptions.config.auth?.credentialBindingScope;

  if (constrainedTeamId && !credentialScope) {
    const error = createAuthError(
      'Team-bound credential is not permitted on this route',
    );
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  if (
    requestedTeamId &&
    constrainedTeamId &&
    requestedTeamId !== constrainedTeamId
  ) {
    const error = createAuthError('Credential is not valid for requested team');
    error.statusCode = 403;
    error.code = 'FORBIDDEN';
    throw error;
  }

  // A team-bound credential names exactly one team, so a `team`-scoped route
  // infers it when the caller omits the header — there is nothing to
  // disambiguate, and the binding still caps the credential to that one team
  // (a mismatched header is rejected above; an explicitly empty header is
  // rejected earlier). `identity`-scoped routes stay team-agnostic and never
  // infer, so identity-safe operations keep working without a team.
  const teamId =
    requestedTeamId ??
    (constrainedTeamId && credentialScope === 'team'
      ? constrainedTeamId
      : undefined);

  if (teamId) {
    const subjectNs =
      authContext.subjectType === 'human'
        ? KetoNamespace.Human
        : KetoNamespace.Agent;
    const canAccess = await request.server.permissionChecker.canAccessTeam(
      teamId,
      authContext.identityId,
      subjectNs,
    );
    if (!canAccess) {
      if (
        request.routeOptions.config.auth?.deferInaccessibleTeamAuthorization
      ) {
        authContext.currentTeamId = teamId;
        return;
      }
      const error = createAuthError('Not a member of the requested team');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    authContext.currentTeamId = teamId;
  }
}

/**
 * Non-fatally resolve and apply the request's *identity* (authContext) if a
 * valid credential is present. Returns true if a context was applied. Does NOT
 * resolve team context or throw on a missing/invalid credential — those are
 * enforcement concerns layered on by requireAuth at preHandler. Shared by the
 * global `populateAuthContext` onRequest hook and `optionalAuth` so identity
 * resolution has exactly one implementation.
 *
 * Idempotent: returns true immediately if authContext is already set, so a
 * normal request never pays the resolution cost (JWKS verify / Hydra introspect
 * / Kratos session call) twice.
 */
async function resolveIdentity(
  request: FastifyRequest,
): Promise<AuthResolutionOutcome> {
  if (request.authContext) {
    return { status: 'authenticated', context: request.authContext };
  }

  // Try Kratos session first (native X-Moltnet-Session-Token header OR browser
  // Cookie header). Native token takes precedence when both are present — see
  // session-resolver.ts. The cookie header is only forwarded when it looks like
  // a Kratos session cookie, to avoid round-tripping to Kratos for every
  // browser request that happens to carry unrelated cookies.
  const sessionToken = extractSessionToken(request);
  const rawCookie = extractCookieHeader(request);
  const cookie =
    rawCookie && cookieLooksLikeKratosSession(rawCookie) ? rawCookie : null;
  let upstreamError: unknown;
  if ((sessionToken || cookie) && request.server.sessionResolver) {
    try {
      const sessionContext =
        await request.server.sessionResolver.resolveSession({
          sessionToken,
          cookie,
        });
      if (sessionContext) {
        applyAuthContext(request, sessionContext);
        return { status: 'authenticated', context: sessionContext };
      }
    } catch (error) {
      upstreamError = error;
    }
  }

  const token = extractBearerToken(request);
  if (!token) {
    if (upstreamError)
      return { status: 'upstream-error', error: upstreamError };
    return {
      status: sessionToken || cookie ? 'invalid' : 'missing',
    };
  }

  try {
    const authContext =
      await request.server.tokenValidator.resolveAuthContext(token);
    if (!authContext) {
      if (upstreamError)
        return { status: 'upstream-error', error: upstreamError };
      return { status: 'invalid' };
    }

    applyAuthContext(request, authContext);
    return { status: 'authenticated', context: authContext };
  } catch (error) {
    return { status: 'upstream-error', error };
  }
}

function resolveIdentityOnce(
  request: FastifyRequest,
): Promise<AuthResolutionOutcome> {
  request.authResolution ??= resolveIdentity(request);
  return request.authResolution;
}

/**
 * Global `onRequest` hook that populates `request.authContext` for any request
 * carrying a valid credential, BEFORE later onRequest hooks (notably
 * @fastify/rate-limit, which keys on identityId) run. Non-fatal: requests
 * without a credential — or to public routes — proceed with `authContext` null.
 * Resolves identity only; team-context enforcement and the 401 stay in
 * requireAuth at preHandler.
 *
 * This is the fix for #1336: the rate limiter runs at onRequest, so identity
 * must be resolved at onRequest (not the auth preHandler) for the limiter to
 * bucket by the verified principal instead of falling back to IP.
 */
export const populateAuthContext: onRequestAsyncHookHandler =
  async function populateAuthContext(request: FastifyRequest) {
    // Identity resolution is non-fatal here; never let it abort the request.
    // An invalid/garbage credential simply leaves authContext null (the request
    // is then IP-keyed and, on protected routes, 401'd by requireAuth).
    const outcome = await resolveIdentityOnce(request);
    if (outcome.status === 'upstream-error') {
      const remoteError =
        outcome.error instanceof RemoteAuthenticationError
          ? outcome.error
          : null;
      request.log.warn(
        {
          path: request.url,
          reason: 'upstream_error',
          operation: remoteError?.operation ?? 'unknown',
          kind: remoteError?.kind ?? 'unknown',
          retryAfter: remoteError?.retryAfter,
        },
        'auth: onRequest identity resolution failed; continuing unauthenticated',
      );
    }
  };

export const requireAuth: preHandlerAsyncHookHandler =
  async function requireAuth(request: FastifyRequest, reply: FastifyReply) {
    const outcome = await resolveIdentityOnce(request);
    if (outcome.status === 'authenticated') {
      await enforceRouteScopes(request, reply, outcome.context);
      await resolveTeamContext(request, outcome.context);
      return;
    }
    if (outcome.status === 'upstream-error') throw outcome.error;

    // Bearer token path (OAuth2)
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      request.log.warn(
        { ip: request.ip, path: request.url },
        'auth: missing authorization header',
      );
      throw createAuthError('Missing authorization header');
    }

    if (!authHeader.startsWith('Bearer ')) {
      request.log.warn(
        { ip: request.ip, path: request.url },
        'auth: invalid authorization scheme',
      );
      throw createAuthError('Invalid authorization scheme');
    }

    const token = extractBearerToken(request);
    if (!token) {
      request.log.warn(
        { ip: request.ip, path: request.url },
        'auth: empty bearer token',
      );
      throw createAuthError('Missing authorization header');
    }

    request.log.warn(
      { ip: request.ip, path: request.url },
      'auth: invalid or expired token',
    );
    throw createAuthError('Invalid or expired token');
  };

export const optionalAuth: preHandlerAsyncHookHandler =
  async function optionalAuth(request: FastifyRequest, reply: FastifyReply) {
    // Identity is usually pre-resolved by the onRequest hook (short-circuits).
    // When a context is present, still resolve team context so an explicit
    // x-moltnet-team-id is honored/enforced for the optionally-authed handler.
    // Unlike a route with no auth preHandler, optionalAuth explicitly requests
    // identity-aware behavior. Provider failures therefore propagate as
    // 429/503 instead of silently changing the route to anonymous semantics.
    const outcome = await resolveIdentityOnce(request);
    if (outcome.status === 'upstream-error') throw outcome.error;
    if (outcome.status === 'authenticated') {
      await enforceRouteScopes(request, reply, outcome.context);
      await resolveTeamContext(request, outcome.context);
    }
  };

async function enforceRouteScopes(
  request: FastifyRequest,
  reply: FastifyReply,
  authContext: AuthContext,
): Promise<void> {
  const requiredScopes = request.routeOptions.config.auth?.requiredScopes ?? [];
  const missingScope = requiredScopes.find(
    (scope) => !authContext.scopes.includes(scope),
  );
  if (!missingScope) return;

  const mode = request.server.scopeEnforcementMode;
  const schema =
    typeof request.routeOptions.schema === 'object' &&
    request.routeOptions.schema !== null
      ? (request.routeOptions.schema as Record<string, unknown>)
      : null;
  const operationId =
    typeof schema?.operationId === 'string'
      ? schema.operationId
      : 'unknown-operation';
  try {
    await request.server.onScopeDenial?.({
      mode,
      operationId,
      requiredScope: missingScope,
      subjectType: authContext.subjectType,
    });
  } catch (error) {
    request.log.error(
      {
        err: error,
        mode,
        operationId,
        requiredScope: missingScope,
        subjectType: authContext.subjectType,
      },
      'auth.scope.denial_telemetry_failed',
    );
  }

  if (mode !== 'measure') {
    request.log.warn(
      {
        mode,
        operationId,
        requiredScope: missingScope,
        subjectType: authContext.subjectType,
      },
      'auth.scope.denied',
    );
  }
  if (mode === 'enforce') {
    await requireScopes([...requiredScopes]).call(
      request.server,
      request,
      reply,
    );
  }
}

export function requireScopes(scopes: string[]): preHandlerAsyncHookHandler {
  return async function requireScopesHandler(
    request: FastifyRequest,
    _reply: FastifyReply,
  ) {
    if (!request.authContext) {
      throw createAuthError('Authentication required');
    }

    for (const scope of scopes) {
      if (!request.authContext.scopes.includes(scope)) {
        const error = new Error(`Missing required scope: ${scope}`) as Error & {
          statusCode: number;
          code: string;
          detail: string;
        };
        error.statusCode = 403;
        error.code = 'FORBIDDEN';
        error.detail = `Missing required scope: ${scope}`;
        throw error;
      }
    }
  };
}
