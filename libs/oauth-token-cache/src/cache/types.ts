/**
 * A cached value with an absolute expiry.
 *
 * `expiresAt` is epoch milliseconds and already includes any early-expiry
 * buffer, so consumers never re-apply it — a value is usable if and only if
 * `expiresAt > now`.
 */
export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * What a loader hands back. Omitting `expiresAt` returns the value to the
 * caller without caching it — used for upstream error responses, which must
 * never be replayed to a client whose credentials may since have changed.
 */
export interface LoadResult<T> {
  value: T;
  expiresAt?: number;
}

/**
 * Async by design so a Redis-backed implementation drops in without touching
 * any call site.
 *
 * Implementations must NOT enforce expiry themselves — return whatever is
 * stored and let `createSingleFlightCache` compare `expiresAt` against its own
 * clock. Two components checking expiry against two different clocks is a bug
 * that has already been made here once. A Redis implementation may still set a
 * native key TTL for eviction; that is memory hygiene, not correctness.
 */
export interface CacheStore<T> {
  get(key: string): Promise<CacheEntry<T> | null>;
  set(key: string, entry: CacheEntry<T>): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}

/** Build an entry from an OAuth2-style `expires_in`, applying the buffer once. */
export function entryFromExpiresIn<T>(
  value: T,
  expiresInSeconds: number,
  expiryBufferSeconds: number,
  now: number = Date.now(),
): CacheEntry<T> {
  return {
    value,
    expiresAt: now + expiresInSeconds * 1_000 - expiryBufferSeconds * 1_000,
  };
}
