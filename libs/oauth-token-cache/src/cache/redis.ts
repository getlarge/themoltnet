import type { CacheEntry, CacheStore } from './types.js';

/**
 * The slice of a Redis client this store needs.
 *
 * Structural on purpose: an `ioredis` instance satisfies it, so this package
 * takes no dependency on ioredis and `apps/mcp-server` — which has no redis
 * dependency of its own — is unaffected by this file existing.
 */
export interface RedisLikeClient {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: 'PX',
    ttlMs: number,
  ): Promise<unknown>;
  del(key: string): Promise<unknown>;
  scan(
    cursor: string,
    matchToken: 'MATCH',
    pattern: string,
    countToken: 'COUNT',
    count: number,
  ): Promise<[string, string[]]>;
}

export interface RedisCacheStoreOptions {
  client: RedisLikeClient;
  /** Namespace so these keys never collide with the rate limiter's. */
  keyPrefix?: string;
}

const DEFAULT_PREFIX = 'moltnet:oauth-token:';

/**
 * Redis-backed store, so a cached grant survives a deploy and is shared across
 * instances instead of being minted once per machine.
 *
 * The native key TTL is set from `expiresAt` purely so Redis evicts dead
 * entries; expiry itself is still decided by `createSingleFlightCache` against
 * its own clock. Never rely on the TTL for correctness — Redis's clock is not
 * ours.
 */
export function createRedisCacheStore<T>(
  options: RedisCacheStoreOptions,
): CacheStore<T> {
  const { client } = options;
  const prefix = options.keyPrefix ?? DEFAULT_PREFIX;
  const namespaced = (key: string) => `${prefix}${key}`;

  return {
    async get(key) {
      const raw = await client.get(namespaced(key));
      if (raw === null) return null;
      try {
        return JSON.parse(raw) as CacheEntry<T>;
      } catch {
        // A malformed entry is treated as a miss rather than an error: the
        // caller re-mints, and the bad value is overwritten on the way back.
        return null;
      }
    },

    async set(key, entry) {
      // Floor of 1ms — Redis rejects a non-positive PX. An already-expired
      // entry is still written so behaviour matches the memory store; the
      // cache layer discards it on read.
      const ttlMs = Math.max(1, entry.expiresAt - Date.now());
      await client.set(namespaced(key), JSON.stringify(entry), 'PX', ttlMs);
    },

    async delete(key) {
      await client.del(namespaced(key));
    },

    async deleteByPrefix(keyPrefix) {
      // SCAN rather than KEYS: KEYS blocks the server, and this runs on the
      // credential-rotation path where latency is fine but a stall is not.
      let cursor = '0';
      do {
        const [next, found] = await client.scan(
          cursor,
          'MATCH',
          `${namespaced(keyPrefix)}*`,
          'COUNT',
          100,
        );
        cursor = next;
        for (const key of found) await client.del(key);
      } while (cursor !== '0');
    },

    async close() {
      // Deliberately does not disconnect: the client is owned by the
      // application and shared with the rate limiter. Closing it here would
      // take down an unrelated subsystem.
    },
  };
}
