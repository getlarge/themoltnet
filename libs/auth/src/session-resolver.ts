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

import {
  createRemoteAuthMetrics,
  RemoteAuthCache,
} from './remote-auth-cache.js';
import {
  asRemoteAuthenticationError,
  remoteErrorStatus,
} from './remote-auth-error.js';
import { HUMAN_SESSION_SCOPES } from './scopes.js';
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

function summarizeCookieHeader(cookie: string | undefined): {
  present: boolean;
  cookieCount: number;
  kratosCookiePresent: boolean;
} {
  if (!cookie) {
    return {
      present: false,
      cookieCount: 0,
      kratosCookiePresent: false,
    };
  }

  const cookieNames = cookie
    .split(';')
    .map((part) => part.trim().split('=')[0]?.trim())
    .filter((name): name is string => Boolean(name));

  return {
    present: true,
    cookieCount: cookieNames.length,
    kratosCookiePresent: cookieNames.some(
      (name) =>
        name === 'ory_kratos_session' || name.startsWith('ory_session_'),
    ),
  };
}

function extractErrorStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null && 'status' in err
    ? ((err as { status?: unknown }).status as number | undefined)
    : undefined;
}

function extractErrorBody(err: unknown): unknown {
  if (typeof err !== 'object' || err === null || !('response' in err)) {
    return undefined;
  }

  const response = (err as { response?: unknown }).response;
  if (typeof response !== 'object' || response === null) {
    return undefined;
  }

  if ('body' in response) {
    return (response as { body?: unknown }).body;
  }

  if ('statusText' in response) {
    return { statusText: (response as { statusText?: unknown }).statusText };
  }

  return undefined;
}

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
  /** Shared process-local cache for successful Kratos sessions. */
  remoteAuthCache?: RemoteAuthCache;
  /** Stable issuer used to partition session cache keys. */
  issuer?: string;
  /** Timeout for the Kratos session request. */
  remoteRequestTimeoutMs?: number;
}

const NOOP_LOGGER: SessionResolverLogger = { warn: () => {} };

export function createSessionResolver(
  frontendApi: FrontendApi,
  config?: SessionResolverConfig,
): SessionResolver {
  const scopes = config?.scopes ?? [...HUMAN_SESSION_SCOPES];
  const logger = config?.logger ?? NOOP_LOGGER;
  const remoteCache =
    config?.remoteAuthCache ??
    new RemoteAuthCache({ metrics: createRemoteAuthMetrics() });
  const metrics = remoteCache.metrics;
  const issuer = config?.issuer ?? 'kratos';
  const requestTimeoutMs = config?.remoteRequestTimeoutMs ?? 5_000;

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

      const cookieCredential = cookie
        ?.split(';')
        .map((part) => part.trim())
        .find((part) => {
          const name = part.split('=', 1)[0];
          return (
            name === 'ory_kratos_session' || name?.startsWith('ory_session_')
          );
        });
      const transport = sessionToken ? 'session-token' : 'session-cookie';
      const credential = sessionToken ?? cookieCredential ?? cookie;
      if (!credential) return null;

      const load = async () => {
        try {
          const session = await frontendApi.toSession(toSessionRequest, {
            signal: AbortSignal.timeout(requestTimeoutMs),
          });
          const identity = session.identity;
          if (!identity?.id) {
            metrics.recordUpstreamRequest('kratos.session', 'invalid');
            return null;
          }

          // Read humans.id directly from Kratos metadata_public.human_id —
          // populated by the after-registration webhook BEFORE any session
          // can exist. Reading it here (instead of doing a DB lookup keyed
          // by identityId) eliminates the race with the human-onboarding
          // DBOS workflow's setIdentityIdStep: that workflow updates
          // humans.identity_id, but humans.id is stable from the moment
          // the webhook returns, so we can pin to it without any window
          // where a route handler sees a half-onboarded principal.
          const metaPublic = identity.metadata_public as
            | { human_id?: unknown }
            | null
            | undefined;
          const humanId =
            typeof metaPublic?.human_id === 'string'
              ? metaPublic.human_id
              : undefined;
          if (!humanId) {
            metrics.recordUpstreamRequest('kratos.session', 'invalid');
            logger.warn(
              { identityId: identity.id },
              'session-resolver: human identity missing metadata_public.human_id — webhook not yet processed?',
            );
            return null;
          }

          metrics.recordUpstreamRequest('kratos.session', 'success');
          return {
            context: {
              subjectType: 'human',
              identityId: identity.id,
              humanId,
              clientId: null,
              scopes,
              currentTeamId: null,
            } satisfies HumanAuthContext,
            expiresAtMs: session.expires_at
              ? new Date(session.expires_at).getTime()
              : undefined,
          };
        } catch (err) {
          // 4xx (invalid/expired session) is the common case — stay quiet.
          // 5xx, network timeouts, and unknown errors indicate Kratos is
          // degraded and MUST be observable, otherwise cookie-auth silently
          // degrades to 401 with no signal.
          const status = remoteErrorStatus(err) ?? extractErrorStatus(err);
          const isClientError =
            typeof status === 'number' &&
            status >= 400 &&
            status < 500 &&
            status !== 429;
          if (isClientError) {
            metrics?.recordUpstreamRequest('kratos.session', 'invalid', status);
            return null;
          }
          {
            const cookieSummary = summarizeCookieHeader(cookie);
            logger.warn(
              {
                status,
                authTransport: sessionToken ? 'x-session-token' : 'cookie',
                sessionTokenPresent: Boolean(sessionToken),
                cookie: cookieSummary,
                responseBodyPresent: Boolean(extractErrorBody(err)),
              },
              'session-resolver: Kratos toSession error',
            );
          }
          throw asRemoteAuthenticationError(err, 'kratos.session', metrics);
        }
      };

      const context = await remoteCache.resolve(
        transport,
        issuer,
        credential,
        load,
      );
      return context?.subjectType === 'human' ? context : null;
    },
  };
}
