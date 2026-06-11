/**
 * `judge_eval_attempt` — score one completed `run_eval` attempt against a
 * hidden judge rubric.
 *
 * output_kind: judgment
 * criteria: required (`successCriteria.rubric`)
 * references: not required at the input layer — `targetTaskId` +
 *   `targetAttemptN` pin the producer attempt being judged.
 *
 * This replaces the earlier parent/subagent `judge_eval_variant` design.
 * The unit of judgment is one producer attempt. Cross-variant deltas can be
 * computed later at read time from stored scores, rather than materialized as
 * their own task output.
 */
import { type Static, Type } from 'typebox';

import type {
  AsyncTaskValidationContext,
  TaskCreateSideEffect,
  TaskValidationError,
} from '../async-validation.js';
import { validateRubricWeights } from '../rubric.js';
import {
  type SuccessCriteria,
  SuccessCriteria as SuccessCriteriaSchema,
} from '../success-criteria.js';
import { JudgePackScore } from './judge-pack.js';

export const JUDGE_EVAL_ATTEMPT_TYPE = 'judge_eval_attempt' as const;

export const JudgeEvalAttemptInput = Type.Object(
  {
    targetTaskId: Type.String({ format: 'uuid' }),
    targetAttemptN: Type.Integer({ minimum: 1 }),
    /**
     * Hidden judge rubric. Producer `run_eval` tasks may carry their own
     * rubric-free `successCriteria`, but only the judge sees this scoring key.
     */
    successCriteria: SuccessCriteriaSchema,
  },
  { $id: 'JudgeEvalAttemptInput', additionalProperties: false },
);
export type JudgeEvalAttemptInput = Static<typeof JudgeEvalAttemptInput>;

export const JudgeEvalAttemptOutput = Type.Object(
  {
    targetTaskId: Type.String({ format: 'uuid' }),
    targetAttemptN: Type.Integer({ minimum: 1 }),
    variantLabel: Type.String({
      minLength: 1,
      maxLength: 64,
      pattern: '^(?!.* - ).*$',
    }),
    scores: Type.Array(JudgePackScore, { minItems: 1 }),
    composite: Type.Number({ minimum: 0, maximum: 1 }),
    verdict: Type.String({ minLength: 1 }),
    judgeModel: Type.Optional(Type.String({ minLength: 1 })),
    traceparent: Type.String({ minLength: 1 }),
  },
  { $id: 'JudgeEvalAttemptOutput', additionalProperties: false },
);
export type JudgeEvalAttemptOutput = Static<typeof JudgeEvalAttemptOutput>;

export function validateJudgeEvalAttemptInput(input: unknown): string | null {
  const sc = (input as { successCriteria?: SuccessCriteria }).successCriteria;
  if (!sc) {
    return 'successCriteria is required for judge_eval_attempt';
  }
  if (!sc.rubric) {
    return 'successCriteria.rubric is required for judge_eval_attempt';
  }
  return validateRubricWeights(sc.rubric);
}

export function validateJudgeEvalAttemptOutput(
  output: unknown,
  input?: unknown,
): string | null {
  const out = output as JudgeEvalAttemptOutput;
  const inp = input as JudgeEvalAttemptInput | undefined;

  if (inp) {
    if (out.targetTaskId !== inp.targetTaskId) {
      return (
        `output.targetTaskId (${out.targetTaskId}) does not match ` +
        `input.targetTaskId (${inp.targetTaskId})`
      );
    }
    if (out.targetAttemptN !== inp.targetAttemptN) {
      return (
        `output.targetAttemptN (${out.targetAttemptN}) does not match ` +
        `input.targetAttemptN (${inp.targetAttemptN})`
      );
    }
  }

  for (let s = 0; s < out.scores.length; s++) {
    const sc = out.scores[s];
    if (!sc.assertions) continue;
    const allPassed = sc.assertions.every((a) => a.passed);
    const expected = allPassed ? 1 : 0;
    if (sc.score !== expected) {
      return (
        `scores[${s}] (criterionId="${sc.criterionId}"): assertions ` +
        `${allPassed ? 'all pass' : 'have at least one fail'} but ` +
        `score=${sc.score}. Score must be 1 iff every assertion passes, ` +
        'else 0.'
      );
    }
  }

  if (inp?.successCriteria?.rubric) {
    const criteria = inp.successCriteria.rubric.criteria;
    const weightById = new Map(criteria.map((c) => [c.id, c.weight]));
    let sum = 0;
    for (const sc of out.scores) {
      const w = weightById.get(sc.criterionId);
      if (w === undefined) {
        return `scores references unknown criterionId "${sc.criterionId}"`;
      }
      sum += w * sc.score;
    }
    const rounded = Math.round(sum * 1000) / 1000;
    if (Math.abs(rounded - out.composite) > 0.001) {
      return (
        `composite (${out.composite}) does not match weighted rubric sum ` +
        `(${rounded})`
      );
    }
  }

  return null;
}

export async function validateJudgeEvalAttemptInputAsync(
  input: unknown,
  ctx: AsyncTaskValidationContext,
): Promise<TaskValidationError[]> {
  const inp = input as JudgeEvalAttemptInput;
  const errors: TaskValidationError[] = [];

  const target = await ctx.resolveTask(inp.targetTaskId);
  if (!target) {
    return [
      {
        field: 'targetTaskId',
        message: `targetTaskId=${inp.targetTaskId} does not resolve to a task you can read`,
      },
    ];
  }

  if (target.taskType !== 'run_eval') {
    errors.push({
      field: 'targetTaskId',
      message: `targetTaskId=${inp.targetTaskId} is a ${target.taskType}, not a run_eval`,
    });
  }

  if (
    !ctx.deferReadinessChecks &&
    (target.status !== 'completed' || target.acceptedAttemptN === null)
  ) {
    errors.push({
      field: 'targetTaskId',
      message:
        `targetTaskId=${inp.targetTaskId} is not completed with an accepted ` +
        `attempt (status=${target.status}, acceptedAttemptN=${target.acceptedAttemptN})`,
    });
  } else if (
    target.acceptedAttemptN !== null &&
    target.acceptedAttemptN !== inp.targetAttemptN
  ) {
    errors.push({
      field: 'targetAttemptN',
      message:
        `targetAttemptN=${inp.targetAttemptN} does not match the producer's ` +
        `acceptedAttemptN=${target.acceptedAttemptN}`,
    });
  }

  if (!target.correlationId) {
    errors.push({
      field: 'targetTaskId',
      message:
        'target run_eval has no correlation_id; cannot enforce duplicate-judge protection',
    });
  }

  if (errors.length > 0 || !target.correlationId) {
    return errors;
  }

  const rubric = inp.successCriteria.rubric;
  const siblings = await ctx.listTasksByCorrelation(target.correlationId);
  const duplicate = siblings.find((task) => {
    if (task.id === ctx.currentTaskId) return false;
    if (task.taskType !== JUDGE_EVAL_ATTEMPT_TYPE) return false;
    if (
      task.status === 'failed' ||
      task.status === 'cancelled' ||
      task.status === 'expired'
    ) {
      return false;
    }
    const existing = task.input as Partial<JudgeEvalAttemptInput>;
    const existingRubric = existing.successCriteria?.rubric;
    return (
      existing.targetTaskId === inp.targetTaskId &&
      existing.targetAttemptN === inp.targetAttemptN &&
      existingRubric?.rubricId === rubric?.rubricId &&
      existingRubric?.version === rubric?.version
    );
  });

  if (duplicate) {
    errors.push({
      field: 'targetTaskId',
      message:
        `judge task ${duplicate.id} already exists for ` +
        `(${inp.targetTaskId}, attempt ${inp.targetAttemptN}, ` +
        `rubric ${rubric?.rubricId}@${rubric?.version})`,
    });
  }

  return errors;
}

export async function onCreateJudgeEvalAttempt(
  input: unknown,
  _ctx: AsyncTaskValidationContext,
): Promise<TaskCreateSideEffect[]> {
  const judge = input as JudgeEvalAttemptInput;
  const rubric = judge.successCriteria.rubric;
  if (!rubric) return [];
  return [
    {
      kind: 'guardTaskUniqueness',
      taskType: JUDGE_EVAL_ATTEMPT_TYPE,
      lockKey: [
        JUDGE_EVAL_ATTEMPT_TYPE,
        judge.targetTaskId,
        String(judge.targetAttemptN),
        rubric.rubricId,
        rubric.version,
      ].join(':'),
      inputMatches: [
        { path: ['targetTaskId'], value: judge.targetTaskId },
        { path: ['targetAttemptN'], value: judge.targetAttemptN },
        {
          path: ['successCriteria', 'rubric', 'rubricId'],
          value: rubric.rubricId,
        },
        {
          path: ['successCriteria', 'rubric', 'version'],
          value: rubric.version,
        },
      ],
    },
  ];
}
