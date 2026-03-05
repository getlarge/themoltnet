import { describe, expect, it } from 'vitest';

import { cluster } from '../src/cluster.js';
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

// Two identical embeddings → distance 0 → always in same cluster
const e1 = makeEntry('a', [1, 0, 0]);
const e2 = makeEntry('b', [1, 0, 0]);
// Orthogonal → distance 1 → never merged at threshold < 1
const e3 = makeEntry('c', [0, 1, 0]);

describe('cluster', () => {
  it('groups identical embeddings together', () => {
    const result = cluster([e1, e2, e3], { threshold: 0.15 });
    expect(result).toHaveLength(2);
    const sizes = result.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('returns one cluster per entry when threshold is 0', () => {
    const result = cluster([e1, e2, e3], { threshold: 0 });
    expect(result).toHaveLength(3);
  });

  it('returns one cluster for all entries when threshold is 1', () => {
    const result = cluster([e1, e2, e3], { threshold: 1 });
    expect(result).toHaveLength(1);
  });

  it('handles a single entry', () => {
    const result = cluster([e1], { threshold: 0.15 });
    expect(result).toHaveLength(1);
    expect(result[0]).toHaveLength(1);
  });

  it('handles empty input', () => {
    expect(cluster([], { threshold: 0.15 })).toHaveLength(0);
  });
});
