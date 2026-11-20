import { describe, expect, it } from 'vitest';

import {
  calculateRetrievalMetrics,
  type RetrievalMetricInput,
} from '../src/binary-metrics.js';

describe('retrieval metrics', () => {
  const baseline: RetrievalMetricInput = {
    corpusIds: ['a', 'b', 'c', 'd'],
    relevantIds: ['a', 'c'],
    retrievedIds: ['b', 'a', 'c'],
    k: 2,
  };

  it('scores only the top k and preserves diagnostic IDs', () => {
    expect(calculateRetrievalMetrics(baseline)).toEqual({
      k: 2,
      retrievedCount: 2,
      relevantCount: 2,
      truePositives: 1,
      falsePositives: 1,
      precisionAtK: 0.5,
      recallAtK: 0.5,
      unexpectedIds: ['b'],
      missedRelevantIds: ['c'],
    });
  });

  it('distinguishes a relevant first result from a distractor first result', () => {
    expect(calculateRetrievalMetrics({ ...baseline, k: 1 }).precisionAtK).toBe(
      0,
    );
    expect(
      calculateRetrievalMetrics({
        ...baseline,
        retrievedIds: ['a', 'b', 'c'],
        k: 1,
      }).precisionAtK,
    ).toBe(1);
  });

  it('uses k as the precision denominator when fewer entries are returned', () => {
    const result = calculateRetrievalMetrics({
      ...baseline,
      retrievedIds: ['a'],
      k: 5,
    });
    expect(result.precisionAtK).toBe(0.2);
    expect(result.recallAtK).toBe(0.5);
    expect(result.falsePositives).toBe(0);
    expect(result.retrievedCount).toBe(1);
  });

  it('reports perfect retrieval when all top-k results are relevant', () => {
    const result = calculateRetrievalMetrics({
      ...baseline,
      retrievedIds: ['c', 'a', 'b'],
    });
    expect(result.precisionAtK).toBe(1);
    expect(result.recallAtK).toBe(1);
    expect(result.missedRelevantIds).toEqual([]);
  });

  it('reports zero precision and recall when relevant entries are missed', () => {
    const result = calculateRetrievalMetrics({ ...baseline, retrievedIds: [] });
    expect(result.precisionAtK).toBe(0);
    expect(result.recallAtK).toBe(0);
    expect(result.missedRelevantIds).toEqual(['a', 'c']);
  });

  it('counts false positives for no-match queries without inventing recall', () => {
    const result = calculateRetrievalMetrics({ ...baseline, relevantIds: [] });
    expect(result.falsePositives).toBe(2);
    expect(result.unexpectedIds).toEqual(['b', 'a']);
    expect(result.precisionAtK).toBe(0);
    expect(result.recallAtK).toBeNull();
  });

  it('distinguishes successful abstention on a no-match query', () => {
    const result = calculateRetrievalMetrics({
      ...baseline,
      relevantIds: [],
      retrievedIds: [],
    });
    expect(result.falsePositives).toBe(0);
    expect(result.recallAtK).toBeNull();
    expect(result.precisionAtK).toBe(0);
  });

  it.each([0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid k=%s',
    (k) => {
      expect(() => calculateRetrievalMetrics({ ...baseline, k })).toThrow(
        'k must be a positive safe integer',
      );
    },
  );

  it.each(['corpusIds', 'relevantIds', 'retrievedIds'] as const)(
    'rejects duplicate and empty IDs in %s',
    (field) => {
      for (const ids of [
        ['a', 'a'],
        ['a', ' '],
      ]) {
        expect(() =>
          calculateRetrievalMetrics({ ...baseline, [field]: ids }),
        ).toThrow(`${field} must contain distinct, nonempty IDs`);
      }
    },
  );

  it.each(['relevantIds', 'retrievedIds'] as const)(
    'rejects unknown corpus IDs in %s, including beyond k',
    (field) => {
      expect(() =>
        calculateRetrievalMetrics({
          ...baseline,
          [field]: ['a', 'b', 'unknown'],
        }),
      ).toThrow('Unknown corpus ID: unknown');
    },
  );

  it('does not mutate input arrays', () => {
    const input = {
      corpusIds: Object.freeze([...baseline.corpusIds]),
      relevantIds: Object.freeze([...baseline.relevantIds]),
      retrievedIds: Object.freeze([...baseline.retrievedIds]),
      k: 2,
    };
    const before = structuredClone(input);
    calculateRetrievalMetrics(input);
    expect(input).toEqual(before);
  });
});
