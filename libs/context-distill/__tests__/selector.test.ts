import { describe, expect, it } from 'vitest';

import { select } from '../src/selector.js';
import type { DistillEntry } from '../src/types.js';

function makeEntry(
  id: string,
  importance: number,
  embedding: number[],
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

const high = makeEntry('high', 9, [1, 0, 0]);
const low = makeEntry('low', 2, [1, 0, 0]);
const mid = makeEntry('mid', 5, [0.9, 0.44, 0]);

describe('select', () => {
  it('score strategy picks highest importance entry', () => {
    const result = select([high, low, mid], 'score');
    expect(result.representative.id).toBe('high');
    expect(result.representativeReason).toBe('highest_score');
  });

  it('centroid strategy picks entry closest to cluster centroid', () => {
    const entries = [high, low];
    const result = select(entries, 'centroid');
    expect(['high', 'low']).toContain(result.representative.id);
    expect(result.representativeReason).toBe('closest_to_centroid');
  });

  it('hybrid strategy returns a representative', () => {
    const result = select([high, low, mid], 'hybrid');
    expect(result.representativeReason).toBe('hybrid_score');
  });

  it('works on a single-member cluster', () => {
    const result = select([high], 'score');
    expect(result.representative.id).toBe('high');
  });

  it('computes similarity and confidence in [0,1]', () => {
    const result = select([high, low], 'score');
    expect(result.similarity).toBeGreaterThanOrEqual(0);
    expect(result.similarity).toBeLessThanOrEqual(1);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('assigns suggestedAction merge for tight clusters', () => {
    // identical embeddings → similarity 1 → merge
    const result = select([high, low], 'score');
    expect(result.suggestedAction).toBe('merge');
  });
});
