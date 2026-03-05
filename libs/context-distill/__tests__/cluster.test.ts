import { describe, expect, it } from 'vitest';

import { cluster, cosineDistance } from '../src/cluster.js';
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

describe('cosineDistance', () => {
  it('identical vectors have distance 0', () => {
    expect(cosineDistance([1, 0, 0], [1, 0, 0])).toBeCloseTo(0);
  });

  it('orthogonal vectors have distance 1', () => {
    expect(cosineDistance([1, 0, 0], [0, 1, 0])).toBeCloseTo(1);
  });

  it('opposite vectors have distance 2', () => {
    expect(cosineDistance([1, 0, 0], [-1, 0, 0])).toBeCloseTo(2);
  });

  it('returns 1 when either vector is zero', () => {
    expect(cosineDistance([0, 0, 0], [1, 0, 0])).toBe(1);
    expect(cosineDistance([1, 0, 0], [0, 0, 0])).toBe(1);
  });

  it('is symmetric', () => {
    const a = [0.6, 0.8, 0];
    const b = [0.8, 0.6, 0];
    expect(cosineDistance(a, b)).toBeCloseTo(cosineDistance(b, a));
  });
});

describe('cluster', () => {
  it('groups identical embeddings together', () => {
    const result = cluster([e1, e2, e3], { threshold: 0.15 });
    expect(result).toHaveLength(2);
    const sizes = result.map((c) => c.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('the two identical embeddings end up in the same cluster', () => {
    const result = cluster([e1, e2, e3], { threshold: 0.15 });
    const pair = result.find((c) => c.length === 2)!;
    const ids = pair.map((e) => e.id).sort();
    expect(ids).toEqual(['a', 'b']);
  });

  it('orthogonal entry stays in its own cluster', () => {
    const result = cluster([e1, e2, e3], { threshold: 0.15 });
    const singleton = result.find((c) => c.length === 1)!;
    expect(singleton[0].id).toBe('c');
  });

  it('near-identical (not exact) embeddings merge below threshold', () => {
    // distance between [1,0,0] and [0.99, 0.14, 0] ≈ 0.01 — well below 0.15
    const close = makeEntry('close', [0.99, 0.14, 0]);
    const result = cluster([e1, close], { threshold: 0.15 });
    expect(result).toHaveLength(1);
  });

  it('near-identical embeddings stay separate above their distance', () => {
    // distance ≈ 0.01 — use threshold 0.001 so they do NOT merge
    const close = makeEntry('close', [0.99, 0.14, 0]);
    const result = cluster([e1, close], { threshold: 0.001 });
    expect(result).toHaveLength(2);
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

  it('every input entry appears in exactly one cluster', () => {
    const entries = [e1, e2, e3];
    const result = cluster(entries, { threshold: 0.15 });
    const allIds = result.flatMap((c) => c.map((e) => e.id));
    expect(new Set(allIds).size).toBe(allIds.length);
    expect(allIds.length).toBe(entries.length);
  });
});
