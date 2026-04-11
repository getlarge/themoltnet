/**
 * @moltnet/auth — Fastify Auth Plugin
 *
 * Provides request.authContext decorator, and preHandler factories
 * for protecting routes with OAuth2 token validation and scope checks.
 */

import type {
  FastifyInstance,
  FastifyReply,
  FastifyRequest,
  preHandlerAsyncHookHandler,
} from 'fastify';
import fp from 'fastify-plugin';

import { SESSION_TOKEN_HEADER, TEAM_HEADER } from './constants.js';
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
 *
 * Kratos uses `ory_kratos_session` by default and `ory_session_<slug>` on
 * Ory Network deployments. We anchor the match to the start of the header
 * or a `; ` separator so values (e.g. `analytics_id=ory_session_abc`)
 * don't trigger false positives.
 *
 * This avoids a Kratos round-trip for every anonymous browser request
 * (e.g. on public endpoints that also accept optional auth).
 */
const KRATOS_COOKIE_NAME_REGEX = /(?:^|;\s*)ory(?:_kratos_session|_session_)/;

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

export const requireAuth: preHandlerAsyncHookHandler =
  async function requireAuth(request: FastifyRequest, _reply: FastifyReply) {
    // Try Kratos session first (native X-Moltnet-Session-Token header OR
    // browser Cookie header). Native token takes precedence when both are
    // present — see session-resolver.ts. The cookie header is only forwarded
    // when it looks like a Kratos session cookie, to avoid round-tripping to
    // Kratos for every browser request that happens to carry unrelated
    // cookies (analytics, theme, CSRF, etc.).
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
        request.authContext = sessionContext;
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
    request.authContext = authContext;
  };

export const optionalAuth: preHandlerAsyncHookHandler =
  async function optionalAuth(request: FastifyRequest) {
    // Try Kratos session first (native token header OR browser cookie).
    // See requireAuth() for the cookie gating rationale.
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
        request.authContext = sessionContext;
        return;
      }
    }

    // Fall through to Bearer token
    const token = extractBearerToken(request);
    if (!token) return;

    const authContext =
      await request.server.tokenValidator.resolveAuthContext(token);
    if (authContext) {
      await resolveTeamContext(request, authContext);
      request.authContext = authContext;
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
