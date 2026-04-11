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
}

export function createSessionResolver(
  frontendApi: FrontendApi,
  config?: SessionResolverConfig,
): SessionResolver {
  const scopes = config?.scopes ?? DEFAULT_SESSION_SCOPES;

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
      } catch {
        // Session invalid, expired, or Kratos unreachable
        return null;
      }
    },
  };
}
