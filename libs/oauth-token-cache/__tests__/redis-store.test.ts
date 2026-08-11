import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRedisCacheStore,
  type RedisLikeClient,
} from '../src/cache/redis.js';
import type { CacheEntry, CacheStore } from '../src/cache/types.js';
import { createSingleFlightCache } from '../src/single-flight.js';

/** In-memory stand-in with the same surface as ioredis. */
function fakeRedis(): RedisLikeClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: vi.fn(async (key: string) => data.get(key) ?? null),
    set: vi.fn(async (key: string, value: string) => {
      data.set(key, value);
      return 'OK';
    }),
    del: vi.fn(async (key: string) => {
      data.delete(key);
      return 1;
    }),
  };
}

describe('createRedisCacheStore', () => {
  let client: ReturnType<typeof fakeRedis>;
  let store: CacheStore<string>;

  beforeEach(() => {
    client = fakeRedis();
    store = createRedisCacheStore<string>({ client });
  });

  it('round-trips an entry', async () => {
    // Arrange
    const entry: CacheEntry<string> = {
      value: 'tok',
      expiresAt: Date.now() + 60_000,
    };

    // Act
    await store.set('k', entry);

    // Assert
    expect(await store.get('k')).toEqual(entry);
  });

  it('namespaces keys so they cannot collide with other subsystems', async () => {
    // Act
    await store.set('k', { value: 'tok', expiresAt: Date.now() + 60_000 });

    // Assert
    expect([...client.data.keys()]).toEqual(['moltnet:oauth-token:k']);
  });

  it('sets a native TTL from expiresAt for eviction', async () => {
    // Act
    await store.set('k', { value: 'tok', expiresAt: Date.now() + 60_000 });

    // Assert
    const [, , mode, ttl] = vi.mocked(client.set).mock.calls[0];
    expect(mode).toBe('PX');
    expect(ttl).toBeGreaterThan(50_000);
    expect(ttl).toBeLessThanOrEqual(60_000);
  });

  it('never asks Redis for a non-positive TTL', async () => {
    // Act — already expired
    await store.set('k', { value: 'tok', expiresAt: Date.now() - 10_000 });

    // Assert
    const [, , , ttl] = vi.mocked(client.set).mock.calls[0];
    expect(ttl).toBeGreaterThan(0);
  });

  it('treats an unknown key as a miss', async () => {
    // Act + Assert
    expect(await store.get('nope')).toBeNull();
  });

  it('treats a malformed entry as a miss rather than throwing', async () => {
    // Arrange
    client.data.set('moltnet:oauth-token:k', 'not json');

    // Act + Assert
    expect(await store.get('k')).toBeNull();
  });

  it('deletes the namespaced key', async () => {
    // Arrange
    await store.set('k', { value: 'tok', expiresAt: Date.now() + 60_000 });

    // Act
    await store.delete('k');

    // Assert
    expect(await store.get('k')).toBeNull();
  });

  it('does not disconnect the shared client on close', async () => {
    // Act
    await store.close();

    // Assert — the app owns the client; the rate limiter shares it
    expect(await store.get('anything')).toBeNull();
    expect(client.get).toHaveBeenCalled();
  });

  it('drops into the cache with no call-site changes', async () => {
    // Arrange — same primitive, Redis instead of memory
    const cache = createSingleFlightCache<string>({ store });
    const load = vi.fn(async () => ({
      value: 'from-upstream',
      expiresAt: Date.now() + 60_000,
    }));

    // Act
    const first = await cache.resolve('k', load);
    const second = await cache.resolve('k', load);

    // Assert
    expect(first.origin).toBe('load');
    expect(second.origin).toBe('hit');
    expect(load).toHaveBeenCalledTimes(1);
  });
});
