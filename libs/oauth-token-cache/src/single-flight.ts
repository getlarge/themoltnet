import { MemoryCacheStore } from './cache/memory.js';
import type { CacheEntry, CacheStore, LoadResult } from './cache/types.js';
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
  /** Reports a cache write or expired-entry cleanup failure without losing a loaded value. */
  onStoreError?: (
    operation: 'get' | 'set' | 'delete' | 'scan' | 'probe',
    error: unknown,
  ) => void;
  /** Reports recovery after a previously failing store operation. */
  onStoreSuccess?: (
    operation: 'get' | 'set' | 'delete' | 'scan' | 'probe',
  ) => void;
  /** Reports transitions in the best-effort write gate. */
  onWriteGateChange?: (blocked: boolean) => void;
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
  const store: CacheStore<T> = options.store ?? new MemoryCacheStore<T>();
  const metrics = options.metrics ?? NOOP_TOKEN_EXCHANGE_METRICS;
  const source = options.source ?? 'unknown';
  const now = options.now ?? Date.now;
  const inFlight = new Map<string, Promise<Resolved<T>>>();
  // Best-effort gate for this process: a failed write blocks fresh paid loads
  // until any probe or real write succeeds. A successful small probe cannot
  // prove larger grant writes will succeed, so retain the per-IP upstream
  // budget as the hard ceiling. No grant response is retained by this gate.
  let writeFailed = false;

  function reportStoreError(
    operation: 'get' | 'set' | 'delete' | 'scan' | 'probe',
    error: unknown,
  ): void {
    metrics.recordCacheError(source, operation);
    try {
      options.onStoreError?.(operation, error);
    } catch {
      // Reporting must not turn a usable loaded grant into a failed request.
    }
  }

  function reportStoreSuccess(
    operation: 'get' | 'set' | 'delete' | 'scan' | 'probe',
  ): void {
    try {
      options.onStoreSuccess?.(operation);
    } catch {
      // Observability must not alter cache behavior.
    }
  }

  function setWriteGate(blocked: boolean): void {
    if (writeFailed === blocked) return;
    writeFailed = blocked;
    metrics.recordWriteGateChange(source, blocked);
    try {
      options.onWriteGateChange?.(blocked);
    } catch {
      // Observability must not alter cache behavior.
    }
  }

  function joinInFlight(key: string): Promise<Resolved<T>> | null {
    const pending = inFlight.get(key);
    if (!pending) return null;
    metrics.recordCacheAccess(source, 'single_flight');
    return pending.then((shared) => ({ ...shared, origin: 'single_flight' }));
  }

  async function resolve(
    key: string,
    load: () => Promise<LoadResult<T>>,
  ): Promise<Resolved<T>> {
    const existing = joinInFlight(key);
    if (existing) return existing;

    let cached: CacheEntry<T> | null;
    try {
      cached = await store.get(key);
      reportStoreSuccess('get');
    } catch (error) {
      metrics.recordCacheAccess(source, 'error');
      reportStoreError('get', error);
      const pending = joinInFlight(key);
      if (pending) return pending;
      throw error;
    }
    if (cached && cached.expiresAt > now()) {
      const remainingSeconds = Math.floor((cached.expiresAt - now()) / 1000);
      metrics.recordCacheAccess(source, 'hit');
      metrics.recordServedTtl(source, remainingSeconds);
      return { value: cached.value, origin: 'hit', remainingSeconds };
    }
    if (cached) {
      // An expired entry is unusable regardless of whether its cleanup works.
      // Redis already has a native TTL; a failed delete must not block minting.
      try {
        await store.delete(key);
        reportStoreSuccess('delete');
      } catch (error) {
        reportStoreError('delete', error);
      }
    }

    const pendingForKey = joinInFlight(key);
    if (pendingForKey) return pendingForKey;

    metrics.recordCacheAccess(source, 'miss');

    const pending = (async (): Promise<Resolved<T>> => {
      if (writeFailed && store.probeWrite) {
        try {
          await store.probeWrite();
          reportStoreSuccess('probe');
          setWriteGate(false);
        } catch (error) {
          metrics.recordCacheAccess(source, 'error');
          reportStoreError('probe', error);
          throw error;
        }
      }

      const result = await load();
      if (result.expiresAt === undefined) {
        // Explicitly not cacheable — an upstream error, which must reach the
        // token endpoint again on the next attempt.
        return { value: result.value, origin: 'load', remainingSeconds: null };
      }
      const entry = {
        value: result.value,
        expiresAt: result.expiresAt,
      };
      try {
        await store.set(key, entry);
        reportStoreSuccess('set');
        setWriteGate(false);
      } catch (error) {
        if (store.probeWrite) setWriteGate(true);
        reportStoreError('set', error);
        return { value: result.value, origin: 'load', remainingSeconds: null };
      }
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
    invalidate: async (key) => {
      try {
        await store.delete(key);
        reportStoreSuccess('delete');
      } catch (error) {
        reportStoreError('delete', error);
        throw error;
      }
    },
    invalidatePrefix: async (prefix) => {
      try {
        await store.deleteByPrefix(prefix);
        reportStoreSuccess('scan');
      } catch (error) {
        reportStoreError(
          error instanceof Error &&
            'operation' in error &&
            error.operation === 'scan'
            ? 'scan'
            : 'delete',
          error,
        );
        throw error;
      }
    },
    close: async () => {
      inFlight.clear();
      await store.close();
    },
  };
}
