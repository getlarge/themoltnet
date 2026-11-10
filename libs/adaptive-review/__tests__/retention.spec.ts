import { describe, expect, it } from 'vitest';

import { reviewRetentionPolicy } from '../src/retention.js';

describe('review retention configuration', () => {
  it('keeps published reviews for 30 days and unfinished reviews for 90', () => {
    expect(reviewRetentionPolicy({})).toEqual({
      completedDays: 30,
      unfinishedDays: 90,
    });
  });

  it('accepts explicit positive whole-day overrides', () => {
    expect(
      reviewRetentionPolicy({
        ADAPTIVE_RETENTION_COMPLETED_DAYS: '60',
        ADAPTIVE_RETENTION_UNFINISHED_DAYS: '180',
      }),
    ).toEqual({ completedDays: 60, unfinishedDays: 180 });
  });

  it.each(['', '0', '-1', '1.5', 'NaN', 'Infinity', '36501'])(
    'rejects unsafe retention %s instead of expiring new work',
    (value) => {
      expect(() =>
        reviewRetentionPolicy({ ADAPTIVE_RETENTION_COMPLETED_DAYS: value }),
      ).toThrow('whole number');
      expect(() =>
        reviewRetentionPolicy({ ADAPTIVE_RETENTION_UNFINISHED_DAYS: value }),
      ).toThrow('whole number');
    },
  );
});
