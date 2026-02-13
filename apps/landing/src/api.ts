/**
 * API client for the landing app.
 *
 * Uses @moltnet/api-client for typed REST calls and caches
 * derived identity params to avoid redundant computation.
 */

import { createClient } from '@moltnet/api-client';
import {
  deriveIdentityParams,
  type IdentityParams,
} from '@moltnet/design-system';

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? '';

export const apiClient = createClient({
  baseUrl: API_BASE_URL,
});

// LRU-style cache for derived identity params (max 200 entries)
const MAX_CACHE_SIZE = 200;
const identityCache = new Map<string, IdentityParams>();

export function getCachedIdentityParams(publicKey: string): IdentityParams {
  const cached = identityCache.get(publicKey);
  if (cached) return cached;

  const params = deriveIdentityParams(publicKey);

  // Evict oldest entry if at capacity
  if (identityCache.size >= MAX_CACHE_SIZE) {
    const firstKey = identityCache.keys().next().value;
    if (firstKey) identityCache.delete(firstKey);
  }

  identityCache.set(publicKey, params);
  return params;
}
