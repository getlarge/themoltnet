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
  FULFILL_BRIEF_TYPE,
  FulfillBriefInput,
  FulfillBriefOutput,
} from './fulfill-brief.js';
import {
  JUDGE_EVAL_VARIANT_TYPE,
  JudgeEvalVariantInput,
  JudgeEvalVariantOutput,
  onCreateJudgeEvalVariant,
  validateJudgeEvalVariantInput,
  validateJudgeEvalVariantInputAsync,
  validateJudgeEvalVariantOutput,
} from './judge-eval-variant.js';
import {
  JUDGE_PACK_TYPE,
  JudgePackInput,
  JudgePackOutput,
  validateJudgePackInputAsync,
  validateJudgePackOutput,
} from './judge-pack.js';
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
export * from './fulfill-brief.js';
export * from './judge-eval-variant.js';
export * from './judge-pack.js';
export * from './render-pack.js';
export * from './run-eval.js';

interface TaskTypeEntry {
  readonly name: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly outputKind: OutputKind;
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
   * (e.g. judge_eval_variant) opt in. Keeping it opt-in prevents
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
   * v1: only `sealCorrelation` is supported (see #1096).
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
  [FULFILL_BRIEF_TYPE]: {
    name: FULFILL_BRIEF_TYPE,
    inputSchema: FulfillBriefInput,
    outputSchema: FulfillBriefOutput,
    outputKind: 'artifact',
    workspaceMode: 'dedicated_worktree',
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
  },
  [ASSESS_BRIEF_TYPE]: {
    name: ASSESS_BRIEF_TYPE,
    inputSchema: AssessBriefInput,
    outputSchema: AssessBriefOutput,
    outputKind: 'judgment',
    requiresReferences: true,
    validateInput: validateJudgmentInput,
    validateInputAsync: validateAssessBriefInputAsync,
  },
  [CURATE_PACK_TYPE]: {
    name: CURATE_PACK_TYPE,
    inputSchema: CuratePackInput,
    outputSchema: CuratePackOutput,
    outputKind: 'artifact',
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
  },
  [RENDER_PACK_TYPE]: {
    name: RENDER_PACK_TYPE,
    inputSchema: RenderPackInput,
    outputSchema: RenderPackOutput,
    outputKind: 'artifact',
    requiresReferences: false,
    validateOutput: requireVerificationWhenCriteriaPresent,
    validateInputAsync: validateRenderPackInputAsync,
  },
  [JUDGE_PACK_TYPE]: {
    name: JUDGE_PACK_TYPE,
    inputSchema: JudgePackInput,
    outputSchema: JudgePackOutput,
    outputKind: 'judgment',
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
    requiresReferences: false,
    validateOutput: validateRunEvalOutput,
  },
  [JUDGE_EVAL_VARIANT_TYPE]: {
    name: JUDGE_EVAL_VARIANT_TYPE,
    inputSchema: JudgeEvalVariantInput,
    outputSchema: JudgeEvalVariantOutput,
    outputKind: 'judgment',
    requiresReferences: false,
    validateInput: validateJudgeEvalVariantInput,
    validateOutput: validateJudgeEvalVariantOutput,
    validateInputAsync: validateJudgeEvalVariantInputAsync,
    onCreate: onCreateJudgeEvalVariant,
    usesSubagents: true,
  },
} as const satisfies Record<string, TaskTypeEntry>;

export type BuiltInTaskType = keyof typeof BUILT_IN_TASK_TYPES;
