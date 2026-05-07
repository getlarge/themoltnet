import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

import {
  evaluateAssertions,
  resolveDottedPath,
  SuccessCriteria,
  type SuccessCriteria as SuccessCriteriaT,
} from './success-criteria.js';

describe('SuccessCriteria schema', () => {
  it('accepts an empty document (all sections optional)', () => {
    const doc = { version: 1 };
    expect(Value.Check(SuccessCriteria, doc)).toBe(true);
  });

  it('rejects unknown top-level fields', () => {
    const doc = { version: 1, surprise: true };
    expect(Value.Check(SuccessCriteria, doc)).toBe(false);
  });

  it('accepts a schema-check gate with required=true', () => {
    const doc: SuccessCriteriaT = {
      version: 1,
      gates: [
        {
          id: 'output-shape',
          kind: 'schema-check',
          spec: { schemaCid: 'bafyreibCID' },
          required: true,
        },
      ],
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(true);
  });

  it('accepts a cid-equals gate', () => {
    const doc: SuccessCriteriaT = {
      version: 1,
      gates: [
        {
          id: 'matches-canonical',
          kind: 'cid-equals',
          spec: { path: 'outputCid', expected: 'bafyXYZ' },
          required: false,
        },
      ],
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(true);
  });

  it('rejects an unsupported gate kind (http/shell deferred)', () => {
    const doc = {
      version: 1,
      gates: [
        {
          id: 'probe',
          kind: 'http',
          spec: { url: 'https://example.com' },
          required: true,
        },
      ],
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(false);
  });

  it('accepts assertions across the supported ops', () => {
    const doc: SuccessCriteriaT = {
      version: 1,
      assertions: [
        { id: 'has-summary', path: 'summary', op: 'exists' },
        {
          id: 'branch-prefix',
          path: 'branch',
          op: 'matches',
          value: '^moltnet/',
        },
        { id: 'min-commits', path: 'commits', op: 'min-length', value: 1 },
        {
          id: 'composite-band',
          path: 'composite',
          op: 'in-range',
          value: [0.7, 1],
        },
        { id: 'verdict-eq', path: 'verdict', op: 'equals', value: 'pass' },
      ],
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(true);
  });

  it('accepts a Rubric reused verbatim from rubric.ts', () => {
    const doc: SuccessCriteriaT = {
      version: 1,
      rubric: {
        rubricId: 'pr-quality',
        version: 'v1',
        criteria: [
          {
            id: 'tests',
            description: 'Tests',
            weight: 0.5,
            scoring: 'llm_score',
          },
          { id: 'docs', description: 'Docs', weight: 0.5, scoring: 'boolean' },
        ],
      },
      minComposite: 0.7,
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(true);
  });

  it('accepts sideEffects with diary requirements', () => {
    const doc: SuccessCriteriaT = {
      version: 1,
      sideEffects: {
        diaryEntryRequired: true,
        diaryEntryTags: ['accountable-commit'],
        referencedEntries: 2,
      },
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(true);
  });

  it('rejects minComposite outside [0,1]', () => {
    const doc = {
      version: 1,
      minComposite: 1.5,
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(false);
  });

  it('rejects referencedEntries below 0', () => {
    const doc = {
      version: 1,
      sideEffects: { referencedEntries: -1 },
    };
    expect(Value.Check(SuccessCriteria, doc)).toBe(false);
  });
});

describe('resolveDottedPath', () => {
  const sample = {
    branch: 'moltnet/abc/feat',
    commits: [
      { sha: 'aaa1111', message: 'first' },
      { sha: 'bbb2222', message: 'second' },
    ],
    composite: 0.83,
    nested: { score: { value: 0.5 } },
  };

  it('resolves a top-level field', () => {
    expect(resolveDottedPath(sample, 'branch')).toEqual(['moltnet/abc/feat']);
  });

  it('resolves a deep nested field', () => {
    expect(resolveDottedPath(sample, 'nested.score.value')).toEqual([0.5]);
  });

  it('resolves an indexed array element', () => {
    expect(resolveDottedPath(sample, 'commits.0.sha')).toEqual(['aaa1111']);
  });

  it('expands * over arrays', () => {
    expect(resolveDottedPath(sample, 'commits.*.sha')).toEqual([
      'aaa1111',
      'bbb2222',
    ]);
  });

  it('returns [] for missing paths', () => {
    expect(resolveDottedPath(sample, 'doesNotExist')).toEqual([]);
    expect(resolveDottedPath(sample, 'commits.99.sha')).toEqual([]);
    expect(resolveDottedPath(sample, 'nested.missing.value')).toEqual([]);
  });

  it('treats null as absent', () => {
    expect(resolveDottedPath({ branch: null }, 'branch')).toEqual([]);
  });
});

describe('evaluateAssertions', () => {
  const output = {
    branch: 'moltnet/abc/feat',
    pullRequestUrl: 'https://github.com/getlarge/themoltnet/pull/1',
    commits: [{ sha: 'aaa1111' }, { sha: 'bbb2222' }],
    composite: 0.83,
    summary: 'Did the thing',
  };

  it('reports pass for an existing field with op=exists', () => {
    const results = evaluateAssertions(output, [
      { id: 'has-branch', path: 'branch', op: 'exists' },
    ]);
    expect(results).toEqual([
      { id: 'has-branch', kind: 'assertion', status: 'pass' },
    ]);
  });

  it('reports fail with detail for missing fields', () => {
    const results = evaluateAssertions(output, [
      { id: 'has-rationale', path: 'rationale', op: 'exists' },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: 'has-rationale',
      kind: 'assertion',
      status: 'fail',
    });
    expect(results[0].detail).toMatch(/path .* not found/i);
  });

  it('handles op=equals with strict equality', () => {
    expect(
      evaluateAssertions(output, [
        { id: 'eq-pass', path: 'composite', op: 'equals', value: 0.83 },
      ])[0].status,
    ).toBe('pass');
    expect(
      evaluateAssertions(output, [
        { id: 'eq-fail', path: 'composite', op: 'equals', value: 0.5 },
      ])[0].status,
    ).toBe('fail');
  });

  it('handles op=matches as a regex test', () => {
    expect(
      evaluateAssertions(output, [
        { id: 'pre', path: 'branch', op: 'matches', value: '^moltnet/' },
      ])[0].status,
    ).toBe('pass');
    expect(
      evaluateAssertions(output, [
        { id: 'pre', path: 'branch', op: 'matches', value: '^main$' },
      ])[0].status,
    ).toBe('fail');
  });

  it('handles op=min-length on arrays and strings', () => {
    expect(
      evaluateAssertions(output, [
        { id: 'commits', path: 'commits', op: 'min-length', value: 2 },
      ])[0].status,
    ).toBe('pass');
    expect(
      evaluateAssertions(output, [
        { id: 'commits', path: 'commits', op: 'min-length', value: 3 },
      ])[0].status,
    ).toBe('fail');
    expect(
      evaluateAssertions(output, [
        { id: 'summary', path: 'summary', op: 'min-length', value: 5 },
      ])[0].status,
    ).toBe('pass');
  });

  it('handles op=in-range inclusive on numbers', () => {
    expect(
      evaluateAssertions(output, [
        { id: 'band', path: 'composite', op: 'in-range', value: [0.8, 0.9] },
      ])[0].status,
    ).toBe('pass');
    expect(
      evaluateAssertions(output, [
        { id: 'band', path: 'composite', op: 'in-range', value: [0.9, 1] },
      ])[0].status,
    ).toBe('fail');
  });

  it('checks every value when path uses * (all-must-pass)', () => {
    // commits.*.sha resolves to ['aaa1111','bbb2222']; both must satisfy
    // the assertion or the assertion fails. This matters so an imposer
    // can say "every commit sha is at least 7 chars" and have it mean it.
    expect(
      evaluateAssertions(output, [
        { id: 'shas', path: 'commits.*.sha', op: 'min-length', value: 7 },
      ])[0].status,
    ).toBe('pass');
    expect(
      evaluateAssertions(output, [
        { id: 'shas', path: 'commits.*.sha', op: 'min-length', value: 10 },
      ])[0].status,
    ).toBe('fail');
  });

  it('returns deterministic order matching input', () => {
    const results = evaluateAssertions(output, [
      { id: 'a', path: 'branch', op: 'exists' },
      { id: 'b', path: 'composite', op: 'exists' },
      { id: 'c', path: 'missing', op: 'exists' },
    ]);
    expect(results.map((r) => r.id)).toEqual(['a', 'b', 'c']);
  });
});
