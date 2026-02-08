export interface CachedToken {
  token: string;
  expiresAt: number;
}

export interface TokenCache {
  get(key: string): Promise<CachedToken | null>;
  set(key: string, value: CachedToken): Promise<void>;
  delete(key: string): Promise<void>;
  close(): Promise<void>;
}
