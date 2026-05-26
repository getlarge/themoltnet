/**
 * `assess_brief` — independently evaluate a fulfilled brief.
 *
 * output_kind: judgment
 * criteria: required (`successCriteria.rubric` — same envelope as
 *   `judge_pack`)
 * references: required (must reference the target `fulfill_brief` task)
 *
 * The assessor is a different agent from the producer (enforced by the
 * server / runtime at claim time — not in the wire schema).
 *
 * The rubric in `successCriteria` IS the job spec — the assessor applies
 * it to the target task's output and emits per-criterion scores. Other
 * sections (`assertions`, `gates`, `sideEffects`) MAY be present and are
 * evaluated against the *assessor's output*.
 */
import { type Static, Type } from '@sinclair/typebox';

import type {
  AsyncTaskValidationContext,
  TaskValidationError,
} from '../async-validation.js';
import { SuccessCriteria } from '../success-criteria.js';

export const ASSESS_BRIEF_TYPE = 'assess_brief' as const;

export const AssessBriefInput = Type.Object(
  {
    /**
     * Task id of the `fulfill_brief` being judged. Also must appear in
     * the Task's `references[]` with role='judged_work'.
     */
    targetTaskId: Type.String({ format: 'uuid' }),

    /**
     * Required SuccessCriteria envelope. Must contain a `rubric` — that
     * rubric IS the assessment job spec.
     */
    successCriteria: SuccessCriteria,
  },
  { $id: 'AssessBriefInput', additionalProperties: false },
);
export type AssessBriefInput = Static<typeof AssessBriefInput>;

/** One score line. */
export const AssessBriefScore = Type.Object(
  {
    criterionId: Type.String({ minLength: 1 }),
    score: Type.Number({ minimum: 0, maximum: 1 }),
    /** Required for `llm_score`; optional for `boolean`/`deterministic_*`. */
    rationale: Type.Optional(Type.String()),
    /** Present only for `deterministic_signature_check`. */
    evidence: Type.Optional(
      Type.Object(
        {
          commitsVerified: Type.Number(),
          commitsTotal: Type.Number(),
          signatureFailures: Type.Array(Type.String()),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { $id: 'AssessBriefScore', additionalProperties: false },
);
export type AssessBriefScore = Static<typeof AssessBriefScore>;

export const AssessBriefOutput = Type.Object(
  {
    /**
     * Per-criterion scores, same order/length as
     * `input.successCriteria.rubric.criteria`.
     */
    scores: Type.Array(AssessBriefScore, { minItems: 1 }),

    /** Σ(weight_i * score_i). Recomputed by the assessor and checked client-side. */
    composite: Type.Number({ minimum: 0, maximum: 1 }),

    /** 1–3 sentence overall verdict. */
    verdict: Type.String({ minLength: 1 }),

    /** Model identifier used for `llm_score` criteria, for auditability. */
    judgeModel: Type.Optional(Type.String()),
  },
  { $id: 'AssessBriefOutput', additionalProperties: false },
);
export type AssessBriefOutput = Static<typeof AssessBriefOutput>;

/**
 * Async preflight (#1096):
 *   - `targetTaskId` resolves to a real task the caller can see.
 *   - The target is a `fulfill_brief` (you cannot grade an arbitrary
 *     task type as if it were a brief fulfillment).
 *   - Unless readiness checks are explicitly deferred, the target is
 *     `completed` with an accepted attempt — grading an in-flight or
 *     failed task would either race or grade nothing.
 *
 * Agent-distinctness ("assessor ≠ producer") is a runtime / auth-
 * layer concern and intentionally NOT checked here. It belongs in
 * an auth-aware claim-time check.
 */
export async function validateAssessBriefInputAsync(
  input: unknown,
  ctx: AsyncTaskValidationContext,
): Promise<TaskValidationError[]> {
  const { targetTaskId } = input as AssessBriefInput;
  const errors: TaskValidationError[] = [];
  const target = await ctx.resolveTask(targetTaskId);
  if (!target) {
    errors.push({
      field: 'targetTaskId',
      message: `targetTaskId ${targetTaskId} does not resolve to a task you can read`,
    });
    return errors;
  }
  if (target.taskType !== 'fulfill_brief') {
    errors.push({
      field: 'targetTaskId',
      message: `targetTaskId ${targetTaskId} is a ${target.taskType}, not a fulfill_brief`,
    });
  }
  if (
    !ctx.deferReadinessChecks &&
    (target.status !== 'completed' || target.acceptedAttemptN === null)
  ) {
    errors.push({
      field: 'targetTaskId',
      message: `targetTaskId ${targetTaskId} is not completed with an accepted attempt (status=${target.status}, acceptedAttemptN=${target.acceptedAttemptN})`,
    });
  }
  return errors;
}
