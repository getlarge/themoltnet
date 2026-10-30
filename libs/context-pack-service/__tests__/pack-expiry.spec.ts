import { describe, expect, it } from 'vitest';

import { packExpiryFrom } from '../src/pack-expiry.js';

const FROM = new Date('2026-09-13T10:00:00Z');
const DAY_MS = 86_400_000;

describe('packExpiryFrom', () => {
  it('adds the retention window to the reference time', () => {
    expect(packExpiryFrom(FROM, 30).getTime()).toBe(
      FROM.getTime() + 30 * DAY_MS,
    );
  });

  it('honours a fractional window without flooring it', () => {
    expect(packExpiryFrom(FROM, 0.5).getTime()).toBe(
      FROM.getTime() + 12 * 60 * 60 * 1000,
    );
  });

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'refuses the window %p rather than producing an immediate deadline',
    (ttlDays) => {
      expect(() => packExpiryFrom(FROM, ttlDays)).toThrow(RangeError);
    },
  );
});
