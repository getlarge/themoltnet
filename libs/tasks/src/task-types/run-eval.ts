/**
 * `run_eval` — execute a scenario prompt under a named variant for
 * later cross-variant grading by `judge_eval_variant` (Slice 2).
 *
 * output_kind: artifact
 * criteria: optional (when set, output.verification is required —
 *   producer self-assessment; the judge is the binding evaluator)
 * references: not required (scenario lives entirely in input)
 */
import { type Static, Type } from '@sinclair/typebox';

import { TaskContext } from '../context.js';
import { SuccessCriteria, VerificationRecord } from '../success-criteria.js';

export const RUN_EVAL_TYPE = 'run_eval' as const;

export const RunEvalMode = Type.Union(
  [Type.Literal('vitro'), Type.Literal('vivo')],
  { $id: 'RunEvalMode' },
);
export type RunEvalMode = Static<typeof RunEvalMode>;

export const RunEvalWorkspace = Type.Union(
  [
    Type.Literal('none'),
    Type.Literal('shared_mount'),
    Type.Literal('dedicated_worktree'),
  ],
  { $id: 'RunEvalWorkspace' },
);
export type RunEvalWorkspace = Static<typeof RunEvalWorkspace>;

export const RunEvalExecution = Type.Object(
  {
    /**
     * `vitro` = proctored eval in an isolated runner context whose main
     * comparison target is prompt/context behavior.
     * `vivo` = live-repo eval against a real checkout/worktree.
     */
    mode: RunEvalMode,
    /**
     * Workspace shape selected by the task creator for this variant run.
     * `none` means the runner should not expose the repository checkout at
     * all; it receives an empty scratch workspace instead.
     */
    workspace: RunEvalWorkspace,
  },
  { $id: 'RunEvalExecution', additionalProperties: false },
);
export type RunEvalExecution = Static<typeof RunEvalExecution>;

export const RunEvalInput = Type.Object(
  {
    scenario: Type.Object(
      {
        prompt: Type.String({ minLength: 1 }),
        inputFiles: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
      },
      { additionalProperties: false },
    ),
    /** Variant identity. Joins variants under a correlation_id. */
    variantLabel: Type.String({ minLength: 1, maxLength: 64 }),
    /**
     * Per-task execution shape. The task creator, not the task type
     * registry, decides whether this eval runs in vitro or vivo and
     * whether it needs no repo, the shared mount, or a dedicated worktree.
     */
    execution: RunEvalExecution,
    /** Empty array IS the baseline. */
    context: TaskContext,
    /**
     * Optional self-assessment criteria (advisory; the judge in Slice 2
     * is the binding evaluator). When present, `output.verification`
     * MUST be supplied (see `validateRunEvalOutput`).
     */
    successCriteria: Type.Optional(SuccessCriteria),
  },
  { $id: 'RunEvalInput', additionalProperties: false },
);
export type RunEvalInput = Static<typeof RunEvalInput>;

export const RunEvalOutput = Type.Object(
  {
    response: Type.String({ minLength: 1 }),
    artifacts: Type.Optional(
      Type.Array(
        Type.Object(
          {
            path: Type.String({ minLength: 1 }),
            cid: Type.String({ minLength: 1 }),
          },
          { additionalProperties: false },
        ),
      ),
    ),
    totalTokens: Type.Integer({ minimum: 0 }),
    durationMs: Type.Integer({ minimum: 0 }),
    traceparent: Type.String({ minLength: 1 }),
    /** Required iff input.successCriteria is set. */
    verification: Type.Optional(VerificationRecord),
  },
  { $id: 'RunEvalOutput', additionalProperties: false },
);
export type RunEvalOutput = Static<typeof RunEvalOutput>;

/**
 * Cross-field rule mirroring the `requireVerificationWhenCriteriaPresent`
 * rule used by the brief task types: when input declares
 * `successCriteria`, output MUST carry `verification`; when it doesn't,
 * output MUST NOT carry one.
 */
export function validateRunEvalOutput(
  output: unknown,
  input?: unknown,
): string | null {
  const hasCriteria =
    input !== null &&
    input !== undefined &&
    (input as { successCriteria?: SuccessCriteria }).successCriteria !==
      undefined;
  const hasVerification =
    output !== null &&
    output !== undefined &&
    (output as { verification?: unknown }).verification !== undefined;
  if (hasCriteria && !hasVerification) {
    return (
      'output.verification is required because input.successCriteria is set; ' +
      'the producer LLM must self-assess against the criteria'
    );
  }
  if (!hasCriteria && hasVerification) {
    return (
      'output.verification was supplied but input.successCriteria is unset; ' +
      'omit verification when there are no criteria to assess against'
    );
  }
  return null;
}
