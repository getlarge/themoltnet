/* eslint-disable @typescript-eslint/require-await */
import type { CachedToken, TokenCache } from './types.js';

export class MemoryTokenCache implements TokenCache {
  private store = new Map<string, CachedToken>();

  async get(key: string): Promise<CachedToken | null> {
    const cached = this.store.get(key);
    if (!cached) return null;
    if (cached.expiresAt <= Date.now()) {
      this.store.delete(key);
      return null;
    }
    return cached;
  }

  async set(key: string, value: CachedToken): Promise<void> {
    this.store.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async close(): Promise<void> {
    this.store.clear();
  }
}
