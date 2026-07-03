import { describe, expect, it } from 'vitest';

import {
  formatCount,
  formatDurationMs,
  formatInteger,
  formatPercent,
  formatRateWithCount,
  formatRatio,
  UNKNOWN,
} from '../format.js';

describe('analytics format', () => {
  describe('formatPercent', () => {
    it('renders a 0..1 rate as a whole-ish percent', () => {
      expect(formatPercent(0.82)).toBe('82%');
    });

    it('renders 0 as "0%", never as unknown', () => {
      expect(formatPercent(0)).toBe('0%');
    });

    it('renders 1 as "100%"', () => {
      expect(formatPercent(1)).toBe('100%');
    });

    it('keeps one decimal for sub-integer precision when needed', () => {
      expect(formatPercent(0.826)).toBe('82.6%');
    });
  });

  describe('formatRateWithCount', () => {
    it('renders "82% (41/50)"', () => {
      expect(formatRateWithCount(0.82, 41, 50)).toBe('82% (41/50)');
    });

    it('renders "0% (0/50)" for a real zero', () => {
      expect(formatRateWithCount(0, 0, 50)).toBe('0% (0/50)');
    });
  });

  describe('formatRatio (nullable)', () => {
    it('renders a number with up to 2 significant decimals', () => {
      expect(formatRatio(3.14159)).toBe('3.14');
      expect(formatRatio(12)).toBe('12');
    });

    it('renders null as the unknown marker', () => {
      expect(formatRatio(null)).toBe(UNKNOWN);
    });

    it('appends an optional unit', () => {
      expect(formatRatio(2.5, ' /task')).toBe('2.5 /task');
      expect(formatRatio(null, ' /task')).toBe(UNKNOWN);
    });
  });

  describe('formatDurationMs (nullable)', () => {
    it('renders null as unknown', () => {
      expect(formatDurationMs(null)).toBe(UNKNOWN);
    });

    it('renders sub-second as ms', () => {
      expect(formatDurationMs(850)).toBe('850ms');
    });

    it('renders seconds', () => {
      expect(formatDurationMs(4200)).toBe('4.2s');
    });

    it('renders minutes and seconds', () => {
      expect(formatDurationMs(90_000)).toBe('1m 30s');
    });

    it('renders hours and minutes', () => {
      expect(formatDurationMs(3_930_000)).toBe('1h 5m');
    });
  });

  describe('formatInteger / formatCount', () => {
    it('groups thousands', () => {
      expect(formatInteger(1234567)).toBe('1,234,567');
    });

    it('formatCount renders n/d', () => {
      expect(formatCount(41, 50)).toBe('41/50');
    });
  });
});
