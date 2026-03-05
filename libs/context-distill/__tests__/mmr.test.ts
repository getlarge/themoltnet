import { describe, expect, it } from 'vitest';

import { mmr } from '../src/mmr.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(id: string, embedding: number[]): DistillEntry {
  return {
    id,
    embedding,
    content: `content-${id}`,
    tokens: 10,
    importance: 5,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const query = [1, 0, 0];
const near1 = makeEntry('near1', [1, 0, 0]); // identical to query
const near2 = makeEntry('near2', [0.99, 0.14, 0]); // close to query
const far = makeEntry('far', [0, 1, 0]); // orthogonal

describe('mmr', () => {
  it('returns top-k entries', () => {
    const result = mmr([near1, near2, far], query, { k: 2, lambda: 0.5 });
    expect(result).toHaveLength(2);
  });

  it('with lambda=1 (pure relevance) prefers entries closest to query', () => {
    const result = mmr([near1, near2, far], query, { k: 1, lambda: 1 });
    expect(result[0].id).toBe('near1');
  });

  it('with lambda=0 (pure diversity) after first pick, avoids similar entries', () => {
    const result = mmr([near1, near2, far], query, { k: 2, lambda: 0 });
    expect(result[0].id).toBe('near1');
    expect(result[1].id).toBe('far');
  });

  it('returns all entries when k >= entries.length', () => {
    const result = mmr([near1, far], query, { k: 10, lambda: 0.5 });
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(mmr([], query, { k: 5, lambda: 0.5 })).toHaveLength(0);
  });

  it('without query embedding, ranks by importance', () => {
    const a = { ...makeEntry('a', [1, 0, 0]), importance: 9 };
    const b = { ...makeEntry('b', [0, 1, 0]), importance: 2 };
    const result = mmr([b, a], undefined, { k: 1, lambda: 0.5 });
    expect(result[0].id).toBe('a');
  });
});
