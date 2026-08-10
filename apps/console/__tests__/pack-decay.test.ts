import { describe, expect, it } from 'vitest';

import { describeDecay, EXPIRING_SOON_DAYS } from '../src/packs/decay.js';

const NOW = new Date('2026-08-09T12:00:00Z');
const inDays = (days: number) =>
  new Date(NOW.getTime() + days * 86_400_000).toISOString();

describe('describeDecay', () => {
  it('reports pinned even when expiresAt is still set', () => {
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
