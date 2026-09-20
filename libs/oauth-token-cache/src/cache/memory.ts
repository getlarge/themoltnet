/* eslint-disable @typescript-eslint/require-await */
import type { CacheEntry, CacheStore } from './types.js';

/**
 * Process-local store.
 *
 * Deliberately does NOT check expiry — see the note on `CacheStore`. Doing so
 * here as well cost a real bug: this class compared against `Date.now()` while
 * the cache above it compared against an injected clock, so under a test clock
 * every entry read back as expired and nothing ever hit.
 *
 * Least-recently-used eviction bounds memory even when callers continually
 * submit new credential/request partitions. Expiry remains owned by the cache.
 */
export class MemoryCacheStore<T> implements CacheStore<T> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(private readonly maxEntries = 1_000) {
    if (!Number.isSafeInteger(maxEntries) || maxEntries < 1)
      throw new Error('Cache capacity must be a positive integer');
  }

  async get(key: string): Promise<CacheEntry<T> | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    this.store.delete(key);
    this.store.set(key, entry);
    return entry;
  }

  async set(key: string, value: CacheEntry<T>): Promise<void> {
    this.store.delete(key);
    this.store.set(key, value);
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value;
      if (oldest !== undefined) this.store.delete(oldest);
    }
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async deleteByPrefix(prefix: string): Promise<void> {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) this.store.delete(key);
    }
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
