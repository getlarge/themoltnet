import { Value } from 'typebox/value';
import { describe, expect, it, vi } from 'vitest';

import type {
  AsyncTaskValidationContext,
  TaskValidationError,
} from './async-validation.js';
import { FreeformInput } from './task-types/freeform.js';
import { BUILT_IN_TASK_TYPES, FREEFORM_TYPE } from './task-types/index.js';
import {
  getTaskExecutionPolicy,
  getTaskSubmissionSchema,
  materializeTaskOutput,
  normalizeTaskCreateRequest,
  normalizeTaskInputForCreate,
  SUBMIT_OUTPUT_GATE_ID,
  taskTypeResumable,
  taskTypeSessionScope,
  taskTypeUsesSubagents,
  taskTypeWorkspaceMode,
  taskTypeWorkspaceScope,
  validateTaskCreateRequest,
  validateTaskOutput,
  validateTaskReferences,
  validateTaskSubmission,
} from './validation.js';
import { DaemonState, TaskAttempt, TaskRef } from './wire.js';

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
        acceptanceCriteria: ['match existing module tone'],
      },
    });

    expect(errors.some((e) => e.field.includes('acceptanceCriteria'))).toBe(
      true,
    );
  });

  it('accepts freeform exploratory input with an unregistered suggested type', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'freeform',
      input: {
        brief: 'Decide whether this should become a new task type.',
        expectedOutput: 'A recommendation and a proposed task type if useful.',
        suggestedTaskType: 'taxonomy_probe',
        constraints: ['Do not create an arbitrary task type yet.'],
      },
    });

    expect(errors).toEqual([]);
  });

  it.each(['none', 'shared_mount', 'dedicated_worktree'] as const)(
    'accepts freeform input with execution.workspace=%s',
    (workspace) => {
      const errors = validateTaskCreateRequest({
        taskType: 'freeform',
        input: {
          brief: 'probe',
          execution: { workspace },
        },
      });
      expect(errors).toEqual([]);
    },
  );

  it('rejects freeform input with unknown execution.workspace value', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'freeform',
      input: {
        brief: 'probe',
        execution: { workspace: 'not_a_mode' },
      },
    });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts freeform artifacts with inline body up to 64 KiB', () => {
    const body = 'x'.repeat(65_536);
    const errors = validateTaskOutput('freeform', {
      summary: 'done',
      artifacts: [{ kind: 'markdown', title: 'report', body }],
    });
    expect(errors).toEqual([]);
  });

  it('rejects freeform artifacts with body larger than 64 KiB', () => {
    const body = 'x'.repeat(65_537);
    const errors = validateTaskOutput('freeform', {
      summary: 'done',
      artifacts: [{ kind: 'markdown', title: 'report', body }],
    });
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe('TaskRef artifact metadata', () => {
  const baseRef = {
    taskId: '11111111-1111-4111-8111-111111111111',
    outputCid: 'bafkreioutput',
    role: 'context',
  };

  it('accepts a task-output ref without outputCid at the schema level (cross-field validation covers it)', () => {
    // outputCid is now Type.Optional on TaskRef; the "required when
    // taskId is set" rule lives in validateTaskReferences, not the schema.
    expect(
      Value.Check(TaskRef, {
        taskId: '11111111-1111-4111-8111-111111111111',
        role: 'context',
      }),
    ).toBe(true);
  });

  it('accepts artifact references without attemptN (input artifacts bound at task creation)', () => {
    expect(
      Value.Check(TaskRef, {
        ...baseRef,
        taskId: null,
        artifact: {
          cid: 'bafkreiartifact',
          kind: 'report',
        },
      }),
    ).toBe(true);
  });

  it('rejects artifact references with a non-positive attemptN', () => {
    expect(
      Value.Check(TaskRef, {
        ...baseRef,
        artifact: {
          attemptN: 0,
          cid: 'bafkreiartifact',
          kind: 'report',
        },
      }),
    ).toBe(false);
  });

  it('accepts artifact references with an explicit producing attempt', () => {
    expect(
      Value.Check(TaskRef, {
        ...baseRef,
        artifact: {
          attemptN: 1,
          cid: 'bafkreiartifact',
          kind: 'report',
        },
      }),
    ).toBe(true);
  });
});

describe('validateTaskReferences', () => {
  const TASK_ID = '11111111-1111-4111-8111-111111111111';

  it('accepts a task-output ref (taskId + outputCid, no artifact)', () => {
    const errors = validateTaskReferences([
      { taskId: TASK_ID, outputCid: 'bafkreioutput', role: 'context' },
    ]);
    expect(errors).toEqual([]);
  });

  it('accepts a task-output ref whose artifact names its producing attempt', () => {
    const errors = validateTaskReferences([
      {
        taskId: TASK_ID,
        outputCid: 'bafkreioutput',
        role: 'judged_work',
        artifact: { cid: 'bafkreiartifact', attemptN: 1 },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('accepts an input artifact ref (taskId null, artifact without attemptN, no outputCid)', () => {
    const errors = validateTaskReferences([
      {
        taskId: null,
        role: 'context',
        artifact: { cid: 'bafkreiinput' },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('accepts an input artifact ref whose outputCid equals artifact.cid', () => {
    const errors = validateTaskReferences([
      {
        taskId: null,
        outputCid: 'bafkreiinput',
        role: 'context',
        artifact: { cid: 'bafkreiinput' },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('accepts an external ref (taskId null, external, no outputCid)', () => {
    const errors = validateTaskReferences([
      {
        taskId: null,
        role: 'target_source',
        external: { kind: 'http_url', url: 'https://example.com' },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('accepts an external ref that also carries an outputCid', () => {
    const errors = validateTaskReferences([
      {
        taskId: null,
        outputCid: 'bafkreisnapshot',
        role: 'target_source',
        external: { kind: 'github_pr', pr: 42 },
      },
    ]);
    expect(errors).toEqual([]);
  });

  it('rejects a task-output ref missing outputCid', () => {
    const errors = validateTaskReferences([
      { taskId: TASK_ID, role: 'context' },
    ]);
    expect(errors).toEqual([
      {
        field: 'references[0]',
        message: 'outputCid is required when referencing a task output',
      },
    ]);
  });

  it('rejects a task-output ref whose artifact omits attemptN', () => {
    const errors = validateTaskReferences([
      {
        taskId: TASK_ID,
        outputCid: 'bafkreioutput',
        role: 'context',
        artifact: { cid: 'bafkreiartifact' },
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('references[0]');
    expect(errors[0].message).toMatch(/must include attemptN/);
  });

  it('rejects an input artifact ref that includes attemptN', () => {
    const errors = validateTaskReferences([
      {
        taskId: null,
        role: 'context',
        artifact: { cid: 'bafkreiinput', attemptN: 1 },
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('references[0]');
    expect(errors[0].message).toMatch(/must not include/);
  });

  it('rejects an input artifact ref whose outputCid differs from artifact.cid', () => {
    const errors = validateTaskReferences([
      {
        taskId: null,
        outputCid: 'bafkreidifferent',
        role: 'context',
        artifact: { cid: 'bafkreiinput' },
      },
    ]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('references[0]');
    expect(errors[0].message).toMatch(/must be omitted or/);
  });

  it('rejects a taskId-null ref with neither artifact nor external', () => {
    const errors = validateTaskReferences([{ taskId: null, role: 'context' }]);
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('references[0]');
    expect(errors[0].message).toMatch(/either an artifact/);
  });

  it('reports the offending reference index in the error field', () => {
    const errors = validateTaskReferences([
      { taskId: TASK_ID, outputCid: 'bafkreioutput', role: 'context' },
      { taskId: TASK_ID, role: 'context' },
    ]);
    expect(errors).toEqual([
      {
        field: 'references[1]',
        message: 'outputCid is required when referencing a task output',
      },
    ]);
  });

  it('treats null, undefined, and empty references as valid', () => {
    expect(validateTaskReferences(null)).toEqual([]);
    expect(validateTaskReferences(undefined)).toEqual([]);
    expect(validateTaskReferences([])).toEqual([]);
  });

  it('surfaces reference errors through validateTaskCreateRequest', () => {
    const errors = validateTaskCreateRequest({
      taskType: 'freeform',
      input: { brief: 'probe' },
      references: [{ taskId: null, role: 'context' }],
    });
    expect(errors).toContainEqual({
      field: 'references[0]',
      message:
        'references with taskId null must carry either an artifact ' +
        '(input artifact) or an external descriptor',
    });
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

  it('injects the submit-output gate for freeform tasks', () => {
    const normalized = normalizeTaskInputForCreate('freeform', {
      brief: 'Explore whether this should become a task type.',
    }) as {
      successCriteria: { version: 1; gates: Array<{ id: string }> };
    };

    expect(normalized.successCriteria.gates).toEqual([
      expect.objectContaining({ id: SUBMIT_OUTPUT_GATE_ID }),
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
        expect.objectContaining({ field: 'output/pullRequestUrl' }),
        expect.objectContaining({ field: 'output/diaryEntryIds' }),
      ]),
    );
  });

  it('accepts freeform output with a proposed task type', () => {
    const errors = validateTaskOutput(
      'freeform',
      {
        summary: 'This pattern is recurring enough to consider typing.',
        proposedTaskType: {
          name: 'taxonomy_probe',
          rationale: 'The same brief shape has appeared repeatedly.',
          inputShape: { brief: 'string' },
          outputShape: { recommendation: 'string' },
        },
        verification: {
          inputCid: 'bafy-input',
          results: [
            {
              id: 'submit-output',
              kind: 'gate',
              status: 'pass',
            },
          ],
          passed: true,
        },
      },
      {
        brief: 'Explore a task shape.',
        successCriteria: { version: 1 },
      },
    );

    expect(errors).toEqual([]);
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
    expect(taskTypeUsesSubagents('freeform')).toBe(false);
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
    expect(taskTypeWorkspaceMode('freeform')).toBe('shared_mount');
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

  it('keeps assessment/judge built-ins non-resumable while freeform and run_eval persist producer context', () => {
    expect(taskTypeResumable('assess_brief')).toBe(false);
    expect(taskTypeResumable('freeform')).toBe(true);
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

  it('keeps review/judge built-ins attempt-scoped while freeform and run_eval are session-scoped', () => {
    expect(taskTypeWorkspaceScope('assess_brief')).toBe('attempt');
    expect(taskTypeWorkspaceScope('freeform')).toBe('session');
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

  it('keeps review tasks non-reusable by default while freeform uses correlation scope', () => {
    expect(taskTypeSessionScope('assess_brief')).toBe('none');
    expect(taskTypeSessionScope('freeform')).toBe('correlation');
    expect(taskTypeSessionScope('pr_review')).toBe('none');
    expect(taskTypeSessionScope('judge_pack')).toBe('none');
  });

  it('reserves custom scope for eval isolation planning', () => {
    expect(taskTypeSessionScope('run_eval')).toBe('custom');
    expect(taskTypeSessionScope('judge_eval_attempt')).toBe('none');
  });
});

describe('agent submission and runtime materialization', () => {
  const runEvalInput = {
    scenario: { prompt: 'Respond concisely.' },
    variantLabel: 'baseline',
    execution: { mode: 'vitro' as const, workspace: 'none' as const },
    context: [],
    successCriteria: { version: 1 as const },
  };
  const submission = {
    response: 'done',
    verification: {
      inputCid: 'bafy-input',
      results: [],
      passed: true,
    },
  };

  it('advertises a submission schema for every built-in task type', () => {
    for (const taskType of Object.keys(BUILT_IN_TASK_TYPES)) {
      expect(getTaskSubmissionSchema(taskType)).not.toBeNull();
    }
  });

  it('requires verification wherever a producer schema accepts it with success criteria', () => {
    let producerTypesWithVerification = 0;
    const entries = Object.values(BUILT_IN_TASK_TYPES) as Array<{
      inputSchema: { properties?: Record<string, unknown> };
      submissionSchema?: { properties?: Record<string, unknown> };
      validateOutput?: unknown;
    }>;
    for (const entry of entries) {
      const inputProperties = entry.inputSchema.properties;
      const submissionProperties = entry.submissionSchema?.properties;
      if (
        inputProperties?.successCriteria !== undefined &&
        submissionProperties?.verification !== undefined
      ) {
        producerTypesWithVerification++;
        expect(entry.validateOutput).toBeTypeOf('function');
      }
    }
    expect(producerTypesWithVerification).toBeGreaterThan(0);
  });

  it('rejects a run_eval submission that tries to supply executor telemetry', () => {
    expect(
      validateTaskSubmission(
        'run_eval',
        { ...submission, totalTokens: 999, durationMs: 1 },
        runEvalInput,
        { inputCid: 'bafy-input' },
      ),
    ).not.toEqual([]);
  });

  it('requires a verification to cite the exact task input CID', () => {
    expect(
      validateTaskSubmission('run_eval', submission, runEvalInput, {
        inputCid: 'another-input-cid',
      }),
    ).toEqual([
      {
        field: 'output/verification/inputCid',
        message: 'must match the task input CID',
      },
    ]);
  });

  it('rejects a durable output whose verification cites another task input CID', () => {
    const output = materializeTaskOutput('run_eval', submission, {
      usage: { inputTokens: 12, outputTokens: 30 },
      durationMs: 456,
    });

    expect(
      validateTaskOutput('run_eval', output, runEvalInput, {
        inputCid: 'another-input-cid',
      }),
    ).toEqual([
      {
        field: 'output/verification/inputCid',
        message: 'must match the task input CID',
      },
    ]);
  });

  it('stamps durable run_eval telemetry from runtime facts rather than the submission', () => {
    const output = materializeTaskOutput(
      'run_eval',
      {
        ...submission,
        totalTokens: 999_999,
        durationMs: 1,
        traceparent: 'agent-supplied',
      },
      {
        usage: { inputTokens: 12, outputTokens: 30 },
        durationMs: 456,
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      },
    );

    expect(output).toMatchObject({
      ...submission,
      totalTokens: 42,
      durationMs: 456,
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
    });
    expect(
      validateTaskOutput('run_eval', output, runEvalInput, {
        inputCid: 'bafy-input',
      }),
    ).toEqual([]);
  });

  it('allows durable eval output without a traceparent', () => {
    const output = materializeTaskOutput('run_eval', submission, {
      usage: { inputTokens: 12, outputTokens: 30 },
      durationMs: 456,
      traceparent: '   ',
    });

    expect(output).not.toHaveProperty('traceparent');
    expect(validateTaskOutput('run_eval', output, runEvalInput)).toEqual([]);
  });
});

describe('getTaskExecutionPolicy', () => {
  it('returns the declared fulfill_brief policy', () => {
    expect(getTaskExecutionPolicy('fulfill_brief')).toEqual({
      resumable: true,
      workspaceMode: 'dedicated_worktree',
      workspaceScope: 'session',
      sessionScope: 'correlation',
      acceptsInputWorkspaceOverride: false,
      usesSubagents: false,
    });
  });

  it('returns safe defaults for unknown task types', () => {
    expect(getTaskExecutionPolicy('totally_made_up')).toEqual({
      resumable: false,
      workspaceMode: 'shared_mount',
      workspaceScope: 'attempt',
      sessionScope: 'none',
      acceptsInputWorkspaceOverride: false,
      usesSubagents: false,
    });
  });

  it('surfaces acceptsInputWorkspaceOverride for opt-in task types', () => {
    expect(
      getTaskExecutionPolicy('freeform').acceptsInputWorkspaceOverride,
    ).toBe(true);
    expect(
      getTaskExecutionPolicy('run_eval').acceptsInputWorkspaceOverride,
    ).toBe(true);
    expect(
      getTaskExecutionPolicy('fulfill_brief').acceptsInputWorkspaceOverride,
    ).toBe(false);
  });
});

describe('DaemonState', () => {
  it('accepts a reportedAt timestamp and a non-null slotResumableUntil', () => {
    expect(
      Value.Check(DaemonState, {
        reportedAt: '2026-06-04T12:00:00.000Z',
        slotResumableUntil: '2026-06-04T12:30:00.000Z',
      }),
    ).toBe(true);
  });

  it('accepts slotResumableUntil = null (not eligible)', () => {
    expect(
      Value.Check(DaemonState, {
        reportedAt: '2026-06-04T12:00:00.000Z',
        slotResumableUntil: null,
      }),
    ).toBe(true);
  });

  it('rejects unknown fields (additionalProperties false)', () => {
    expect(
      Value.Check(DaemonState, {
        reportedAt: '2026-06-04T12:00:00.000Z',
        slotResumableUntil: null,
        somethingExtra: 'x',
      }),
    ).toBe(false);
  });

  it('rejects when reportedAt is missing', () => {
    expect(
      Value.Check(DaemonState, {
        slotResumableUntil: null,
      }),
    ).toBe(false);
  });
});

describe('TaskAttempt.daemonState', () => {
  // Minimal valid TaskAttempt row. All fields required; daemonState is the
  // field under test.
  function makeAttempt(daemonState: unknown): unknown {
    return {
      taskId: '11111111-1111-4111-8111-111111111111',
      attemptN: 1,
      claimedByAgentId: '22222222-2222-4222-8222-222222222222',
      runtimeId: null,
      claimedAt: '2026-06-04T12:00:00.000Z',
      startedAt: null,
      completedAt: null,
      status: 'claimed',
      output: null,
      outputCid: null,
      claimedExecutorFingerprint: null,
      claimedExecutorManifest: null,
      completedExecutorFingerprint: null,
      completedExecutorManifest: null,
      error: null,
      usage: null,
      contentSignature: null,
      signedAt: null,
      daemonState,
    };
  }

  it('accepts a populated daemonState block', () => {
    expect(
      Value.Check(
        TaskAttempt,
        makeAttempt({
          reportedAt: '2026-06-04T12:00:00.000Z',
          slotResumableUntil: '2026-06-04T12:30:00.000Z',
        }),
      ),
    ).toBe(true);
  });

  it('accepts daemonState = null for older completions', () => {
    expect(Value.Check(TaskAttempt, makeAttempt(null))).toBe(true);
  });

  it('rejects malformed daemonState payload', () => {
    expect(
      Value.Check(
        TaskAttempt,
        makeAttempt({
          reportedAt: 'not-a-date',
          slotResumableUntil: null,
        }),
      ),
    ).toBe(false);
  });
});

describe('normalizeTaskCreateRequest correlationId default', () => {
  it('generates a fresh UUID when caller omits correlationId', () => {
    const result = normalizeTaskCreateRequest({
      taskType: 'freeform',
      teamId: '11111111-1111-4111-8111-111111111111',
      diaryId: '22222222-2222-4222-8222-222222222222',
      input: { brief: 'probe' },
    });
    expect(result.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });

  it('preserves caller-supplied correlationId', () => {
    const callerCid = '33333333-3333-4333-8333-333333333333';
    const result = normalizeTaskCreateRequest({
      taskType: 'freeform',
      teamId: '11111111-1111-4111-8111-111111111111',
      diaryId: '22222222-2222-4222-8222-222222222222',
      correlationId: callerCid,
      input: { brief: 'probe' },
    });
    expect(result.correlationId).toBe(callerCid);
  });
});

describe('FreeformInput.continueFrom', () => {
  it('accepts a continueFrom pointer with default mode', () => {
    const ok = Value.Check(FreeformInput, {
      brief: 'next step',
      continueFrom: {
        taskId: '11111111-1111-4111-8111-111111111111',
        attemptN: 1,
      },
    });
    expect(ok).toBe(true);
  });

  it.each(['extend', 'fork'] as const)(
    'accepts mode=%s on continueFrom',
    (mode) => {
      const ok = Value.Check(FreeformInput, {
        brief: 'next step',
        continueFrom: {
          taskId: '11111111-1111-4111-8111-111111111111',
          attemptN: 1,
          mode,
        },
      });
      expect(ok).toBe(true);
    },
  );

  it('rejects mode outside the union', () => {
    const ok = Value.Check(FreeformInput, {
      brief: 'next step',
      continueFrom: {
        taskId: '11111111-1111-4111-8111-111111111111',
        attemptN: 1,
        mode: 'merge',
      },
    });
    expect(ok).toBe(false);
  });

  it('rejects attemptN < 1', () => {
    const ok = Value.Check(FreeformInput, {
      brief: 'x',
      continueFrom: {
        taskId: '11111111-1111-4111-8111-111111111111',
        attemptN: 0,
      },
    });
    expect(ok).toBe(false);
  });
});

describe('freeform validateInputAsync — continuation', () => {
  const validator = BUILT_IN_TASK_TYPES[FREEFORM_TYPE].validateInputAsync as (
    input: unknown,
    ctx: AsyncTaskValidationContext,
  ) => Promise<TaskValidationError[]>;

  const SOURCE_TASK_ID = '11111111-1111-4111-8111-111111111111';

  const makeCtx = (
    overrides: Partial<AsyncTaskValidationContext> = {},
  ): AsyncTaskValidationContext => ({
    resolveTask: vi.fn().mockResolvedValue(null),
    listAttempts: vi.fn().mockResolvedValue([]),
    listTasksByCorrelation: vi.fn().mockResolvedValue([]),
    findCorrelationSeal: vi.fn().mockResolvedValue(null),
    resolveContextPack: vi.fn().mockResolvedValue(null),
    resolveRenderedPack: vi.fn().mockResolvedValue(null),
    ...overrides,
  });

  it('passes when continueFrom is absent', async () => {
    const errors = await validator({ brief: 'standalone' }, makeCtx());
    expect(errors).toEqual([]);
  });

  it('rejects when source task does not exist', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({ resolveTask: vi.fn().mockResolvedValue(null) }),
    );
    expect(errors[0]?.code).toBe('freeform.sourceTaskNotFound');
  });

  it('rejects when source task is not freeform', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'fulfill_brief' }),
        listAttempts: vi.fn().mockResolvedValue([]),
      }),
    );
    expect(errors[0]?.code).toBe('freeform.sourceTaskTypeNotSupported');
  });

  it('rejects when source attempt is not completed', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts: vi
          .fn()
          .mockResolvedValue([
            { attemptN: 1, status: 'running', daemonState: null },
          ]),
      }),
    );
    expect(errors[0]?.code).toBe('freeform.sourceAttemptNotCompleted');
  });

  it('accepts mode=fork on an eligible source (implemented in #1293)', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: {
          taskId: SOURCE_TASK_ID,
          attemptN: 1,
          mode: 'fork',
        },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts: vi.fn().mockResolvedValue([
          {
            attemptN: 1,
            status: 'completed',
            daemonState: {
              reportedAt: new Date().toISOString(),
              slotResumableUntil: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        ]),
      }),
    );
    expect(errors).toHaveLength(0);
  });

  it('accepts execution.workspace when continueFrom is absent', async () => {
    // Inverse of the executionWorkspaceNotInheritable check: the
    // workspace override is fine on standalone freeform tasks, only
    // continuations have to drop it. Guards against a regression that
    // would over-broaden the new check.
    const errors = await validator(
      {
        brief: 'standalone freeform with workspace override',
        execution: { workspace: 'dedicated_worktree' },
      },
      makeCtx({}),
    );
    expect(errors).toEqual([]);
  });

  it('rejects execution.workspace when continueFrom is set', async () => {
    // Workspace mode for a continuation is inherited from the parent
    // slot at the daemon plan stage; a caller-supplied override would
    // be silently dropped. Reject explicitly at create time.
    const errors = await validator(
      {
        brief: 'x',
        execution: { workspace: 'dedicated_worktree' },
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts: vi.fn().mockResolvedValue([
          {
            attemptN: 1,
            status: 'completed',
            daemonState: {
              reportedAt: new Date().toISOString(),
              slotResumableUntil: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        ]),
      }),
    );
    expect(errors[0]?.code).toBe('freeform.executionWorkspaceNotInheritable');
  });

  it('still rejects execution.workspace when deferReadinessChecks is true', async () => {
    // Stable check: misconfiguration surfaces at create time regardless
    // of deferral.
    const errors = await validator(
      {
        brief: 'x',
        execution: { workspace: 'dedicated_worktree' },
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        deferReadinessChecks: true,
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
      }),
    );
    expect(errors[0]?.code).toBe('freeform.executionWorkspaceNotInheritable');
  });

  it('passes when daemonState is null', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts: vi
          .fn()
          .mockResolvedValue([
            { attemptN: 1, status: 'completed', daemonState: null },
          ]),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('passes when slotResumableUntil is past now', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts: vi.fn().mockResolvedValue([
          {
            attemptN: 1,
            status: 'completed',
            daemonState: {
              reportedAt: '2026-06-04T10:00:00.000Z',
              slotResumableUntil: '2026-06-04T10:30:00.000Z',
            },
          },
        ]),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('passes when daemonState has a future slot hint', async () => {
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts: vi.fn().mockResolvedValue([
          {
            attemptN: 1,
            status: 'completed',
            daemonState: {
              reportedAt: new Date().toISOString(),
              slotResumableUntil: new Date(Date.now() + 60_000).toISOString(),
            },
          },
        ]),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('skips readiness checks when deferReadinessChecks is true', async () => {
    // Continuation proposed via tasks_continue auto-injects a
    // `task_status: completed` claim condition, which causes task-service
    // to set deferReadinessChecks. The parent attempt is still running
    // — readiness checks must defer to claim time, but stable checks
    // (source exists, source is freeform) still fire.
    const listAttempts = vi.fn();
    const errors = await validator(
      {
        brief: 'continue while parent still running',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        deferReadinessChecks: true,
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
        listAttempts,
      }),
    );
    expect(errors).toEqual([]);
    // Should also avoid the listAttempts roundtrip when deferring.
    expect(listAttempts).not.toHaveBeenCalled();
  });

  it('accepts mode=fork when deferReadinessChecks is true', async () => {
    // Fork is implemented (#1293); it passes the stable-check gate and the
    // readiness check defers to claim time just like a default continuation.
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1, mode: 'fork' },
      },
      makeCtx({
        deferReadinessChecks: true,
        resolveTask: vi.fn().mockResolvedValue({ taskType: 'freeform' }),
      }),
    );
    expect(errors).toEqual([]);
  });

  it('still rejects unknown source when deferReadinessChecks is true', async () => {
    // Stable check: source-exists fires regardless of deferral.
    const errors = await validator(
      {
        brief: 'x',
        continueFrom: { taskId: SOURCE_TASK_ID, attemptN: 1 },
      },
      makeCtx({
        deferReadinessChecks: true,
        resolveTask: vi.fn().mockResolvedValue(null),
      }),
    );
    expect(errors[0]?.code).toBe('freeform.sourceTaskNotFound');
  });
});
