import * as Format from 'typebox/format';
import { Value } from 'typebox/value';
import { describe, expect, it } from 'vitest';

if (!Format.Has('uuid')) {
  Format.Set('uuid', (v: string) =>
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
  JUDGE_EVAL_ATTEMPT_TYPE,
  JudgeEvalAttemptInput,
  JudgeEvalAttemptOutput,
  validateJudgeEvalAttemptInput,
  validateJudgeEvalAttemptInputAsync,
  validateJudgeEvalAttemptOutput,
} from './judge-eval-attempt.js';

const TARGET_TASK = '11111111-1111-1111-1111-111111111111';
const OTHER_JUDGE = '22222222-2222-2222-2222-222222222222';
const CORRELATION = '99999999-9999-9999-9999-999999999999';

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

function targetTask(overrides: Partial<Task> = {}): Task {
  return {
    id: TARGET_TASK,
    taskType: 'run_eval',
    teamId: '00000000-0000-0000-0000-000000000001',
    diaryId: null,
    outputKind: 'artifact',
    input: {
      scenario: { prompt: 'p' },
      variantLabel: 'baseline',
      execution: { mode: 'vitro', workspace: 'none' },
      context: [],
      successCriteria: { version: 1 },
    },
    inputSchemaCid: 'bafy-schema',
    inputCid: 'bafy-input',
    references: [],
    correlationId: CORRELATION,
    proposedByAgentId: null,
    proposedByHumanId: null,
    acceptedAttemptN: 1,
    requiredExecutorTrustLevel: 'untrusted',
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
  target?: Task | null;
  siblings?: Task[];
  seal?: CorrelationSeal | null;
  currentTaskId?: string;
}

function makeCtx(o: CtxOverrides = {}): AsyncTaskValidationContext {
  return {
    currentTaskId: o.currentTaskId,
    async resolveTask(id) {
      return id === TARGET_TASK ? (o.target ?? targetTask()) : null;
    },
    async listAttempts(_id) {
      return [];
    },
    async listTasksByCorrelation(_cid) {
      return o.siblings ?? [];
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
}

describe('JUDGE_EVAL_ATTEMPT_TYPE', () => {
  it('is the canonical name', () => {
    expect(JUDGE_EVAL_ATTEMPT_TYPE).toBe('judge_eval_attempt');
  });
});

describe('JudgeEvalAttemptInput schema', () => {
  it('accepts a target task, attempt, and rubric', () => {
    expect(
      Value.Check(JudgeEvalAttemptInput, {
        targetTaskId: TARGET_TASK,
        targetAttemptN: 1,
        successCriteria: rubric(),
      }),
    ).toBe(true);
  });
});

describe('validateJudgeEvalAttemptInput', () => {
  it('returns null when rubric weights sum to 1', () => {
    expect(
      validateJudgeEvalAttemptInput({
        targetTaskId: TARGET_TASK,
        targetAttemptN: 1,
        successCriteria: rubric(),
      }),
    ).toBeNull();
  });
});

describe('validateJudgeEvalAttemptInputAsync', () => {
  it('passes when target resolves and no duplicate exists', async () => {
    const errors = await validateJudgeEvalAttemptInputAsync(
      {
        targetTaskId: TARGET_TASK,
        targetAttemptN: 1,
        successCriteria: rubric(),
      },
      makeCtx({ siblings: [targetTask()] }),
    );
    expect(errors).toEqual([]);
  });

  it('rejects when target attempt does not match accepted attempt', async () => {
    const errors = await validateJudgeEvalAttemptInputAsync(
      {
        targetTaskId: TARGET_TASK,
        targetAttemptN: 2,
        successCriteria: rubric(),
      },
      makeCtx(),
    );
    expect(errors.some((e) => /acceptedAttemptN=1/.test(e.message))).toBe(true);
  });

  it('rejects duplicate judges for the same target attempt and rubric identity', async () => {
    const errors = await validateJudgeEvalAttemptInputAsync(
      {
        targetTaskId: TARGET_TASK,
        targetAttemptN: 1,
        successCriteria: rubric(),
      },
      makeCtx({
        siblings: [
          targetTask(),
          {
            ...targetTask({
              id: OTHER_JUDGE,
              taskType: 'judge_eval_attempt',
              outputKind: 'judgment',
              status: 'queued',
            }),
            input: {
              targetTaskId: TARGET_TASK,
              targetAttemptN: 1,
              successCriteria: rubric(),
            },
          },
        ],
      }),
    );
    expect(errors.some((e) => /already exists/.test(e.message))).toBe(true);
  });

  it('does not treat the task being revalidated as its own duplicate', async () => {
    const errors = await validateJudgeEvalAttemptInputAsync(
      {
        targetTaskId: TARGET_TASK,
        targetAttemptN: 1,
        successCriteria: rubric(),
      },
      makeCtx({
        currentTaskId: OTHER_JUDGE,
        siblings: [
          targetTask(),
          {
            ...targetTask({
              id: OTHER_JUDGE,
              taskType: 'judge_eval_attempt',
              outputKind: 'judgment',
              status: 'waiting',
            }),
            input: {
              targetTaskId: TARGET_TASK,
              targetAttemptN: 1,
              successCriteria: rubric(),
            },
          },
        ],
      }),
    );
    expect(errors).toEqual([]);
  });
});

describe('validateJudgeEvalAttemptOutput', () => {
  const input: JudgeEvalAttemptInput = {
    targetTaskId: TARGET_TASK,
    targetAttemptN: 1,
    successCriteria: rubric(),
  };

  const out: JudgeEvalAttemptOutput = {
    targetTaskId: TARGET_TASK,
    targetAttemptN: 1,
    variantLabel: 'baseline',
    scores: [
      { criterionId: 'c1', score: 1, rationale: 'ok' },
      { criterionId: 'c2', score: 0.5, rationale: 'partial' },
    ],
    composite: 0.8,
    verdict: 'good enough',
    traceparent: '00-aaaa-bbbb-01',
  };

  it('accepts a valid output', () => {
    expect(Value.Check(JudgeEvalAttemptOutput, out)).toBe(true);
    expect(validateJudgeEvalAttemptOutput(out, input)).toBeNull();
  });

  it('rejects mismatched targetTaskId', () => {
    expect(
      validateJudgeEvalAttemptOutput(
        { ...out, targetTaskId: OTHER_JUDGE },
        input,
      ),
    ).toMatch(/targetTaskId/);
  });
});
