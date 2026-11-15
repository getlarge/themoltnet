import { readFileSync } from 'node:fs';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import {
  retrievalEntries,
  retrievalQueries,
} from '../evals/fixtures/retrieval-corpus.js';
import {
  calculateRetrievalMetrics,
  type RetrievalMetricInput,
} from '../evals/retrieval-metrics.js';

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

describe('retrieval corpus integrity (no retrieval evaluation)', () => {
  // Parse source rather than importing its tests, which would start containers.
  function sourceTestLiterals(path: string, testName: string): Set<string> {
    const source = ts.createSourceFile(
      path,
      readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const literals = new Set<string>();
    let matches = 0;
    function collect(node: ts.Node): void {
      if (ts.isStringLiteral(node)) literals.add(node.text);
      ts.forEachChild(node, collect);
    }
    function visit(node: ts.Node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'it' &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0]) &&
        node.arguments[0].text === testName
      ) {
        matches++;
        collect(node);
      } else {
        ts.forEachChild(node, visit);
      }
    }
    visit(source);
    expect(matches, `Unique source test: ${path} / ${testName}`).toBe(1);
    return literals;
  }

  it('uses unique entry and query IDs with complete, valid binary labels', () => {
    const corpusIds = retrievalEntries.map((entry) => entry.id);
    expect(new Set(corpusIds).size).toBe(corpusIds.length);
    expect(new Set(retrievalQueries.map((query) => query.id)).size).toBe(
      retrievalQueries.length,
    );
    for (const query of retrievalQueries) {
      expect(query.rationale.trim().length).toBeGreaterThan(0);
      expect(() =>
        calculateRetrievalMetrics({
          corpusIds,
          relevantIds: query.relevantIds,
          retrievedIds: [],
          k: 1,
        }),
      ).not.toThrow();
    }
    expect(
      retrievalQueries.some((query) => query.relevantIds.length === 0),
    ).toBe(true);
    expect(retrievalQueries.some((query) => query.relevantIds.length > 1)).toBe(
      true,
    );
  });

  it.each(retrievalEntries)(
    'preserves existing prose and metadata text: $id',
    (entry) => {
      const literals = sourceTestLiterals(entry.source.path, entry.source.test);
      for (const text of [
        entry.content,
        ...(entry.title ? [entry.title] : []),
        ...(entry.tags ?? []),
      ]) {
        expect(literals.has(text), `Source text for ${entry.id}: ${text}`).toBe(
          true,
        );
      }
    },
  );

  it.each(retrievalQueries)('preserves an existing query: $id', (query) => {
    const literals = sourceTestLiterals(query.source.path, query.source.test);
    expect(literals.has(query.query)).toBe(true);
  });
});
