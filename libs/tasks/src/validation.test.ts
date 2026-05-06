import { describe, expect, it } from 'vitest';

import { validateTaskCreateRequest, validateTaskOutput } from './validation.js';

describe('validateTaskCreateRequest', () => {
  it('rejects prototype task type keys as unknown', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'constructor',
      input: {},
    });

    expect(errors).toEqual([
      {
        field: 'taskType',
        message: 'Unknown task type: constructor',
      },
    ]);
  });

  it('requires references for judge_pack', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'judge_pack',
      input: {
        renderedPackId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourcePackId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        rubric: {
          rubricId: 'pack-fidelity-v3',
          version: 'v3',
          scope: 'packs',
          preamble: 'Judge the pack faithfully.',
          criteria: [
            {
              id: 'grounding',
              description: 'No unsupported claims.',
              weight: 1,
              scoring: 'llm_score',
            },
          ],
        },
      },
      references: [],
    });

    expect(errors).toEqual([
      {
        field: 'references',
        message: 'At least one reference is required for task type: judge_pack',
      },
    ]);
  });
});

describe('validateTaskOutput', () => {
  it('rejects prototype task type keys as unknown', () => {
    const errors = validateTaskOutput('toString', {});

    expect(errors).toEqual([
      {
        field: 'taskType',
        message: 'Unknown task type: toString',
      },
    ]);
  });

  it('returns field-level errors for invalid fulfill_brief output', () => {
    const errors = validateTaskOutput('fulfill_brief', {
      branch: 'feat/tasks',
      commits: [],
      summary: 42,
    });

    expect(errors).toEqual(
      expect.arrayContaining([
        {
          field: 'output/pullRequestUrl',
          message: 'Expected union value',
        },
        {
          field: 'output/diaryEntryIds',
          message: 'Expected array',
        },
      ]),
    );
  });

  describe('judge_pack llm_checklist score↔assertions consistency (#999)', () => {
    function buildOutput(
      assertions: Array<{
        id: string;
        text: string;
        passed: boolean;
        evidence: string;
      }>,
      score: number,
    ) {
      return {
        scores: [
          {
            criterionId: 'grounding',
            score,
            assertions,
          },
        ],
        composite: score,
        verdict: 'test',
      };
    }

    it('accepts score=1 when every assertion passes', () => {
      const errors = validateTaskOutput(
        'judge_pack',
        buildOutput(
          [
            { id: 'c1', text: 'ok', passed: true, evidence: 'src entry abc' },
            { id: 'c2', text: 'ok', passed: true, evidence: 'src entry def' },
          ],
          1,
        ),
      );
      expect(errors).toEqual([]);
    });

    it('accepts score=0 when any assertion fails', () => {
      const errors = validateTaskOutput(
        'judge_pack',
        buildOutput(
          [
            { id: 'c1', text: 'ok', passed: true, evidence: 'src entry abc' },
            {
              id: 'c2',
              text: 'fab',
              passed: false,
              evidence: 'no supporting span',
            },
          ],
          0,
        ),
      );
      expect(errors).toEqual([]);
    });

    it('rejects score=1 when an assertion failed (the headline P1 bug)', () => {
      const errors = validateTaskOutput(
        'judge_pack',
        buildOutput(
          [
            { id: 'c1', text: 'ok', passed: true, evidence: 'src entry abc' },
            {
              id: 'c2',
              text: 'fab',
              passed: false,
              evidence: 'no supporting span',
            },
          ],
          1,
        ),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('output');
      expect(errors[0].message).toContain('have at least one fail');
      expect(errors[0].message).toContain('score=1');
    });

    it('rejects score=0 when every assertion passed', () => {
      const errors = validateTaskOutput(
        'judge_pack',
        buildOutput(
          [
            { id: 'c1', text: 'ok', passed: true, evidence: 'src entry abc' },
            { id: 'c2', text: 'ok', passed: true, evidence: 'src entry def' },
          ],
          0,
        ),
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toContain('all pass');
      expect(errors[0].message).toContain('score=0');
    });

    it('skips the cross-field check when assertions is absent (e.g. llm_score)', () => {
      // Backward compat: existing rubrics that use llm_score don't
      // populate assertions, so the validator should ignore the score
      // entirely for those criteria.
      const errors = validateTaskOutput('judge_pack', {
        scores: [
          {
            criterionId: 'old-style',
            score: 0.85,
            rationale: 'mostly fine',
          },
        ],
        composite: 0.85,
        verdict: 'test',
      });
      expect(errors).toEqual([]);
    });
  });
});
