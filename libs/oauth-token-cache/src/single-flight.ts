import { MemoryCacheStore } from './cache/memory.js';
import type { CacheStore, LoadResult } from './cache/types.js';
import {
  NOOP_TOKEN_EXCHANGE_METRICS,
  type TokenExchangeMetrics,
} from './metrics.js';

/** How a resolved value was obtained. Mirrors the cache-access metric. */
export type ResolveOrigin = 'hit' | 'load' | 'single_flight';

export interface Resolved<T> {
  value: T;
  origin: ResolveOrigin;
  /** Seconds of usable life left; null when the value was not cached. */
  remainingSeconds: number | null;
}

export interface SingleFlightCacheOptions<T> {
  store?: CacheStore<T>;
  metrics?: TokenExchangeMetrics;
  /** Tags every metric so callers stay distinguishable. */
  source?: string;
  /** Injectable clock for tests. */
  now?: () => number;
}

export interface SingleFlightCache<T> {
  resolve(
    key: string,
    load: () => Promise<LoadResult<T>>,
  ): Promise<Resolved<T>>;
  invalidate(key: string): Promise<void>;
  /** Evict everything under a key prefix — see CacheStore.deleteByPrefix. */
  invalidatePrefix(prefix: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Cache-with-single-flight, shared by every path that acquires OAuth2 tokens.
 *
 * The single-flight half is not an optimisation. Two concurrent requests for
 * the same credentials would otherwise both hit the token endpoint: at best
 * that is a wasted billed token, and on a refresh-token grant it trips Hydra's
 * refresh-token reuse detection, which can revoke the whole chain.
 *
 * Callers own key construction and outcome metrics; this owns expiry,
 * de-duplication, and the cache-access metrics.
 */
export function createSingleFlightCache<T>(
  options: SingleFlightCacheOptions<T> = {},
): SingleFlightCache<T> {
  const store = options.store ?? new MemoryCacheStore<T>();
  const metrics = options.metrics ?? NOOP_TOKEN_EXCHANGE_METRICS;
  const source = options.source ?? 'unknown';
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<Resolved<T>>>();

  async function resolve(
    key: string,
    load: () => Promise<LoadResult<T>>,
  ): Promise<Resolved<T>> {
    const cached = await store.get(key);
    if (cached && cached.expiresAt > now()) {
      const remainingSeconds = Math.floor((cached.expiresAt - now()) / 1000);
      metrics.recordCacheAccess(source, 'hit');
      metrics.recordServedTtl(source, remainingSeconds);
      return { value: cached.value, origin: 'hit', remainingSeconds };
    }
    if (cached) await store.delete(key);

    const existing = inFlight.get(key);
    if (existing) {
      metrics.recordCacheAccess(source, 'single_flight');
      const shared = await existing;
      return { ...shared, origin: 'single_flight' };
    }

    metrics.recordCacheAccess(source, 'miss');

    const pending = (async (): Promise<Resolved<T>> => {
      const result = await load();
      if (result.expiresAt === undefined) {
        // Explicitly not cacheable — an upstream error, which must reach the
        // token endpoint again on the next attempt.
        return { value: result.value, origin: 'load', remainingSeconds: null };
      }
      await store.set(key, {
        value: result.value,
        expiresAt: result.expiresAt,
      });
      return {
        value: result.value,
        origin: 'load',
        remainingSeconds: Math.max(
          0,
          Math.floor((result.expiresAt - now()) / 1000),
        ),
      };
    })();

    inFlight.set(key, pending);
    try {
      return await pending;
    } finally {
      // Always cleared, including on a rejected load, so a transient failure
      // never wedges the key.
      inFlight.delete(key);
    }
  }

  return {
    resolve,
    invalidate: (key) => store.delete(key),
    invalidatePrefix: (prefix) => store.deleteByPrefix(prefix),
    close: async () => {
      inFlight.clear();
      await store.close();
    },
  };
}
