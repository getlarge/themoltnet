import { describe, expect, it } from 'vitest';

import { credentialHealth } from './credential-health.js';

const now = Date.parse('2026-09-18T00:00:00Z');
const day = 24 * 60 * 60 * 1000;
const metadata = {
  keyId: 'key',
  scopes: [],
  verifiedAt: new Date(now - day).toISOString(),
};
describe('credential expiry display', () => {
  it.each([
    [-1, 'expired'],
    [0, 'expired'],
    [1, 'expiring'],
    [7 * day, 'expiring'],
    [7 * day + 1, 'healthy'],
  ] as const)(
    'classifies expiry offset %s with a controlled clock',
    (offset, expected) => {
      expect(
        credentialHealth(
          { ...metadata, expiresAt: new Date(now + offset).toISOString() },
          true,
          now,
        ),
      ).toBe(expected);
    },
  );
  it('distinguishes old API unknown expiry from explicit non-expiring metadata', () => {
    expect(credentialHealth(metadata, true, now)).toBe('unknown');
    expect(credentialHealth({ ...metadata, expiresAt: null }, true, now)).toBe(
      'healthy',
    );
    expect(
      credentialHealth({ ...metadata, expiresAt: 'invalid' }, true, now),
    ).toBe('unknown');
  });
  it('retains expired status after failed verification without treating stale metadata as authority', () => {
    expect(
      credentialHealth(
        { ...metadata, expiresAt: new Date(now - 1).toISOString() },
        false,
        now,
      ),
    ).toBe('expired');
    expect(credentialHealth({ ...metadata, expiresAt: null }, false, now)).toBe(
      'unavailable',
    );
  });
});
