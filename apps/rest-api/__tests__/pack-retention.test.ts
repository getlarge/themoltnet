import { describe, expect, it } from 'vitest';

import { compileTtlExpiry } from '../src/utils/pack-retention.js';

const FROM = new Date('2026-09-13T10:00:00Z');
const DAY_MS = 86_400_000;

describe('compileTtlExpiry', () => {
  it('adds the configured window to the reference time', () => {
    const result = compileTtlExpiry({ PACK_GC_COMPILE_TTL_DAYS: 30 }, FROM);

    expect(result.getTime()).toBe(FROM.getTime() + 30 * DAY_MS);
  });

  // PACK_GC_COMPILE_TTL_DAYS is Type.Number(), so a sub-day window is valid.
  it('honours a fractional window without flooring it', () => {
    const result = compileTtlExpiry({ PACK_GC_COMPILE_TTL_DAYS: 0.5 }, FROM);

    expect(result.getTime()).toBe(FROM.getTime() + 12 * 60 * 60 * 1000);
  });

  it('falls back to 7 days when no config was supplied', () => {
    const result = compileTtlExpiry(undefined, FROM);

    expect(result.getTime()).toBe(FROM.getTime() + 7 * DAY_MS);
  });
});
