/**
 * @moltnet/auth — Kratos Session Resolver
 *
 * Resolves Kratos sessions (via X-Session-Token header) into HumanAuthContext.
 * Used by the dashboard app for direct session-based authentication,
 * bypassing the OAuth2 client_credentials flow.
 */

import type { FrontendApi } from '@ory/client-fetch';

import type { HumanAuthContext } from './types.js';

export interface SessionResolver {
  resolveSession(sessionToken: string): Promise<HumanAuthContext | null>;
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
      sessionToken: string,
    ): Promise<HumanAuthContext | null> {
      try {
        const session = await frontendApi.toSession({
          xSessionToken: sessionToken,
        });

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
