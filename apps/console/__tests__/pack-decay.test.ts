import { describe, expect, it } from 'vitest';

import {
  defaultUnpinExpiry,
  describeDecay,
  EXPIRING_SOON_DAYS,
  isExpiringSoon,
} from '../src/packs/decay.js';

const NOW = new Date('2026-08-09T12:00:00Z');
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('describeDecay', () => {
  it('reports pinned for the real stored shape, where pinning cleared expiresAt', () => {
    expect(describeDecay({ pinned: true, expiresAt: null }, NOW)).toEqual({
      kind: 'pinned',
    });
  });

  // Storage never holds this combination — the repository clears expiresAt on
  // pin — but a client can hold a row fetched just before a pin landed.
  // Reading a countdown off that stale row would be wrong, so pinned wins.
  it('reports pinned for a stale row that still carries an expiresAt', () => {
    expect(describeDecay({ pinned: true, expiresAt: inDays(2) }, NOW)).toEqual({
      kind: 'pinned',
    });
  });

  it('reports days remaining for an unpinned pack', () => {
    expect(describeDecay({ pinned: false, expiresAt: inDays(4) }, NOW)).toEqual(
      {
        kind: 'expiring',
        daysRemaining: 4,
      },
    );
  });

  it('rounds a partial day up so "expires in 0 days" never renders', () => {
    expect(
      describeDecay({ pinned: false, expiresAt: inDays(0.25) }, NOW),
    ).toEqual({ kind: 'expiring', daysRemaining: 1 });
  });

  it('reports expired for a past timestamp', () => {
    expect(
      describeDecay({ pinned: false, expiresAt: inDays(-1) }, NOW),
    ).toEqual({ kind: 'expired' });
  });

  it('reports no-expiry when expiresAt is null', () => {
    expect(describeDecay({ pinned: false, expiresAt: null }, NOW)).toEqual({
      kind: 'no-expiry',
    });
  });

  it('treats the soon window as one week', () => {
    expect(EXPIRING_SOON_DAYS).toBe(7);
  });
});

describe('isExpiringSoon', () => {
  it('includes the boundary day itself', () => {
    expect(
      isExpiringSoon(
        describeDecay({ pinned: false, expiresAt: inDays(7) }, NOW),
      ),
    ).toBe(true);
  });

  it('excludes the first day past the boundary', () => {
    expect(
      isExpiringSoon(
        describeDecay({ pinned: false, expiresAt: inDays(7.5) }, NOW),
      ),
    ).toBe(false);
  });

  it('is true well inside the window', () => {
    expect(
      isExpiringSoon(
        describeDecay({ pinned: false, expiresAt: inDays(1) }, NOW),
      ),
    ).toBe(true);
  });

  it.each([
    ['pinned', { pinned: true, expiresAt: null }],
    ['expired', { pinned: false, expiresAt: inDays(-1) }],
    ['no-expiry', { pinned: false, expiresAt: null }],
  ])('is false for the %s state', (_label, input) => {
    expect(isExpiringSoon(describeDecay(input, NOW))).toBe(false);
  });
});

describe('defaultUnpinExpiry', () => {
  it('restores the standard decay window, which unpin requires', () => {
    expect(defaultUnpinExpiry(NOW)).toBe(inDays(EXPIRING_SOON_DAYS));
  });

  it('lands in the future so the API accepts it', () => {
    expect(new Date(defaultUnpinExpiry(NOW)).getTime()).toBeGreaterThan(
      NOW.getTime(),
    );
  });
});
