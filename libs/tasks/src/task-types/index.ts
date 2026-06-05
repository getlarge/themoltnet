import type { TSchema } from '@sinclair/typebox';

import type {
  AsyncTaskValidationContext,
  TaskCreateSideEffect,
  TaskValidationError,
} from '../async-validation.js';
import { validateRubricWeights } from '../rubric.js';
import type { SuccessCriteria } from '../success-criteria.js';
import type { OutputKind } from '../wire.js';
import {
  ASSESS_BRIEF_TYPE,
  AssessBriefInput,
  AssessBriefOutput,
  validateAssessBriefInputAsync,
} from './assess-brief.js';
import {
  CURATE_PACK_TYPE,
  CuratePackInput,
  CuratePackOutput,
} from './curate-pack.js';
import {
  FREEFORM_TYPE,
  FreeformInput,
  FreeformOutput,
  validateFreeformInputAsync,
} from './freeform.js';
import {
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  FulfillBriefOutput,
} from './fulfill-brief.js';
import {
  JUDGE_EVAL_ATTEMPT_TYPE,
  JudgeEvalAttemptInput,
  JudgeEvalAttemptOutput,
  onCreateJudgeEvalAttempt,
  validateJudgeEvalAttemptInput,
  validateJudgeEvalAttemptInputAsync,
  validateJudgeEvalAttemptOutput,
} from './judge-eval-attempt.js';
import {
  JUDGE_PACK_TYPE,
  JudgePackInput,
  JudgePackOutput,
  validateJudgePackInputAsync,
  validateJudgePackOutput,
} from './judge-pack.js';
import {
  PR_REVIEW_TYPE,
  PrReviewInput,
  PrReviewOutput,
  validatePrReviewInput,
  validatePrReviewOutput,
} from './pr-review.js';
import {
  RENDER_PACK_TYPE,
  RenderPackInput,
  RenderPackOutput,
  validateRenderPackInputAsync,
} from './render-pack.js';
import {
  RUN_EVAL_TYPE,
  RunEvalInput,
  RunEvalOutput,
  validateRunEvalOutput,
} from './run-eval.js';

export * from './assess-brief.js';
export * from './curate-pack.js';
export * from './freeform.js';
export * from './fulfill-brief.js';
export * from './judge-eval-attempt.js';
export * from './judge-eval-variant.js';
export * from './judge-pack.js';
export * from './pr-review.js';
export * from './render-pack.js';
export * from './run-eval.js';

interface TaskTypeEntry {
  readonly name: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly outputKind: OutputKind;
  readonly resumable?: boolean;
  /**
   * Filesystem isolation policy requested by the task type.
   *
   * `shared_mount` = run directly against the daemon's configured mountPath.
   * `dedicated_worktree` = provision a fresh linked git worktree per attempt
   * and mount that into the sandbox instead of the daemon's primary checkout.
   *
   * Default: undefined (== `shared_mount`).
   */
  readonly workspaceMode?: 'shared_mount' | 'dedicated_worktree';
  /**
   * Lifetime of the task type's local workspace.
   *
   * `attempt` = disposable workspace torn down when the attempt ends.
   * `session` = workspace stays attached to a daemon-local warm session.
   *
   * Default: undefined (== `attempt`).
   */
  readonly workspaceScope?: 'attempt' | 'session';
  /**
   * Granularity of daemon-local session reuse for this task type.
   *
   * `none` = always cold-start a fresh executor context.
   * `correlation` = one warm session per `correlationId`.
   * `custom` = task type needs a narrower daemon-computed reuse key.
   *
   * Default: undefined (== `none`).
   */
  readonly sessionScope?: 'none' | 'correlation' | 'custom';
  /**
   * When true, the daemon honours a proposer-supplied workspace mode via
   * `task.input.execution.workspace`. Recognized values: `'none'`
   * (scratch_mount), `'shared_mount'`, `'dedicated_worktree'`. Unrecognized or
   * absent values fall back to `workspaceMode`. The task type's `inputSchema`
   * MUST declare `execution.workspace` for `Value.Check` to admit it.
   *
   * Default: undefined (== false). Task types whose execution shape is fixed
   * (e.g. `fulfill_brief` always wants a worktree) should not opt in.
   */
  readonly acceptsInputWorkspaceOverride?: boolean;
  readonly requiresReferences: boolean;
  /**
   * Optional cross-field validator run AFTER `Value.Check(inputSchema)`
   * passes. Use for invariants a TypeBox schema can't express — e.g. a
   * rubric's criteria weights summing to 1.0, or "judgment tasks must
   * carry a rubric inside their successCriteria." Returns null on
   * success, or an error message that surfaces to the task runner.
   */
  readonly validateInput?: (input: unknown) => string | null;
  /**
   * Optional cross-field validator run AFTER `Value.Check(outputSchema)`
   * passes. Use for invariants a TypeBox schema can't express — e.g. for
   * `judge_pack`, an `llm_checklist` criterion's `score` must equal
   * `1` iff every `assertions[].passed` is true (#999), or
   * "verification is required when input declared successCriteria"
   * (cross-field rule that needs both sides). Returns null on success,
   * or an error message that surfaces to the task runner.
   */
  readonly validateOutput?: (output: unknown, input?: unknown) => string | null;
  /**
   * When true, executors should make the generic `subagent` custom
   * tool available to sessions running this task type — letting the
   * parent LLM delegate sub-tasks to isolated child sessions with
   * named output contracts. See issue #1087 for the full design.
   *
   * Default: undefined (== false). Most task types do not delegate;
   * only types whose execution is naturally fan-out-and-collect
   * (e.g. a future fan-out judgment task) opt in. Keeping it opt-in prevents
   * task-type LLMs from spuriously delegating work that should stay
   * in their own session.
   */
  readonly usesSubagents?: boolean;
  /**
   * Async preflight run after sync `validateInput` at task-create
   * time. Receives a narrow `AsyncTaskValidationContext` exposing
   * only DB lookups (resolveTask, listTasksByCorrelation,
   * findCorrelationSeal, resolveContextPack, resolveRenderedPack).
   * Returns `TaskValidationError[]`; empty array means OK.
   *
   * Pure read-side: validators MUST NOT mutate state. Side effects
   * a task type wants applied atomically with task creation are
   * declared via `onCreate` instead.
   *
   * Server-side only — the SDK runs sync `validateInput` only.
   * See issue #1096 for the full design.
   */
  readonly validateInputAsync?: (
    input: unknown,
    ctx: AsyncTaskValidationContext,
  ) => Promise<TaskValidationError[]>;
  /**
   * Optional post-insert side effects a task type wants applied
   * atomically with task creation. Returns the side-effect list;
   * the task service applies them inside the same transaction as
   * the task insert. Runs only after `validateInput` and
   * `validateInputAsync` both pass.
   *
   * v1 supports correlation sealing and transactional uniqueness guards.
   */
  readonly onCreate?: (
    input: unknown,
    ctx: AsyncTaskValidationContext,
  ) => Promise<TaskCreateSideEffect[]>;
}

/**
 * Validate that a judgment-task input carries a rubric inside its
 * `successCriteria` envelope, and that the rubric's weights sum to 1.
 * Used for `assess_brief` and `judge_pack`.
 */
function validateJudgmentInput(input: unknown): string | null {
  const sc = (input as { successCriteria?: SuccessCriteria }).successCriteria;
  if (!sc) {
    return 'successCriteria is required for judgment tasks';
  }
  if (!sc.rubric) {
    return 'successCriteria.rubric is required for judgment tasks';
  }
  return validateRubricWeights(sc.rubric);
}

/**
 * Cross-field rule: when `input.successCriteria` is set, the producer's
 * output MUST carry a `verification` block (the LLM's self-assessment).
 * When it is unset, the output MUST NOT carry one (avoid garbage data).
 *
 * Used by all three fulfillment task types. Judgment task outputs do
 * NOT use this — their entire output IS a structured judgment, so a
 * separate self-assessment field would be circular.
 */
function requireVerificationWhenCriteriaPresent(
  output: unknown,
  input?: unknown,
): string | null {
  const hasCriteria =
    input !== undefined &&
    input !== null &&
    (input as { successCriteria?: SuccessCriteria }).successCriteria !==
      undefined;
  const hasVerification =
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

/**
 * Client-side task-type registry. Mirrors the server-owned DB registry
 * (PR 2). PR 0 shipped the two brief types; this PR adds the three
 * pack-pipeline types for the three-session attribution loop (#875).
 *
 * Consumers validate `Task.input` against
 * `BUILT_IN_TASK_TYPES[task.task_type].inputSchema` before creating
 * / claiming a task.
 */
export const BUILT_IN_TASK_TYPES = {
  [FREEFORM_TYPE]: {
    name: FREEFORM_TYPE,
    inputSchema: FreeformInput,
    outputSchema: FreeformOutput,
    outputKind: 'artifact',
    resumable: true,
    workspaceMode: 'shared_mount',
    workspaceScope: 'session',
    sessionScope: 'correlation',
    acceptsInputWorkspaceOverride: true,
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
    validateInputAsync: validateFreeformInputAsync,
  },
  [FULFILL_BRIEF_TYPE]: {
    name: FULFILL_BRIEF_TYPE,
    inputSchema: FulfillBriefInput,
    outputSchema: FulfillBriefOutput,
    outputKind: 'artifact',
    resumable: true,
    workspaceMode: 'dedicated_worktree',
    workspaceScope: 'session',
    sessionScope: 'correlation',
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
  },
  [ASSESS_BRIEF_TYPE]: {
    name: ASSESS_BRIEF_TYPE,
    inputSchema: AssessBriefInput,
    outputSchema: AssessBriefOutput,
    outputKind: 'judgment',
    workspaceMode: 'dedicated_worktree',
    workspaceScope: 'attempt',
    sessionScope: 'none',
    requiresReferences: true,
    validateInput: validateJudgmentInput,
    validateInputAsync: validateAssessBriefInputAsync,
  },
  [PR_REVIEW_TYPE]: {
    name: PR_REVIEW_TYPE,
    inputSchema: PrReviewInput,
    outputSchema: PrReviewOutput,
    outputKind: 'judgment',
    workspaceMode: 'dedicated_worktree',
    workspaceScope: 'attempt',
    sessionScope: 'none',
    requiresReferences: false,
    validateInput: validatePrReviewInput,
    validateOutput: validatePrReviewOutput,
  },
  [CURATE_PACK_TYPE]: {
    name: CURATE_PACK_TYPE,
    inputSchema: CuratePackInput,
    outputSchema: CuratePackOutput,
    outputKind: 'artifact',
    workspaceScope: 'attempt',
    sessionScope: 'none',
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
  },
  [RENDER_PACK_TYPE]: {
    name: RENDER_PACK_TYPE,
    inputSchema: RenderPackInput,
    outputSchema: RenderPackOutput,
    outputKind: 'artifact',
    workspaceScope: 'attempt',
    sessionScope: 'none',
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
    validateInputAsync: validateRenderPackInputAsync,
  },
  [JUDGE_PACK_TYPE]: {
    name: JUDGE_PACK_TYPE,
    inputSchema: JudgePackInput,
    outputSchema: JudgePackOutput,
    outputKind: 'judgment',
    workspaceScope: 'attempt',
    sessionScope: 'none',
    requiresReferences: true,
    validateInput: validateJudgmentInput,
    validateOutput: validateJudgePackOutput,
    validateInputAsync: validateJudgePackInputAsync,
  },
  [RUN_EVAL_TYPE]: {
    name: RUN_EVAL_TYPE,
    inputSchema: RunEvalInput,
    outputSchema: RunEvalOutput,
    outputKind: 'artifact',
    resumable: true,
    workspaceScope: 'session',
    sessionScope: 'custom',
    acceptsInputWorkspaceOverride: true,
    requiresReferences: false,
    validateOutput: validateRunEvalOutput,
  },
  [JUDGE_EVAL_ATTEMPT_TYPE]: {
    name: JUDGE_EVAL_ATTEMPT_TYPE,
    inputSchema: JudgeEvalAttemptInput,
    outputSchema: JudgeEvalAttemptOutput,
    outputKind: 'judgment',
    workspaceScope: 'attempt',
    sessionScope: 'none',
    requiresReferences: false,
    validateInput: validateJudgeEvalAttemptInput,
    validateOutput: validateJudgeEvalAttemptOutput,
    validateInputAsync: validateJudgeEvalAttemptInputAsync,
    onCreate: onCreateJudgeEvalAttempt,
  },
} as const satisfies Record<string, TaskTypeEntry>;

export type BuiltInTaskType = keyof typeof BUILT_IN_TASK_TYPES;
