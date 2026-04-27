/**
 * Tiny in-memory cache + exponential-backoff retry for the /account
 * dashboard's read-only API fetches.
 *
 * Scope: a handful of GETs that fire once per page mount. Anything bigger —
 * mutations, cross-component invalidation, devtools — should reach for
 * @tanstack/vue-query instead.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

export interface CachedRetryOptions {
  /** Number of attempts including the first. Defaults to 3. */
  attempts?: number;
  /** Base delay in ms — actual delay is `baseDelayMs * 2^attempt`. */
  baseDelayMs?: number;
  /** Skip the network entirely on cache hit. Omit to disable caching. */
  cacheKey?: string;
  /** TTL for the cache entry. Defaults to 60s. */
  cacheTtlMs?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isRetryable(err: unknown): boolean {
  // Network / CORS / abort: TypeError on browsers, no status. Retry.
  if (err instanceof TypeError) return true;
  if (typeof err === 'object' && err !== null && 'status' in err) {
    const status = (err as { status?: unknown }).status;
    // 5xx and unknown numeric statuses retry; 4xx is deterministic.
    if (typeof status === 'number') return status >= 500;
  }
  // Unknown shape: retry once rather than swallow a transient.
  return true;
}

export async function cachedRetry<T>(
  fn: () => Promise<T>,
  opts: CachedRetryOptions = {},
): Promise<T> {
  const {
    attempts = 3,
    baseDelayMs = 250,
    cacheKey,
    cacheTtlMs = 60_000,
  } = opts;

  if (cacheKey) {
    const hit = cache.get(cacheKey);
    if (hit && hit.expiresAt > Date.now()) return hit.value as T;
  }

  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const value = await fn();
      if (cacheKey) {
        cache.set(cacheKey, { value, expiresAt: Date.now() + cacheTtlMs });
      }
      return value;
    } catch (err) {
      lastErr = err;
      if (!isRetryable(err) || attempt === attempts - 1) throw err;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastErr;
}

/** Drop cached entries whose key starts with the given prefix (or all if absent). */
export function invalidateCache(prefix?: string): void {
  if (!prefix) {
    cache.clear();
    return;
  }
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}
