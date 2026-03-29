import { describe, expect, it } from 'vitest';

import { fitEntries } from '../src/entry-fitter.js';
import type { ResolvedSelection } from '../src/types.js';

function makeSelection(
  id: string,
  rank: number,
  contentLength = 100,
): ResolvedSelection {
  return {
    rank,
    row: {
      id,
      content: 'word '.repeat(contentLength),
      contentHash: `bafyr-${id}`,
      importance: 5,
      createdAt: new Date('2026-01-01'),
    },
  };
}

describe('fitEntries', () => {
  it('returns all entries at full compression when no budget', () => {
    const entries = [makeSelection('a', 1), makeSelection('b', 2)];
    const result = fitEntries(entries);
    expect(result.entries).toHaveLength(2);
    expect(result.entries[0].compressionLevel).toBe('full');
    expect(result.entries[1].compressionLevel).toBe('full');
    expect(result.stats.entriesCompressed).toBe(0);
  });

  it('compresses tail entries to fit budget', () => {
    const entries = [makeSelection('a', 1, 200), makeSelection('b', 2, 200)];
    const result = fitEntries(entries, 100);
    expect(result.stats.totalTokens).toBeLessThanOrEqual(100);
  });

  it('drops entries when compression is not enough', () => {
    const makeDiverseSelection = (
      id: string,
      rank: number,
    ): ResolvedSelection => ({
      rank,
      row: {
        id,
        content: Array.from({ length: 500 }, (_, i) => `unique${id}${i}`).join(
          ' ',
        ),
        contentHash: `bafyr-${id}`,
        importance: 5,
        createdAt: new Date('2026-01-01'),
      },
    });
    const entries = [
      makeDiverseSelection('a', 1),
      makeDiverseSelection('b', 2),
      makeDiverseSelection('c', 3),
    ];
    const result = fitEntries(entries, 1);
    expect(result.entries.length).toBeLessThan(3);
    expect(result.stats.totalTokens).toBeLessThanOrEqual(1);
  });

  it('preserves rank order in output', () => {
    const entries = [makeSelection('a', 1), makeSelection('b', 2)];
    const result = fitEntries(entries);
    expect(result.entries[0].rank).toBe(1);
    expect(result.entries[1].rank).toBe(2);
  });

  it('sets budgetUtilization to 1 when no budget provided and entries exist', () => {
    const result = fitEntries([makeSelection('a', 1)]);
    expect(result.stats.budgetUtilization).toBe(1);
  });
});
