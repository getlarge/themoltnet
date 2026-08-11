import { beforeEach, describe, expect, it } from 'vitest';

import { MemoryCacheStore } from '../src/cache/memory.js';
import type { CacheEntry } from '../src/cache/types.js';

describe('MemoryCacheStore', () => {
  let store: MemoryCacheStore<string>;

  function entry(value: string, expiresAt = Date.now() + 60_000) {
    return { value, expiresAt } satisfies CacheEntry<string>;
  }

  beforeEach(() => {
    store = new MemoryCacheStore<string>();
  });

  it('stores and returns an entry', async () => {
    // Arrange
    const stored = entry('tok');

    // Act
    await store.set('k', stored);

    // Assert
    expect(await store.get('k')).toEqual(stored);
  });

  it('returns null for an unknown key', async () => {
    // Act + Assert
    expect(await store.get('missing')).toBeNull();
  });

  it('returns expired entries rather than filtering them', async () => {
    // Arrange — expiry is the cache layer's job, deliberately not the
    // store's, so the two never compare against different clocks.
    const expired = entry('stale', Date.now() - 60_000);
    await store.set('k', expired);

    // Act + Assert
    expect(await store.get('k')).toEqual(expired);
  });

  it('overwrites an existing entry', async () => {
    // Arrange
    await store.set('k', entry('first'));

    // Act
    await store.set('k', entry('second'));

    // Assert
    expect((await store.get('k'))?.value).toBe('second');
  });

  it('deletes an entry', async () => {
    // Arrange
    await store.set('k', entry('tok'));

    // Act
    await store.delete('k');

    // Assert
    expect(await store.get('k')).toBeNull();
  });

  it('clears everything on close', async () => {
    // Arrange
    await store.set('a', entry('1'));
    await store.set('b', entry('2'));

    // Act
    await store.close();

    // Assert
    expect(await store.get('a')).toBeNull();
    expect(await store.get('b')).toBeNull();
  });
});
