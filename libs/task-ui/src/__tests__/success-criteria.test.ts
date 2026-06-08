import { describe, expect, it } from 'vitest';

import {
  buildSuccessCriteria,
  EMPTY_EVIDENCE_REQUIREMENTS,
  EMPTY_RUBRIC_FORM,
  getRubricWeightSummary,
  normalizeCriterionId,
  opUsesMax,
  opUsesValue,
  validateRubricForm,
} from '../success-criteria.js';

describe('buildSuccessCriteria', () => {
  it('returns undefined when nothing is authored', () => {
    expect(buildSuccessCriteria()).toBeUndefined();
  });

  it('builds a custom evidence assertion without a value', () => {
    const result = buildSuccessCriteria(EMPTY_RUBRIC_FORM, {
      ...EMPTY_EVIDENCE_REQUIREMENTS,
      customAssertions: [{ path: 'commits.*.sha', op: 'exists', value: '' }],
    });
    expect(result).toEqual({
      version: 1,
      assertions: [{ id: 'a1', path: 'commits.*.sha', op: 'exists' }],
    });
  });

  it('coerces min-length to a number and in-range to a [min,max] tuple', () => {
    const result = buildSuccessCriteria(EMPTY_RUBRIC_FORM, {
      ...EMPTY_EVIDENCE_REQUIREMENTS,
      customAssertions: [
        { path: 'items', op: 'min-length', value: '3' },
        { path: 'score', op: 'in-range', value: '0', max: '1' },
      ],
    });
    expect(result?.assertions?.[0]).toEqual({
      id: 'a1',
      path: 'items',
      op: 'min-length',
      value: 3,
    });
    expect(result?.assertions?.[1]).toEqual({
      id: 'a2',
      path: 'score',
      op: 'in-range',
      value: [0, 1],
    });
  });

  it('keeps matches value as a raw regex string', () => {
    const result = buildSuccessCriteria(EMPTY_RUBRIC_FORM, {
      ...EMPTY_EVIDENCE_REQUIREMENTS,
      customAssertions: [{ path: 'title', op: 'matches', value: '^RFC-\\d+' }],
    });
    expect(result?.assertions?.[0].value).toBe('^RFC-\\d+');
  });

  it('builds rubric criteria, minComposite, and normalized criterion ids', () => {
    const result = buildSuccessCriteria({
      rubricId: 'implementation-quality',
      version: 'v1',
      preamble: 'Judge the work.',
      minCompositePercent: '85',
      criteria: [
        {
          name: 'Implementation Quality',
          weightPercent: '60',
          scoring: 'llm_score',
          description: 'Good implementation.',
        },
        {
          name: 'evidence-quality',
          weightPercent: '40',
          scoring: 'boolean',
          description: 'Good evidence.',
        },
      ],
    });

    expect(result).toEqual({
      version: 1,
      minComposite: 0.85,
      rubric: {
        rubricId: 'implementation-quality',
        version: 'v1',
        preamble: 'Judge the work.',
        criteria: [
          {
            id: 'implementation_quality',
            description: 'Good implementation.',
            weight: 0.6,
            scoring: 'llm_score',
          },
          {
            id: 'evidence_quality',
            description: 'Good evidence.',
            weight: 0.4,
            scoring: 'boolean',
          },
        ],
      },
    });
  });

  it('omits empty rubric criteria', () => {
    const result = buildSuccessCriteria({
      ...EMPTY_RUBRIC_FORM,
      rubricId: 'r',
      criteria: [
        {
          name: '',
          weightPercent: '',
          scoring: 'llm_score',
          description: '',
        },
      ],
    });

    expect(result).toBeUndefined();
  });

  it('builds required evidence as assertions and side effects', () => {
    const result = buildSuccessCriteria(EMPTY_RUBRIC_FORM, {
      ...EMPTY_EVIDENCE_REQUIREMENTS,
      requirePrUrl: true,
      minCommits: '2',
      requireDiaryEntry: true,
      diaryEntryTags: ['accountable-commit'],
      referencedEntries: '1',
      requireOutputBody: true,
      customAssertions: [{ path: 'summary', op: 'min-length', value: '20' }],
    });

    expect(result).toEqual({
      version: 1,
      assertions: [
        {
          id: 'a1',
          path: 'pullRequestUrl',
          op: 'matches',
          value: '^https://github\\.com/.+/.+/pull/[0-9]+$',
        },
        { id: 'a2', path: 'commits', op: 'min-length', value: 2 },
        { id: 'a3', path: 'body', op: 'exists' },
        { id: 'a4', path: 'summary', op: 'min-length', value: 20 },
      ],
      sideEffects: {
        diaryEntryRequired: true,
        diaryEntryTags: ['accountable-commit'],
        referencedEntries: 1,
      },
    });
  });

  it('omits sideEffects entirely when none are set', () => {
    const result = buildSuccessCriteria(EMPTY_RUBRIC_FORM, {
      ...EMPTY_EVIDENCE_REQUIREMENTS,
      customAssertions: [{ path: 'x', op: 'exists', value: '' }],
    });
    expect(result?.sideEffects).toBeUndefined();
  });

  it('exposes op capability helpers', () => {
    expect(opUsesValue('exists')).toBe(false);
    expect(opUsesValue('equals')).toBe(true);
    expect(opUsesMax('in-range')).toBe(true);
    expect(opUsesMax('min-length')).toBe(false);
  });

  it('validates rubric weights client-side', () => {
    const rubric = {
      ...EMPTY_RUBRIC_FORM,
      rubricId: 'r',
      criteria: [
        {
          name: 'a',
          weightPercent: '50',
          scoring: 'llm_score' as const,
          description: 'A',
        },
        {
          name: 'b',
          weightPercent: '25',
          scoring: 'boolean' as const,
          description: 'B',
        },
      ],
    };

    expect(getRubricWeightSummary(rubric)).toEqual({
      totalPercent: 75,
      error: 'Rubric weights must sum to 100% (currently 75.0%).',
    });
    expect(validateRubricForm(rubric)).toBe(
      'Rubric weights must sum to 100% (currently 75.0%).',
    );
  });

  it('normalizes criterion ids without regex backtracking', () => {
    expect(normalizeCriterionId('__Implementation Quality!!')).toBe(
      'implementation_quality',
    );
    expect(normalizeCriterionId('security___surface')).toBe('security_surface');
    expect(normalizeCriterionId('___')).toBe('');
  });
});
