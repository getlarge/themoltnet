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

interface CacheEntry {
  context: HumanAuthContext;
  expiresAt: number;
}

export interface SessionResolverConfig {
  /** Cache TTL in milliseconds (default: 30_000 = 30 seconds) */
  cacheTtlMs?: number;
  /** Maximum cache entries (default: 500) */
  cacheMaxSize?: number;
  /** Scopes to assign to session-authenticated humans */
  scopes?: string[];
}

export function createSessionResolver(
  frontendApi: FrontendApi,
  config?: SessionResolverConfig,
): SessionResolver {
  const cacheTtlMs = config?.cacheTtlMs ?? 30_000;
  const cacheMaxSize = config?.cacheMaxSize ?? 500;
  const scopes = config?.scopes ?? DEFAULT_SESSION_SCOPES;

  const cache = new Map<string, CacheEntry>();

  function evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of cache) {
      if (entry.expiresAt <= now) {
        cache.delete(key);
      }
    }
  }

  return {
    async resolveSession(
      sessionToken: string,
    ): Promise<HumanAuthContext | null> {
      // Check cache
      const cached = cache.get(sessionToken);
      if (cached && cached.expiresAt > Date.now()) {
        return cached.context;
      }

      // Evict expired entries if at capacity
      if (cache.size >= cacheMaxSize) {
        evictExpired();
        // If still at capacity after eviction, remove oldest
        if (cache.size >= cacheMaxSize) {
          const firstKey = cache.keys().next().value;
          if (firstKey) cache.delete(firstKey);
        }
      }

      try {
        const session = await frontendApi.toSession({
          xSessionToken: sessionToken,
        });

        const identity = session.identity;
        if (!identity?.id) {
          return null;
        }

        const context: HumanAuthContext = {
          subjectType: 'human',
          identityId: identity.id,
          clientId: null,
          scopes,
          currentTeamId: null,
        };

        cache.set(sessionToken, {
          context,
          expiresAt: Date.now() + cacheTtlMs,
        });

        return context;
      } catch {
        // Session invalid, expired, or Kratos unreachable
        // Remove stale cache entry if present
        cache.delete(sessionToken);
        return null;
      }
    },
  };
}
