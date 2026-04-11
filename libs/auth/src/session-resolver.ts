/**
 * @moltnet/auth — Kratos Session Resolver
 *
 * Resolves Kratos sessions into HumanAuthContext. Supports two transports:
 *   - Native clients: `X-Moltnet-Session-Token` header → forwarded as
 *     `xSessionToken` to Kratos FrontendApi.toSession().
 *   - Browser clients: raw `Cookie` header → forwarded as `cookie` to
 *     Kratos FrontendApi.toSession(), which extracts `ory_kratos_session`
 *     itself. We deliberately do NOT parse the cookie name on our side to
 *     avoid coupling to Kratos cookie naming conventions.
 *
 * Used by the console/dashboard app for direct session-based authentication,
 * bypassing the OAuth2 client_credentials flow.
 */

import type { FrontendApi } from '@ory/client-fetch';

import type { HumanAuthContext } from './types.js';

/**
 * Minimal logger shape compatible with both Pino (used by Fastify) and a
 * plain console shim. Kept narrow so this module stays framework-agnostic.
 */
export interface SessionResolverLogger {
  warn: (obj: unknown, msg?: string) => void;
}

export interface ResolveSessionInput {
  /** Session token from the `X-Moltnet-Session-Token` header (native clients). */
  sessionToken?: string | null;
  /** Raw `Cookie` header value (browser clients). */
  cookie?: string | null;
}

export interface SessionResolver {
  resolveSession(input: ResolveSessionInput): Promise<HumanAuthContext | null>;
}

/** Default scopes granted to session-authenticated humans. */
const DEFAULT_SESSION_SCOPES = [
  'diary:read',
  'diary:write',
  'human:profile',
  'team:read',
];

export interface SessionResolverConfig {
  /** Scopes to assign to session-authenticated humans */
  scopes?: string[];
  /**
   * Logger for Kratos 5xx / network errors. Invalid or expired sessions
   * (4xx) stay quiet — they're the expected hot path and would blow up
   * log cardinality. Everything else (degraded Kratos, network timeouts,
   * unknown shapes) goes to `warn` so a silent identity-plane outage
   * can't hide behind 401s.
   *
   * Defaults to a no-op so tests and non-Fastify callers don't have to
   * wire anything up. The Fastify plugin passes `app.log` at construction.
   */
  logger?: SessionResolverLogger;
}

const NOOP_LOGGER: SessionResolverLogger = { warn: () => {} };

export function createSessionResolver(
  frontendApi: FrontendApi,
  config?: SessionResolverConfig,
): SessionResolver {
  const scopes = config?.scopes ?? DEFAULT_SESSION_SCOPES;
  const logger = config?.logger ?? NOOP_LOGGER;

  return {
    async resolveSession(
      input: ResolveSessionInput,
    ): Promise<HumanAuthContext | null> {
      // Normalize both transports: treat empty / whitespace as absent so a
      // request that sends `X-Moltnet-Session-Token: ` (or no cookies) does
      // not make a useless round-trip to Kratos.
      const sessionToken = input.sessionToken?.trim() || undefined;
      const cookie = input.cookie?.trim() || undefined;

      if (!sessionToken && !cookie) {
        return null;
      }

      // Prefer the native session token when both are present — it is the
      // explicit, scoped header and should win over an incidental browser
      // cookie on the same request.
      const toSessionRequest = sessionToken
        ? { xSessionToken: sessionToken }
        : { cookie };

      try {
        const session = await frontendApi.toSession(toSessionRequest);

        const identity = session.identity;
        if (!identity?.id) {
          return null;
        }

        return {
          subjectType: 'human',
          identityId: identity.id,
          clientId: null,
          scopes,
          currentTeamId: null,
        };
      } catch (err) {
        // 4xx (invalid/expired session) is the common case — stay quiet.
        // 5xx, network timeouts, and unknown errors indicate Kratos is
        // degraded and MUST be observable, otherwise cookie-auth silently
        // degrades to 401 with no signal.
        const status =
          typeof err === 'object' && err !== null && 'status' in err
            ? (err as { status?: unknown }).status
            : undefined;
        const isClientError =
          typeof status === 'number' && status >= 400 && status < 500;
        if (!isClientError) {
          logger.warn(
            { err, status },
            'session-resolver: Kratos toSession error',
          );
        }
        return null;
      }
    },
  };
}
