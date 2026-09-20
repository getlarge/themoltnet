import { afterEach, describe, expect, it, vi } from 'vitest';

import { localControlTokens } from '../src/runtime-local/local-control-token-cache.js';

afterEach(() => {
  localControlTokens.clear();
  vi.restoreAllMocks();
});

describe('local-control tab token cache', () => {
  it('reuses tokens only for the same authority and server until expiry', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1000);
    localControlTokens.set('issuer/server-a', {
      accessToken: 'approved',
      expiresAt: 62_000,
    });
    expect(localControlTokens.get('issuer/server-a')).toBe('approved');
    expect(localControlTokens.get('issuer/server-b')).toBeNull();
    expect(localControlTokens.get('another-issuer/server-a')).toBeNull();
    now.mockReturnValue(32_000);
    expect(localControlTokens.get('issuer/server-a')).toBeNull();
  });

  it('forgets a disconnected or rejected grant', () => {
    localControlTokens.set('server', {
      accessToken: 'approved',
      expiresAt: Date.now() + 900_000,
    });
    localControlTokens.set('server', null);
    expect(localControlTokens.get('server')).toBeNull();
  });
});
