import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCacheStore } from '../src/cache/memory.js';
import { RedisCacheStoreError } from '../src/cache/redis.js';
import type { CacheStore } from '../src/cache/types.js';
import { entryFromExpiresIn } from '../src/cache/types.js';
import type { TokenExchangeMetrics } from '../src/metrics.js';
import {
  createSingleFlightCache,
  type SingleFlightCache,
} from '../src/single-flight.js';

function mockMetrics(): TokenExchangeMetrics {
  return {
    recordCacheAccess: vi.fn(),
    recordCacheError: vi.fn(),
    recordWriteGateChange: vi.fn(),
    recordUnavailable: vi.fn(),
    recordExchange: vi.fn(),
    recordServedTtl: vi.fn(),
  };
}

describe('createSingleFlightCache', () => {
  let metrics: TokenExchangeMetrics;
  let clock: number;
  let cache: SingleFlightCache<string>;

  beforeEach(() => {
    metrics = mockMetrics();
    clock = 1_000_000;
    cache = createSingleFlightCache<string>({
      store: new MemoryCacheStore<string>(),
      metrics,
      source: 'test',
      now: () => clock,
    });
  });

  it('loads on a miss and serves the second call from cache', async () => {
    // Arrange
    const load = vi.fn(async () => entryFromExpiresIn('v1', 3600, 30, clock));

    // Act
    const first = await cache.resolve('k', load);
    const second = await cache.resolve('k', load);

    // Assert
    expect(first.origin).toBe('load');
    expect(second.origin).toBe('hit');
    expect(second.value).toBe('v1');
    expect(load).toHaveBeenCalledTimes(1);
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith('test', 'miss');
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith('test', 'hit');
  });

  it('reports remaining life that shrinks as time passes', async () => {
    // Arrange
    const load = vi.fn(async () => entryFromExpiresIn('v1', 3600, 30, clock));
    await cache.resolve('k', load);

    // Act
    clock += 600_000; // 10 minutes
    const cached = await cache.resolve('k', load);

    // Assert — 3600 lifetime, 30 buffer, 600 elapsed
    expect(cached.remainingSeconds).toBe(2970);
    expect(metrics.recordServedTtl).toHaveBeenCalledWith('test', 2970);
  });

  it('reloads once the entry has expired', async () => {
    // Arrange
    const load = vi
      .fn()
      .mockImplementationOnce(async () =>
        entryFromExpiresIn('v1', 3600, 30, clock),
      )
      .mockImplementationOnce(async () =>
        entryFromExpiresIn('v2', 3600, 30, clock),
      );
    await cache.resolve('k', load);

    // Act
    clock += 3_600_000; // past expiry
    const reloaded = await cache.resolve('k', load);

    // Assert
    expect(reloaded.value).toBe('v2');
    expect(reloaded.origin).toBe('load');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('collapses concurrent calls for the same key into one load', async () => {
    // Arrange — the deferred is created up front, not inside the loader:
    // resolve() awaits store.get before ever calling load, so a `release`
    // captured from the loader body is still unassigned at this point.
    let release!: (value: { value: string; expiresAt: number }) => void;
    const pending = new Promise<{ value: string; expiresAt: number }>(
      (resolve) => {
        release = resolve;
      },
    );
    const load = vi.fn(() => pending);

    // Act
    const a = cache.resolve('k', load);
    const b = cache.resolve('k', load);
    release(entryFromExpiresIn('shared', 3600, 30, clock));
    const [first, second] = await Promise.all([a, b]);

    // Assert
    expect(load).toHaveBeenCalledTimes(1);
    expect(first.value).toBe('shared');
    expect(second.value).toBe('shared');
    expect(second.origin).toBe('single_flight');
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith(
      'test',
      'single_flight',
    );
  });

  it('does not collapse calls for different keys', async () => {
    // Arrange
    const load = vi.fn(async () => entryFromExpiresIn('v', 3600, 30, clock));

    // Act
    await Promise.all([cache.resolve('a', load), cache.resolve('b', load)]);

    // Assert
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not cache a result that omits expiresAt', async () => {
    // Arrange
    const load = vi.fn(async () => ({ value: 'uncacheable' }));

    // Act
    const first = await cache.resolve('k', load);
    const second = await cache.resolve('k', load);

    // Assert
    expect(first.remainingSeconds).toBeNull();
    expect(second.origin).toBe('load');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('counts scan failures during prefix invalidation', async () => {
    // Arrange
    const failure = new RedisCacheStoreError(
      'scan',
      new TypeError('scan unavailable'),
      2,
    );
    cache = createSingleFlightCache({
      store: {
        get: vi.fn(async () => null),
        set: vi.fn(async () => {}),
        delete: vi.fn(async () => {}),
        deleteByPrefix: vi.fn(async () => {
          throw failure;
        }),
        close: vi.fn(async () => {}),
      },
      metrics,
      source: 'test',
    });

    // Act + Assert
    await expect(cache.invalidatePrefix('agent|')).rejects.toBe(failure);
    expect(metrics.recordCacheError).toHaveBeenCalledWith('test', 'scan');
  });

  it('propagates a load failure and leaves the key loadable', async () => {
    // Arrange
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('upstream down'))
      .mockImplementationOnce(async () =>
        entryFromExpiresIn('recovered', 3600, 30, clock),
      );

    // Act
    await expect(cache.resolve('k', load)).rejects.toThrow('upstream down');
    const retry = await cache.resolve('k', load);

    // Assert — a failed load must not wedge the key
    expect(retry.value).toBe('recovered');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rejects every waiter when the shared load fails', async () => {
    // Arrange
    const load = vi.fn(
      () =>
        new Promise<{ value: string; expiresAt: number }>((_, reject) => {
          setTimeout(() => reject(new Error('boom')), 0);
        }),
    );

    // Act
    const a = cache.resolve('k', load);
    const b = cache.resolve('k', load);

    // Assert
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('shares a loaded value but does not retain it when the store write fails', async () => {
    // Arrange
    const writeError = new Error('write timed out');
    const store: CacheStore<string> = {
      get: vi.fn(async () => null),
      set: vi.fn(async () => {
        throw writeError;
      }),
      delete: vi.fn(async () => {}),
      deleteByPrefix: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const onStoreError = vi.fn();
    cache = createSingleFlightCache({
      store,
      metrics,
      source: 'test',
      now: () => clock,
      onStoreError,
    });
    let release!: (value: { value: string; expiresAt: number }) => void;
    const pending = new Promise<{ value: string; expiresAt: number }>(
      (resolve) => {
        release = resolve;
      },
    );
    const load = vi.fn(() => pending);

    // Act
    const a = cache.resolve('k', load);
    const b = cache.resolve('k', load);
    release(entryFromExpiresIn('shared', 60, 10, clock));
    const [first, second] = await Promise.all([a, b]);
    const next = await cache.resolve('k', load);

    // Assert
    expect(first.value).toBe('shared');
    expect(second.value).toBe('shared');
    expect(second.origin).toBe('single_flight');
    expect(next.origin).toBe('load');
    expect(next.remainingSeconds).toBeNull();
    expect(load).toHaveBeenCalledTimes(2);
    expect(store.set).toHaveBeenCalledTimes(2);
    expect(onStoreError).toHaveBeenCalledTimes(2);
    expect(onStoreError).toHaveBeenCalledWith('set', writeError);
    expect(metrics.recordCacheError).toHaveBeenCalledWith('test', 'set');
  });

  it('continues loading when deletion of an expired entry fails', async () => {
    // Arrange
    const deleteError = new Error('delete timed out');
    const store: CacheStore<string> = {
      get: vi.fn(async () => ({ value: 'expired', expiresAt: clock - 1 })),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {
        throw deleteError;
      }),
      deleteByPrefix: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    const onStoreError = vi.fn();
    cache = createSingleFlightCache({
      store,
      now: () => clock,
      onStoreError,
    });
    const load = vi.fn(async () => entryFromExpiresIn('fresh', 60, 0, clock));

    // Act
    const result = await cache.resolve('k', load);

    // Assert
    expect(result.value).toBe('fresh');
    expect(load).toHaveBeenCalledOnce();
    expect(onStoreError).toHaveBeenCalledWith('delete', deleteError);
  });

  it('records a cache read error without calling the loader', async () => {
    // Arrange
    const readError = new Error('read timed out');
    const store: CacheStore<string> = {
      get: vi.fn(async () => {
        throw readError;
      }),
      set: vi.fn(async () => {}),
      delete: vi.fn(async () => {}),
      deleteByPrefix: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    };
    cache = createSingleFlightCache({ store, metrics, source: 'test' });
    const load = vi.fn(async () => entryFromExpiresIn('token', 60, 0, clock));

    // Act + Assert
    await expect(cache.resolve('k', load)).rejects.toBe(readError);
    expect(load).not.toHaveBeenCalled();
    expect(metrics.recordCacheAccess).toHaveBeenCalledWith('test', 'error');
    expect(metrics.recordCacheError).toHaveBeenCalledWith('test', 'get');
  });

  it('invalidate forces the next call to reload', async () => {
    // Arrange
    const load = vi
      .fn()
      .mockImplementationOnce(async () =>
        entryFromExpiresIn('v1', 3600, 30, clock),
      )
      .mockImplementationOnce(async () =>
        entryFromExpiresIn('v2', 3600, 30, clock),
      );
    await cache.resolve('k', load);

    // Act
    await cache.invalidate('k');
    const reloaded = await cache.resolve('k', load);

    // Assert
    expect(reloaded.value).toBe('v2');
  });
});
