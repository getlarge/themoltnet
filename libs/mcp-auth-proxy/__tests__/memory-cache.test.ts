import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MemoryTokenCache } from '../src/cache/memory.js';
import type { CachedToken } from '../src/cache/types.js';

describe('MemoryTokenCache', () => {
  let cache: MemoryTokenCache;

  beforeEach(() => {
    cache = new MemoryTokenCache();
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should set and get a token', async () => {
    const token: CachedToken = {
      token: 'access-token-123',
      expiresAt: 2_000_000,
    };

    await cache.set('client-a', token);
    const result = await cache.get('client-a');

    expect(result).toEqual(token);
  });

  it('should return null for expired tokens', async () => {
    const token: CachedToken = {
      token: 'expired-token',
      expiresAt: 500_000,
    };

    await cache.set('client-a', token);
    const result = await cache.get('client-a');

    expect(result).toBeNull();
  });

  it('should return null for unknown keys', async () => {
    const result = await cache.get('unknown-client');

    expect(result).toBeNull();
  });

  it('should delete a token', async () => {
    const token: CachedToken = {
      token: 'to-delete',
      expiresAt: 2_000_000,
    };

    await cache.set('client-a', token);
    await cache.delete('client-a');
    const result = await cache.get('client-a');

    expect(result).toBeNull();
  });

  it('should overwrite existing tokens', async () => {
    const first: CachedToken = { token: 'first', expiresAt: 2_000_000 };
    const second: CachedToken = { token: 'second', expiresAt: 3_000_000 };

    await cache.set('client-a', first);
    await cache.set('client-a', second);
    const result = await cache.get('client-a');

    expect(result).toEqual(second);
  });

  it('should clear all tokens on close', async () => {
    await cache.set('client-a', { token: 'a', expiresAt: 2_000_000 });
    await cache.set('client-b', { token: 'b', expiresAt: 2_000_000 });

    await cache.close();

    expect(await cache.get('client-a')).toBeNull();
    expect(await cache.get('client-b')).toBeNull();
  });
});
