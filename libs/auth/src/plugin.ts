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
import type { SessionResolver } from './session-resolver.js';
import type { TokenValidator } from './token-validator.js';
import type { AuthContext } from './types.js';

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
}

declare module 'fastify' {
  interface FastifyInstance {
    tokenValidator: TokenValidator;
    permissionChecker: PermissionChecker;
    relationshipWriter: RelationshipWriter;
    teamResolver: TeamResolver;
    sessionResolver: SessionResolver | null;
  }
  interface FastifyRequest {
    authContext: AuthContext | null;
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
    decorateSafe('tokenValidator', opts.tokenValidator);
    decorateSafe('permissionChecker', opts.permissionChecker);
    decorateSafe('relationshipWriter', opts.relationshipWriter);
    decorateSafe('teamResolver', opts.teamResolver);
    decorateSafe('sessionResolver', opts.sessionResolver ?? null);

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
  const requestedTeamId = Array.isArray(teamIdHeader)
    ? teamIdHeader[0]
    : teamIdHeader;

  if (requestedTeamId) {
    const subjectNs =
      authContext.subjectType === 'human'
        ? KetoNamespace.Human
        : KetoNamespace.Agent;
    const canAccess = await request.server.permissionChecker.canAccessTeam(
      requestedTeamId,
      authContext.identityId,
      subjectNs,
    );
    if (!canAccess) {
      const error = createAuthError('Not a member of the requested team');
      error.statusCode = 403;
      error.code = 'FORBIDDEN';
      throw error;
    }
    authContext.currentTeamId = requestedTeamId;
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
async function resolveIdentityInto(request: FastifyRequest): Promise<boolean> {
  if (request.authContext) return true;

  // Try Kratos session first (native X-Moltnet-Session-Token header OR browser
  // Cookie header). Native token takes precedence when both are present — see
  // session-resolver.ts. The cookie header is only forwarded when it looks like
  // a Kratos session cookie, to avoid round-tripping to Kratos for every
  // browser request that happens to carry unrelated cookies.
  const sessionToken = extractSessionToken(request);
  const rawCookie = extractCookieHeader(request);
  const cookie =
    rawCookie && cookieLooksLikeKratosSession(rawCookie) ? rawCookie : null;
  if ((sessionToken || cookie) && request.server.sessionResolver) {
    const sessionContext = await request.server.sessionResolver.resolveSession({
      sessionToken,
      cookie,
    });
    if (sessionContext) {
      applyAuthContext(request, sessionContext);
      return true;
    }
    // Invalid session — fall through to Bearer token.
  }

  const token = extractBearerToken(request);
  if (!token) return false;

  const authContext =
    await request.server.tokenValidator.resolveAuthContext(token);
  if (!authContext) return false;

  applyAuthContext(request, authContext);
  return true;
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
    try {
      await resolveIdentityInto(request);
    } catch (err) {
      request.log.debug(
        { err, path: request.url },
        'auth: onRequest identity resolution failed; continuing unauthenticated',
      );
    }
  };

export const requireAuth: preHandlerAsyncHookHandler =
  async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
    // Identity is normally resolved by the populateAuthContext onRequest hook;
    // resolveIdentityInto short-circuits if so. If not (e.g. a unit test calling
    // requireAuth directly), resolve it now with granular diagnostics. Team
    // context is ALWAYS resolved here — it is enforcement, not identity, so it
    // runs even when identity was pre-resolved at onRequest.
    if (request.authContext) {
      await resolveTeamContext(request, request.authContext);
      return;
    }

    // Try Kratos session first (native X-Moltnet-Session-Token header OR
    // browser Cookie header). See resolveIdentityInto for cookie gating.
    const sessionToken = extractSessionToken(request);
    const rawCookie = extractCookieHeader(request);
    const cookie =
      rawCookie && cookieLooksLikeKratosSession(rawCookie) ? rawCookie : null;
    if ((sessionToken || cookie) && request.server.sessionResolver) {
      const sessionContext =
        await request.server.sessionResolver.resolveSession({
          sessionToken,
          cookie,
        });
      if (sessionContext) {
        await resolveTeamContext(request, sessionContext);
        applyAuthContext(request, sessionContext);
        return;
      }
      // Invalid session — fall through to Bearer token
    }

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

    const authContext =
      await request.server.tokenValidator.resolveAuthContext(token);
    if (!authContext) {
      request.log.warn(
        { ip: request.ip, path: request.url },
        'auth: invalid or expired token',
      );
      throw createAuthError('Invalid or expired token');
    }

    await resolveTeamContext(request, authContext);
    applyAuthContext(request, authContext);
  };

export const optionalAuth: preHandlerAsyncHookHandler =
  async function optionalAuth(request: FastifyRequest) {
    // Identity is usually pre-resolved by the onRequest hook (short-circuits).
    // When a context is present, still resolve team context so an explicit
    // x-moltnet-team-id is honored/enforced for the optionally-authed handler.
    const resolved = await resolveIdentityInto(request);
    if (resolved && request.authContext) {
      await resolveTeamContext(request, request.authContext);
    }
  };

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
