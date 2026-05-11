import { FormatRegistry } from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { describe, expect, it } from 'vitest';

// Register 'uuid' format so Value.Check accepts UUID strings against
// schemas that use `Type.String({ format: 'uuid' })`. TypeBox does not
// ship built-in format validators; the project's runtime registers
// formats through a fastify plugin which isn't loaded in unit tests.
if (!FormatRegistry.Has('uuid')) {
  FormatRegistry.Set('uuid', (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v),
  );
}

import type {
  AsyncTaskValidationContext,
  CorrelationSeal,
  ResolvedContextPack,
  ResolvedRenderedPack,
} from '../async-validation.js';
import type { Task } from '../wire.js';
import {
  JUDGE_EVAL_VARIANT_TYPE,
  JudgeEvalVariantInput,
  JudgeEvalVariantOutput,
  onCreateJudgeEvalVariant,
  validateJudgeEvalVariantInput,
  validateJudgeEvalVariantInputAsync,
  validateJudgeEvalVariantOutput,
} from './judge-eval-variant.js';

const TASK_A = '11111111-1111-1111-1111-111111111111';
const TASK_B = '22222222-2222-2222-2222-222222222222';
const TASK_C = '33333333-3333-3333-3333-333333333333';
const CORRELATION = '99999999-9999-9999-9999-999999999999';
const CORRELATION_OTHER = '88888888-8888-8888-8888-888888888888';

function rubric() {
  return {
    version: 1 as const,
    rubric: {
      version: 'v1' as const,
      rubricId: 'r1',
      criteria: [
        {
          id: 'c1',
          description: 'first',
          weight: 0.6,
          scoring: 'llm_score' as const,
        },
        {
          id: 'c2',
          description: 'second',
          weight: 0.4,
          scoring: 'llm_score' as const,
        },
      ],
    },
  };
}

function variantInput(overrides: Record<string, unknown> = {}) {
  return {
    scenario: { prompt: 'p' },
    variantLabel: 'baseline',
    context: [],
    successCriteria: rubric(),
    ...overrides,
  };
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_A,
    taskType: 'run_eval',
    teamId: '00000000-0000-0000-0000-000000000001',
    diaryId: null,
    outputKind: 'artifact',
    input: variantInput() as unknown as Record<string, unknown>,
    inputSchemaCid: 'bafy-schema',
    inputCid: 'bafy-input',
    references: [],
    correlationId: CORRELATION,
    imposedByAgentId: null,
    imposedByHumanId: null,
    acceptedAttemptN: 1,
    requiredExecutorTrustLevel: 'untrusted',
    allowedExecutors: [],
    status: 'completed',
    queuedAt: '2026-05-11T00:00:00Z',
    completedAt: '2026-05-11T00:01:00Z',
    expiresAt: null,
    cancelledByAgentId: null,
    cancelledByHumanId: null,
    cancelReason: null,
    maxAttempts: 1,
    dispatchTimeoutSec: null,
    runningTimeoutSec: null,
    ...overrides,
  } as Task;
}

interface CtxOverrides {
  tasks?: Record<string, Task | null>;
  seal?: CorrelationSeal | null;
}

function makeCtx(o: CtxOverrides = {}): AsyncTaskValidationContext {
  // Stub ctx — methods must be async to satisfy the interface.
  /* eslint-disable @typescript-eslint/require-await */
  return {
    async resolveTask(id) {
      return o.tasks?.[id] ?? null;
    },
    async listTasksByCorrelation(_cid) {
      return [];
    },
    async findCorrelationSeal(_cid) {
      return o.seal ?? null;
    },
    async resolveContextPack(_id): Promise<ResolvedContextPack | null> {
      return null;
    },
    async resolveRenderedPack(_id): Promise<ResolvedRenderedPack | null> {
      return null;
    },
  };
  /* eslint-enable @typescript-eslint/require-await */
}

describe('JUDGE_EVAL_VARIANT_TYPE', () => {
  it('is the canonical name', () => {
    expect(JUDGE_EVAL_VARIANT_TYPE).toBe('judge_eval_variant');
  });
});

describe('JudgeEvalVariantInput schema', () => {
  it('accepts minimum 2 runTaskIds + rubric', () => {
    expect(
      Value.Check(JudgeEvalVariantInput, {
        runTaskIds: [TASK_A, TASK_B],
        successCriteria: rubric(),
      }),
    ).toBe(true);
  });

  it('rejects a single runTaskId (minItems: 2)', () => {
    expect(
      Value.Check(JudgeEvalVariantInput, {
        runTaskIds: [TASK_A],
        successCriteria: rubric(),
      }),
    ).toBe(false);
  });

  it('rejects 11 runTaskIds (maxItems: 10)', () => {
    const ids = Array.from(
      { length: 11 },
      (_, i) => `${i.toString().padStart(8, '0')}-0000-0000-0000-000000000000`,
    );
    expect(
      Value.Check(JudgeEvalVariantInput, {
        runTaskIds: ids,
        successCriteria: rubric(),
      }),
    ).toBe(false);
  });
});

describe('validateJudgeEvalVariantInput (sync)', () => {
  it('returns null when rubric weights sum to 1', () => {
    expect(
      validateJudgeEvalVariantInput({
        runTaskIds: [TASK_A, TASK_B],
        successCriteria: rubric(),
      }),
    ).toBeNull();
  });

  it('rejects rubric weights that do not sum to 1', () => {
    const bad = rubric();
    bad.rubric.criteria[0].weight = 0.7;
    expect(
      validateJudgeEvalVariantInput({
        runTaskIds: [TASK_A, TASK_B],
        successCriteria: bad,
      }),
    ).toMatch(/weight/i);
  });
});

describe('validateJudgeEvalVariantInputAsync', () => {
  it('passes when all targets resolve, share correlation, identical successCriteria, no seal', async () => {
    const ctx = makeCtx({
      tasks: { [TASK_A]: makeTask(), [TASK_B]: makeTask({ id: TASK_B }) },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors).toEqual([]);
  });

  it('rejects when a target does not resolve', async () => {
    const ctx = makeCtx({
      tasks: { [TASK_A]: makeTask(), [TASK_B]: null },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors).toHaveLength(1);
    expect(errors[0].field).toBe('runTaskIds[1]');
    expect(errors[0].message).toMatch(/does not resolve/);
  });

  it('rejects when a target is the wrong task type', async () => {
    const ctx = makeCtx({
      tasks: {
        [TASK_A]: makeTask(),
        [TASK_B]: makeTask({ id: TASK_B, taskType: 'fulfill_brief' }),
      },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors.some((e) => /not a run_eval/.test(e.message))).toBe(true);
  });

  it('rejects when a target is not completed with an accepted attempt', async () => {
    const ctx = makeCtx({
      tasks: {
        [TASK_A]: makeTask(),
        [TASK_B]: makeTask({
          id: TASK_B,
          status: 'running',
          acceptedAttemptN: null,
        }),
      },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors.some((e) => /accepted attempt/.test(e.message))).toBe(true);
  });

  it('rejects when targets span multiple correlation_ids', async () => {
    const ctx = makeCtx({
      tasks: {
        [TASK_A]: makeTask(),
        [TASK_B]: makeTask({
          id: TASK_B,
          correlationId: CORRELATION_OTHER,
        }),
      },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors.some((e) => /multiple correlation_ids/.test(e.message))).toBe(
      true,
    );
  });

  it('rejects when any target has a null correlation_id', async () => {
    const ctx = makeCtx({
      tasks: {
        [TASK_A]: makeTask(),
        [TASK_B]: makeTask({ id: TASK_B, correlationId: null }),
      },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors.some((e) => /no correlation_id/.test(e.message))).toBe(true);
  });

  it('rejects when the correlation_id is already sealed', async () => {
    const ctx = makeCtx({
      tasks: { [TASK_A]: makeTask(), [TASK_B]: makeTask({ id: TASK_B }) },
      seal: {
        correlationId: CORRELATION,
        sealedAt: '2026-05-10T00:00:00Z',
        sealedByTaskId: TASK_C,
        sealedByTaskType: 'judge_eval_variant',
      },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(errors.some((e) => /already sealed/.test(e.message))).toBe(true);
  });

  it('rejects when variants have non-identical successCriteria', async () => {
    const taskBInput = variantInput();
    // Reorder the criteria — semantic-different rubric.
    taskBInput.successCriteria.rubric.criteria.reverse();
    const ctx = makeCtx({
      tasks: {
        [TASK_A]: makeTask(),
        [TASK_B]: makeTask({
          id: TASK_B,
          input: taskBInput as unknown as Record<string, unknown>,
        }),
      },
    });
    const errors = await validateJudgeEvalVariantInputAsync(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(
      errors.some((e) => /different input.successCriteria/.test(e.message)),
    ).toBe(true);
  });
});

describe('onCreateJudgeEvalVariant', () => {
  it('returns a sealCorrelation effect for the shared correlation_id', async () => {
    const ctx = makeCtx({
      tasks: { [TASK_A]: makeTask() },
    });
    const effects = await onCreateJudgeEvalVariant(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(effects).toEqual([
      { kind: 'sealCorrelation', correlationId: CORRELATION },
    ]);
  });

  it('emits no effects when the first target cannot be resolved (defensive)', async () => {
    const ctx = makeCtx({ tasks: { [TASK_A]: null } });
    const effects = await onCreateJudgeEvalVariant(
      { runTaskIds: [TASK_A, TASK_B], successCriteria: rubric() },
      ctx,
    );
    expect(effects).toEqual([]);
  });
});

describe('validateJudgeEvalVariantOutput', () => {
  function result(runTaskId: string, label: string, composite = 0.7) {
    return {
      runTaskId,
      variantLabel: label,
      scores: [
        { criterionId: 'c1', score: 0.5, rationale: 'ok' },
        { criterionId: 'c2', score: 1.0, rationale: 'great' },
      ],
      // 0.6*0.5 + 0.4*1.0 = 0.7
      composite,
      verdict: 'fine',
    };
  }

  const input = {
    runTaskIds: [TASK_A, TASK_B],
    successCriteria: rubric(),
  };

  it('accepts a well-formed output', () => {
    const out = {
      results: [result(TASK_A, 'a'), result(TASK_B, 'b')],
      traceparent: '00-x-y-01',
    };
    expect(Value.Check(JudgeEvalVariantOutput, out)).toBe(true);
    expect(validateJudgeEvalVariantOutput(out, input)).toBeNull();
  });

  it('rejects when results.length != runTaskIds.length', () => {
    const out = {
      results: [result(TASK_A, 'a')],
      traceparent: '00-x-y-01',
    };
    expect(validateJudgeEvalVariantOutput(out, input)).toMatch(
      /partial grading/,
    );
  });

  it('rejects when result order does not match runTaskIds order', () => {
    const out = {
      results: [result(TASK_B, 'b'), result(TASK_A, 'a')],
      traceparent: '00-x-y-01',
    };
    expect(validateJudgeEvalVariantOutput(out, input)).toMatch(
      /Order must align/,
    );
  });

  it('rejects composite drift greater than 0.001', () => {
    const bad = result(TASK_A, 'a', 0.5); // expected 0.7
    const out = {
      results: [bad, result(TASK_B, 'b')],
      traceparent: '00-x-y-01',
    };
    expect(validateJudgeEvalVariantOutput(out, input)).toMatch(/composite/);
  });

  it('rejects deltas keys with bad shape', () => {
    const out = {
      results: [result(TASK_A, 'a'), result(TASK_B, 'b')],
      deltas: { a_minus_b: 0.1 },
      traceparent: '00-x-y-01',
    };
    expect(validateJudgeEvalVariantOutput(out, input)).toMatch(
      /not of the form/,
    );
  });

  it('rejects deltas values outside [-1, 1] (#1101 m2)', () => {
    expect(
      Value.Check(JudgeEvalVariantOutput, {
        results: [result(TASK_A, 'a'), result(TASK_B, 'b')],
        deltas: { 'a - b': 1.5 },
        traceparent: '00-x-y-01',
      }),
    ).toBe(false);
  });

  it('rejects scores with a criterionId not in the input rubric (#1101 m3)', () => {
    const out = {
      results: [
        {
          ...result(TASK_A, 'a'),
          // Add an extra score with a fabricated criterionId; rubric
          // weights still sum to 1, but the extra id should be
          // rejected rather than silently ignored.
          scores: [
            { criterionId: 'c1', score: 0.5, rationale: 'ok' },
            { criterionId: 'c2', score: 1.0, rationale: 'great' },
            { criterionId: 'fabricated', score: 1.0, rationale: 'fake' },
          ],
        },
        result(TASK_B, 'b'),
      ],
      traceparent: '00-x-y-01',
    };
    expect(validateJudgeEvalVariantOutput(out, input)).toMatch(
      /not in the input rubric/,
    );
  });

  it('rejects a variantLabel containing " - " (delimiter collision)', () => {
    expect(
      Value.Check(JudgeEvalVariantOutput, {
        results: [
          { ...result(TASK_A, 'a'), variantLabel: 'v1 - new' },
          result(TASK_B, 'b'),
        ],
        traceparent: '00-x-y-01',
      }),
    ).toBe(false);
  });

  it('rejects deltas keys referencing unknown labels', () => {
    const out = {
      results: [result(TASK_A, 'a'), result(TASK_B, 'b')],
      deltas: { 'a - c': 0.1 },
      traceparent: '00-x-y-01',
    };
    expect(validateJudgeEvalVariantOutput(out, input)).toMatch(
      /not present in results/,
    );
  });
});
