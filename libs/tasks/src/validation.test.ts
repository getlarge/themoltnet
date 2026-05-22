import { describe, expect, it } from 'vitest';

import {
  getTaskExecutionPolicy,
  normalizeTaskInputForCreate,
  SUBMIT_OUTPUT_GATE_ID,
  taskTypeResumable,
  taskTypeSessionScope,
  taskTypeUsesSubagents,
  taskTypeWorkspaceMode,
  taskTypeWorkspaceScope,
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

  it('rejects pr_review rubrics that are not boolean-only', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'pr_review',
      input: {
        subject: {
          title: 'Review X',
          summary: 'Review this change.',
        },
        successCriteria: {
          version: 1,
          rubric: {
            rubricId: 'pr-complexity',
            version: 'v1',
            criteria: [
              {
                id: 'c1',
                description: 'desc',
                weight: 1,
                scoring: 'llm_score',
              },
            ],
          },
        },
      },
    });
    expect(errors).toEqual([
      {
        field: 'input',
        message:
          'pr_review requires boolean scoring for every rubric criterion; criterion "c1" uses "llm_score"',
      },
    ]);
  });

  it('rejects fulfill_brief acceptanceCriteria as an unknown field', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'fulfill_brief',
      input: {
        brief: 'Implement feature X',
        title: 'Feature X',
        acceptanceCriteria: ['match existing module tone'],
      },
    });

    expect(errors.some((e) => e.field.includes('acceptanceCriteria'))).toBe(
      true,
    );
  });
});

describe('normalizeTaskInputForCreate', () => {
  it('injects the submit-output gate for producer task types', () => {
    const normalized = normalizeTaskInputForCreate('fulfill_brief', {
      brief: 'Implement feature X',
    }) as {
      successCriteria: { version: 1; gates: Array<{ id: string }> };
    };

    expect(normalized.successCriteria.version).toBe(1);
    expect(normalized.successCriteria.gates).toEqual([
      expect.objectContaining({
        id: SUBMIT_OUTPUT_GATE_ID,
        kind: 'submit-tool-call',
        required: true,
      }),
    ]);
  });

  it('preserves existing criteria while appending the built-in gate once', () => {
    const normalized = normalizeTaskInputForCreate('run_eval', {
      scenario: { prompt: 'Do the thing.' },
      variantLabel: 'baseline',
      execution: { mode: 'vitro', workspace: 'none' },
      context: [],
      successCriteria: {
        version: 1,
        assertions: [{ id: 'has-response', path: 'response', op: 'exists' }],
        gates: [
          {
            id: SUBMIT_OUTPUT_GATE_ID,
            kind: 'submit-tool-call',
            description: 'existing gate',
            required: true,
          },
        ],
      },
    }) as {
      successCriteria: {
        assertions: Array<{ id: string }>;
        gates: Array<{ id: string; description: string }>;
      };
    };

    expect(normalized.successCriteria.assertions).toEqual([
      { id: 'has-response', path: 'response', op: 'exists' },
    ]);
    expect(normalized.successCriteria.gates).toHaveLength(1);
    expect(normalized.successCriteria.gates[0]).toMatchObject({
      id: SUBMIT_OUTPUT_GATE_ID,
      description: 'existing gate',
    });
  });

  it('leaves judgment task inputs untouched', () => {
    const input = {
      targetTaskId: '11111111-1111-4111-8111-111111111111',
      successCriteria: { version: 1 },
    };

    expect(normalizeTaskInputForCreate('assess_brief', input)).toEqual(input);
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

  describe('pr_review output validation', () => {
    const input = {
      subject: {
        title: 'PR review',
        summary: 'Inspect the change.',
      },
      successCriteria: {
        version: 1,
        rubric: {
          rubricId: 'pr-complexity-binary',
          version: 'v1',
          criteria: [
            {
              id: 'cognitive_load',
              description: 'desc',
              weight: 0.6,
              scoring: 'boolean' as const,
            },
            {
              id: 'blast_radius',
              description: 'desc',
              weight: 0.4,
              scoring: 'boolean' as const,
            },
          ],
        },
      },
    };

    it('accepts valid binary weighted output', () => {
      const errors = validateTaskOutput(
        'pr_review',
        {
          scores: [
            {
              criterionId: 'cognitive_load',
              score: 1,
              rationale: 'Focused change.',
            },
            {
              criterionId: 'blast_radius',
              score: 0,
              rationale: 'Touches shared API.',
            },
          ],
          composite: 0.6,
          verdict: 'Moderate review cost.',
        },
        input,
      );
      expect(errors).toEqual([]);
    });

    it('rejects criterion order mismatches', () => {
      const errors = validateTaskOutput(
        'pr_review',
        {
          scores: [
            {
              criterionId: 'blast_radius',
              score: 1,
              rationale: 'wrong order',
            },
            {
              criterionId: 'cognitive_load',
              score: 1,
              rationale: 'wrong order',
            },
          ],
          composite: 1,
          verdict: 'Bad ordering.',
        },
        input,
      );
      expect(errors).toEqual([
        {
          field: 'output',
          message:
            'scores[0] has criterionId "blast_radius" but rubric expects "cognitive_load" in that position',
        },
      ]);
    });

    it('rejects composite mismatches', () => {
      const errors = validateTaskOutput(
        'pr_review',
        {
          scores: [
            {
              criterionId: 'cognitive_load',
              score: 1,
              rationale: 'ok',
            },
            {
              criterionId: 'blast_radius',
              score: 1,
              rationale: 'ok',
            },
          ],
          composite: 0.5,
          verdict: 'Wrong composite.',
        },
        input,
      );
      expect(errors).toEqual([
        {
          field: 'output',
          message: 'composite 0.5 does not match weighted sum 1.000000',
        },
      ]);
    });
  });
});

describe('taskTypeUsesSubagents', () => {
  it('returns false for unknown task types', () => {
    expect(taskTypeUsesSubagents('totally_made_up')).toBe(false);
  });

  it('returns false for built-in types that did not opt in', () => {
    // None of the current built-ins use subagents.
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

  it('marks assess_brief as dedicated_worktree', () => {
    expect(taskTypeWorkspaceMode('assess_brief')).toBe('dedicated_worktree');
  });

  it('keeps non-mutating built-ins on shared_mount', () => {
    expect(taskTypeWorkspaceMode('curate_pack')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('render_pack')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('judge_pack')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('run_eval')).toBe('shared_mount');
    expect(taskTypeWorkspaceMode('pr_review')).toBe('dedicated_worktree');
  });
});

describe('taskTypeResumable', () => {
  it('defaults unknown task types to false', () => {
    expect(taskTypeResumable('totally_made_up')).toBe(false);
  });

  it('marks fulfill_brief as resumable', () => {
    expect(taskTypeResumable('fulfill_brief')).toBe(true);
  });

  it('keeps assessment/judge built-ins non-resumable but lets run_eval persist producer context', () => {
    expect(taskTypeResumable('assess_brief')).toBe(false);
    expect(taskTypeResumable('run_eval')).toBe(true);
    expect(taskTypeResumable('judge_eval_attempt')).toBe(false);
  });
});

describe('taskTypeWorkspaceScope', () => {
  it('defaults unknown task types to attempt scope', () => {
    expect(taskTypeWorkspaceScope('totally_made_up')).toBe('attempt');
  });

  it('keeps fulfill_brief worktrees session-scoped', () => {
    expect(taskTypeWorkspaceScope('fulfill_brief')).toBe('session');
  });

  it('keeps review/judge built-ins attempt-scoped while run_eval stays session-scoped', () => {
    expect(taskTypeWorkspaceScope('assess_brief')).toBe('attempt');
    expect(taskTypeWorkspaceScope('pr_review')).toBe('attempt');
    expect(taskTypeWorkspaceScope('run_eval')).toBe('session');
    expect(taskTypeWorkspaceScope('judge_eval_attempt')).toBe('attempt');
  });
});

describe('taskTypeSessionScope', () => {
  it('defaults unknown task types to none', () => {
    expect(taskTypeSessionScope('totally_made_up')).toBe('none');
  });

  it('uses correlation scope for fulfill_brief warm reuse', () => {
    expect(taskTypeSessionScope('fulfill_brief')).toBe('correlation');
  });

  it('keeps review tasks non-reusable by default', () => {
    expect(taskTypeSessionScope('assess_brief')).toBe('none');
    expect(taskTypeSessionScope('pr_review')).toBe('none');
    expect(taskTypeSessionScope('judge_pack')).toBe('none');
  });

  it('reserves custom scope for eval isolation planning', () => {
    expect(taskTypeSessionScope('run_eval')).toBe('custom');
    expect(taskTypeSessionScope('judge_eval_attempt')).toBe('none');
  });
});

describe('getTaskExecutionPolicy', () => {
  it('returns the declared fulfill_brief policy', () => {
    expect(getTaskExecutionPolicy('fulfill_brief')).toEqual({
      resumable: true,
      workspaceMode: 'dedicated_worktree',
      workspaceScope: 'session',
      sessionScope: 'correlation',
      usesSubagents: false,
    });
  });

  it('returns safe defaults for unknown task types', () => {
    expect(getTaskExecutionPolicy('totally_made_up')).toEqual({
      resumable: false,
      workspaceMode: 'shared_mount',
      workspaceScope: 'attempt',
      sessionScope: 'none',
      usesSubagents: false,
    });
  });
});
