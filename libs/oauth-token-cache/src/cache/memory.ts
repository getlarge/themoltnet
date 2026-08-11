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
 * A key that is never read again holds its value until the process exits,
 * which is fine for the bounded set of OAuth2 clients we serve and is one more
 * reason a Redis store (with a native key TTL) is right once this runs on more
 * than one instance.
 */
export class MemoryCacheStore<T> implements CacheStore<T> {
  private store = new Map<string, CacheEntry<T>>();

  async get(key: string): Promise<CacheEntry<T> | null> {
    return this.store.get(key) ?? null;
  }

  async set(key: string, value: CacheEntry<T>): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
