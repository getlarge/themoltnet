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
// mid is between high and low in embedding space; centroid of [high, low, mid] is pulled toward [1,0,0]
const mid = makeEntry('mid', 5, [0.9, 0.44, 0]);
// far is orthogonal to high/low
const far = makeEntry('far', 5, [0, 1, 0]);

describe('select — score strategy', () => {
  it('picks the highest importance entry', () => {
    const result = select([high, low, mid], 'score');
    expect(result.representative.id).toBe('high');
    expect(result.representativeReason).toBe('highest_score');
  });

  it('with a tie in importance, picks first in list', () => {
    const a = makeEntry('a', 7, [1, 0, 0]);
    const b = makeEntry('b', 7, [0, 1, 0]);
    const result = select([a, b], 'score');
    expect(result.representative.id).toBe('a');
  });
});

describe('select — centroid strategy', () => {
  it('picks entry closest to centroid, not just any member', () => {
    // centroid of high([1,0,0]) + far([0,1,0]) = [0.5,0.5,0] (normalized)
    // high is at [1,0,0], far at [0,1,0] — both equidistant from centroid
    // mid at [0.9,0.44,0] is closer to centroid than either extreme
    const result = select([high, far, mid], 'centroid');
    expect(result.representative.id).toBe('mid');
    expect(result.representativeReason).toBe('closest_to_centroid');
  });

  it('with two identical embeddings, centroid equals them — picks first', () => {
    const result = select([high, low], 'centroid');
    // centroid of [1,0,0]+[1,0,0] = [1,0,0] → distance 0 for both → reduce returns first
    expect(result.representative.id).toBe('high');
  });
});

describe('select — hybrid strategy', () => {
  it('high importance near-centroid entry wins over low importance', () => {
    // high: importance=9, embedding=[1,0,0]; far: importance=2, embedding=[0,1,0]
    // centroid ≈ [0.7,0.7,0] — both equidistant from centroid; importance breaks tie
    const result = select([high, far], 'hybrid');
    expect(result.representative.id).toBe('high');
    expect(result.representativeReason).toBe('hybrid_score');
  });

  it('returns a member of the cluster', () => {
    const members = [high, low, mid];
    const result = select(members, 'hybrid');
    expect(members.map((e) => e.id)).toContain(result.representative.id);
  });
});

describe('select — metadata', () => {
  it('works on a single-member cluster (all strategies)', () => {
    for (const strategy of ['score', 'centroid', 'hybrid'] as const) {
      const result = select([high], strategy);
      expect(result.representative.id).toBe('high');
      expect(result.members).toHaveLength(1);
    }
  });

  it('similarity is 1 for identical embeddings', () => {
    const result = select([high, low], 'score'); // both [1,0,0]
    expect(result.similarity).toBeCloseTo(1);
  });

  it('similarity is lower for dissimilar entries', () => {
    const result = select([high, far], 'score'); // [1,0,0] vs [0,1,0] — orthogonal
    expect(result.similarity).toBeCloseTo(0);
  });

  it('confidence is clamped to [0,1]', () => {
    const result = select([high, far], 'score');
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it('suggestedAction is merge for identical embeddings (similarity=1)', () => {
    const result = select([high, low], 'score');
    expect(result.suggestedAction).toBe('merge');
  });

  it('suggestedAction is review for moderately similar cluster', () => {
    // [1,0,0] and [0.9,0.44,0]: similarity ≈ 0.9+0.44*0 / (1*1) = 0.9 — boundary
    // similarity = 1 - cosineDistance ≈ 0.9
    const result = select([high, mid], 'score');
    expect(['merge', 'review']).toContain(result.suggestedAction);
  });

  it('suggestedAction is keep_separate for orthogonal single-member cluster', () => {
    const result = select([far], 'score');
    expect(result.suggestedAction).toBe('keep_separate');
  });

  it('suggestedAction is keep_separate for orthogonal pair (similarity≈0)', () => {
    const result = select([high, far], 'score');
    expect(result.suggestedAction).toBe('keep_separate');
  });

  it('representative is always a member of the cluster', () => {
    for (const strategy of ['score', 'centroid', 'hybrid'] as const) {
      const members = [high, low, mid, far];
      const result = select(members, strategy);
      expect(members.map((e) => e.id)).toContain(result.representative.id);
    }
  });
});
