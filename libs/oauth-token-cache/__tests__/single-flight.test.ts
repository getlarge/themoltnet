import { beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryCacheStore } from '../src/cache/memory.js';
import { entryFromExpiresIn } from '../src/cache/types.js';
import type { TokenExchangeMetrics } from '../src/metrics.js';
import {
  createSingleFlightCache,
  type SingleFlightCache,
} from '../src/single-flight.js';

function mockMetrics(): TokenExchangeMetrics {
  return {
    recordCacheAccess: vi.fn(),
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
