import { describe, expect, it } from 'vitest';

import { mmr } from '../src/mmr.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  embedding: number[],
  importance = 5,
): DistillEntry {
  return {
    id,
    embedding,
    content: `content-${id}`,
    tokens: 10,
    importance,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

const query = [1, 0, 0];
const near1 = makeEntry('near1', [1, 0, 0]); // identical to query, distance 0
const near2 = makeEntry('near2', [0.99, 0.14, 0]); // close to query, distance ≈ 0.01
const far = makeEntry('far', [0, 1, 0]); // orthogonal to query, distance 1

describe('mmr — basic behaviour', () => {
  it('returns exactly k entries', () => {
    const result = mmr([near1, near2, far], query, { k: 2, lambda: 0.5 });
    expect(result).toHaveLength(2);
  });

  it('returns all entries when k >= entries.length', () => {
    const result = mmr([near1, far], query, { k: 10, lambda: 0.5 });
    expect(result).toHaveLength(2);
  });

  it('handles empty input', () => {
    expect(mmr([], query, { k: 5, lambda: 0.5 })).toHaveLength(0);
  });

  it('every returned entry is from the input set', () => {
    const entries = [near1, near2, far];
    const inputIds = new Set(entries.map((e) => e.id));
    const result = mmr(entries, query, { k: 3, lambda: 0.5 });
    for (const e of result) {
      expect(inputIds.has(e.id)).toBe(true);
    }
  });

  it('no duplicate entries in output', () => {
    const result = mmr([near1, near2, far], query, { k: 3, lambda: 0.5 });
    const ids = result.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('mmr — lambda=1 (pure relevance)', () => {
  it('first pick is the entry most similar to query', () => {
    const result = mmr([near2, far, near1], query, { k: 1, lambda: 1 });
    expect(result[0].id).toBe('near1');
  });

  it('orders all picks by decreasing query similarity', () => {
    const result = mmr([far, near2, near1], query, { k: 3, lambda: 1 });
    expect(result[0].id).toBe('near1');
    expect(result[1].id).toBe('near2');
    expect(result[2].id).toBe('far');
  });
});

describe('mmr — lambda=0 (pure diversity)', () => {
  it('after the first pick, selects the entry most dissimilar to selected set', () => {
    // With lambda=0: score = -maxSim. First pick is the first in remaining list (all score 0).
    // near1 is first → selected. Then near2 has sim≈0.99 to near1, far has sim=0.
    // score near2 = -(0.99), score far = 0 → far wins.
    const result = mmr([near1, near2, far], query, { k: 2, lambda: 0 });
    expect(result[1].id).toBe('far');
  });

  it('selects maximally diverse set', () => {
    const a = makeEntry('a', [1, 0, 0]);
    const b = makeEntry('b', [0, 1, 0]);
    const c = makeEntry('c', [-1, 0, 0]);
    const result = mmr([a, b, c], undefined, { k: 3, lambda: 0 });
    expect(result).toHaveLength(3);
    expect(new Set(result.map((e) => e.id)).size).toBe(3);
  });
});

describe('mmr — no query embedding (importance fallback)', () => {
  it('ranks by importance when no query embedding given', () => {
    const imp9 = makeEntry('imp9', [0, 1, 0], 9);
    const imp2 = makeEntry('imp2', [1, 0, 0], 2);
    const result = mmr([imp2, imp9], undefined, { k: 1, lambda: 0.5 });
    expect(result[0].id).toBe('imp9');
  });

  it('importance ranking holds across diverse embeddings', () => {
    const entries = [
      makeEntry('low', [1, 0, 0], 1),
      makeEntry('high', [0, 1, 0], 10),
      makeEntry('mid', [-1, 0, 0], 5),
    ];
    const result = mmr(entries, undefined, { k: 1, lambda: 0.5 });
    expect(result[0].id).toBe('high');
  });
});

describe('mmr — default lambda', () => {
  it('defaults lambda to 0.5 (balances relevance and diversity)', () => {
    const result = mmr([near1, near2, far], query, { k: 3 });
    expect(result).toHaveLength(3);
  });
});
