export interface LocalControlToken {
  accessToken: string;
  expiresAt: number;
}

// Tab memory survives route changes, but never a reload or another tab.
// Agent Server remains responsible for verifying operator and instance binding.
const tokens = new Map<string, LocalControlToken>();

export const localControlTokens = {
  get(key: string): string | null {
    const token = tokens.get(key);
    if (!token) return null;
    if (Date.now() >= token.expiresAt) {
      tokens.delete(key);
      return null;
    }
    return token.accessToken;
  },
  set(key: string, token: LocalControlToken | null): void {
    if (token) tokens.set(key, token);
    else tokens.delete(key);
  },
  clear(): void {
    tokens.clear();
  },
};
