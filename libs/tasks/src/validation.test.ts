import { describe, expect, it } from 'vitest';

import {
  taskTypeUsesSubagents,
  taskTypeWorkspaceMode,
  validateTaskCreateRequest,
  validateTaskOutput,
} from './validation.js';

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
        successCriteria: {
          version: 1,
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

  it('rejects judge_pack input missing successCriteria', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'judge_pack',
      input: {
        renderedPackId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourcePackId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      },
      references: [{} as never],
    });
    expect(errors.length).toBeGreaterThan(0);
    // The schema-level error fires before our cross-field validator —
    // the missing `successCriteria` is reported as an input shape miss.
    expect(errors.some((e) => e.field.startsWith('input'))).toBe(true);
  });

  it('rejects judge_pack successCriteria without rubric', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'judge_pack',
      input: {
        renderedPackId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        sourcePackId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        // Envelope present but rubric missing — the cross-field
        // validator fires.
        successCriteria: { version: 1 },
      },
      references: [{} as never],
    });
    expect(errors).toEqual([
      {
        field: 'input',
        message: 'successCriteria.rubric is required for judgment tasks',
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

  describe('verification cross-field rule (fulfillment task types)', () => {
    const goodOutput = {
      branch: 'feat/x',
      commits: [
        {
          sha: 'abc1234',
          message: 'feat: do',
          diaryEntryId: '00000000-0000-4000-8000-000000000001',
        },
      ],
      pullRequestUrl: null,
      diaryEntryIds: ['00000000-0000-4000-8000-000000000001'],
      summary: 'did the thing',
    };

    const verification = {
      inputCid: 'bafy-input',
      results: [
        {
          id: 'has-branch',
          kind: 'assertion' as const,
          status: 'pass' as const,
        },
      ],
      passed: true,
    };

    it('rejects output without verification when input has successCriteria', () => {
      const errors = validateTaskOutput('fulfill_brief', goodOutput, {
        brief: 'do',
        successCriteria: { version: 1 },
      });
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('output');
      expect(errors[0].message).toMatch(/verification is required/i);
    });

    it('rejects output with verification when input has no successCriteria', () => {
      const errors = validateTaskOutput(
        'fulfill_brief',
        { ...goodOutput, verification },
        { brief: 'do' },
      );
      expect(errors).toHaveLength(1);
      expect(errors[0].field).toBe('output');
      expect(errors[0].message).toMatch(/omit verification/i);
    });

    it('accepts the consistent pair (criteria + verification)', () => {
      const errors = validateTaskOutput(
        'fulfill_brief',
        { ...goodOutput, verification },
        { brief: 'do', successCriteria: { version: 1 } },
      );
      expect(errors).toEqual([]);
    });

    it('accepts the consistent pair (no criteria, no verification)', () => {
      const errors = validateTaskOutput('fulfill_brief', goodOutput, {
        brief: 'do',
      });
      expect(errors).toEqual([]);
    });

    it('skips the cross-field check when input is omitted (back-compat)', () => {
      // Callers that don't have the input on hand (ad-hoc tooling)
      // get only the schema check; the cross-field rule is silently
      // skipped rather than failing closed.
      const errors = validateTaskOutput('fulfill_brief', goodOutput);
      expect(errors).toEqual([]);
    });
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

describe('taskTypeUsesSubagents', () => {
  it('returns false for unknown task types', () => {
    expect(taskTypeUsesSubagents('totally_made_up')).toBe(false);
  });

  it('returns false for built-in types that did not opt in', () => {
    // None of the current built-ins use subagents (judge_eval_variant
    // lands in PR-B and will set this to true).
    expect(taskTypeUsesSubagents('fulfill_brief')).toBe(false);
    expect(taskTypeUsesSubagents('assess_brief')).toBe(false);
    expect(taskTypeUsesSubagents('curate_pack')).toBe(false);
    expect(taskTypeUsesSubagents('render_pack')).toBe(false);
    expect(taskTypeUsesSubagents('judge_pack')).toBe(false);
    expect(taskTypeUsesSubagents('run_eval')).toBe(false);
  });
});

describe('taskTypeWorkspaceMode', () => {
  it('defaults unknown task types to shared_mount', () => {
    expect(taskTypeWorkspaceMode('totally_made_up')).toBe('shared_mount');
  });

  it('marks fulfill_brief as dedicated_worktree', () => {
    expect(taskTypeWorkspaceMode('fulfill_brief')).toBe('dedicated_worktree');
  });

  it('keeps non-mutating built-ins on shared_mount', () => {
    expect(taskTypeWorkspaceMode('assess_brief')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('curate_pack')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('render_pack')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('judge_pack')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('run_eval')).toBe('shared_mount');
  });
});
