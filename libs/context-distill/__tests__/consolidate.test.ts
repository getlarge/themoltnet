import { describe, expect, it } from 'vitest';

import { consolidate } from '../src/consolidate.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  embedding: number[],
  importance = 5,
): DistillEntry {
  return {
    id,
    embedding,
    content: `content for entry ${id}`,
    tokens: 10,
    importance,
    createdAt: '2024-01-01T00:00:00Z',
  };
}

function randomNormalizedEmbedding(dim: number): number[] {
  const v = Array.from({ length: dim }, () => Math.random() - 0.5);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return v.map((x) => x / norm);
}

const e1 = makeEntry('a', [1, 0, 0]);
const e2 = makeEntry('b', [1, 0, 0]); // duplicate of e1
const e3 = makeEntry('c', [0, 1, 0]); // orthogonal
const e4 = makeEntry('d', [0, 1, 0]); // duplicate of e3

describe('consolidate — unit', () => {
  it('returns a ConsolidateResult shape', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result).toHaveProperty('clusters');
    expect(result).toHaveProperty('stats');
    expect(result).toHaveProperty('trace');
  });

  it('groups identical embeddings into same cluster', () => {
    const result = consolidate([e1, e2, e3], { threshold: 0.15 });
    expect(result.clusters).toHaveLength(2);
    const sizes = result.clusters.map((c) => c.members.length).sort();
    expect(sizes).toEqual([1, 2]);
  });

  it('groups multiple identical pairs correctly', () => {
    const result = consolidate([e1, e2, e3, e4], { threshold: 0.15 });
    expect(result.clusters).toHaveLength(2);
    result.clusters.forEach((c) => expect(c.members).toHaveLength(2));
  });

  it('stats.inputCount matches entries.length', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result.stats.inputCount).toBe(3);
  });

  it('stats.clusterCount matches clusters.length', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result.stats.clusterCount).toBe(result.clusters.length);
  });

  it('singletonRate is 0.5 when 1 out of 2 clusters has 1 member', () => {
    const result = consolidate([e1, e2, e3], { threshold: 0.15 });
    expect(result.stats.singletonRate).toBeCloseTo(0.5);
  });

  it('singletonRate is 1 when all clusters are singletons', () => {
    const result = consolidate([e1, e3], { threshold: 0 });
    expect(result.stats.singletonRate).toBe(1);
  });

  it('trace.thresholdUsed reflects the option passed', () => {
    const result = consolidate([e1, e2], { threshold: 0.25 });
    expect(result.trace.thresholdUsed).toBe(0.25);
  });

  it('trace.strategyUsed reflects the option passed', () => {
    const result = consolidate([e1, e2], { strategy: 'score' });
    expect(result.trace.strategyUsed).toBe('score');
  });

  it('trace.embeddingDim reflects actual embedding dimensions', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result.trace.embeddingDim).toBe(3);
  });

  it('elapsedMs is non-negative', () => {
    const result = consolidate([e1, e2, e3]);
    expect(result.stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('handles single entry', () => {
    const result = consolidate([e1]);
    expect(result.clusters).toHaveLength(1);
    expect(result.stats.inputCount).toBe(1);
    expect(result.stats.singletonRate).toBe(1);
  });

  it('handles empty input', () => {
    const result = consolidate([]);
    expect(result.clusters).toHaveLength(0);
    expect(result.stats.inputCount).toBe(0);
  });

  it('each cluster has a representative that is one of its members', () => {
    const result = consolidate([e1, e2, e3]);
    for (const cluster of result.clusters) {
      const ids = cluster.members.map((m) => m.id);
      expect(ids).toContain(cluster.representative.id);
    }
  });
});

describe('consolidate — integration properties', () => {
  it('total members across all clusters equals input count', () => {
    const entries = [e1, e2, e3, e4];
    const result = consolidate(entries);
    const total = result.clusters.reduce((s, c) => s + c.members.length, 0);
    expect(total).toBe(entries.length);
  });

  it('no entry appears in more than one cluster', () => {
    const entries = [e1, e2, e3, e4];
    const result = consolidate(entries);
    const allIds = result.clusters.flatMap((c) => c.members.map((m) => m.id));
    const unique = new Set(allIds);
    expect(unique.size).toBe(allIds.length);
  });

  it('all input entry ids appear exactly once across clusters', () => {
    const entries = [e1, e2, e3, e4];
    const result = consolidate(entries);
    const allIds = new Set(
      result.clusters.flatMap((c) => c.members.map((m) => m.id)),
    );
    for (const e of entries) {
      expect(allIds.has(e.id)).toBe(true);
    }
  });

  it('works with arbitrary embedding dimensions (not just 3)', () => {
    const dim = 128;
    const entries = Array.from({ length: 10 }, (_, i) =>
      makeEntry(`e${i}`, randomNormalizedEmbedding(dim)),
    );
    const result = consolidate(entries);
    const total = result.clusters.reduce((s, c) => s + c.members.length, 0);
    expect(total).toBe(entries.length);
    expect(result.trace.embeddingDim).toBe(dim);
  });

  it('higher threshold produces fewer clusters', () => {
    const entries = [e1, e2, e3, e4];
    const tight = consolidate(entries, { threshold: 0.01 });
    const loose = consolidate(entries, { threshold: 0.99 });
    expect(loose.clusters.length).toBeLessThanOrEqual(tight.clusters.length);
  });

  it('clusterSizeDistribution min <= median <= max', () => {
    const entries = [e1, e2, e3, e4];
    const result = consolidate(entries);
    const [min, , median, , max] = result.stats.clusterSizeDistribution;
    expect(min).toBeLessThanOrEqual(median);
    expect(median).toBeLessThanOrEqual(max);
  });
});
