/**
 * Async task-create validation primitive (#1096).
 *
 * The synchronous `validateInput` hook on `TaskTypeEntry` checks
 * shape and pure invariants, but cannot resolve referenced ids
 * (target task / pack / correlation seal) — it has no DB access.
 *
 * `validateInputAsync` runs alongside it during task creation. It
 * receives a NARROW context that exposes only the lookups validators
 * need; it does NOT hand task types the full task-service surface.
 * That keeps task-type modules from accidentally reaching into auth,
 * messaging, or any other concern that doesn't belong inside a
 * validator.
 *
 * This module defines the contract only. The context implementation
 * lives in `@moltnet/task-service` (it composes the existing
 * repositories), and each task type's validator uses the contract
 * methods to express its preflight checks.
 */
import type { Task } from './wire.js';

/**
 * Validation error returned by both sync `validateTaskCreateRequest`
 * and async `validateInputAsync`. `field` is a JSON-pointer-like path
 * pointing at the offending input field; `message` is the
 * human-readable error.
 *
 * Defined here (rather than in `validation.ts`) so `task-types/*.ts`
 * can import it without creating a cycle through the registry
 * (`validation.ts` imports `BUILT_IN_TASK_TYPES`).
 */
export interface TaskValidationError {
  readonly field: string;
  readonly message: string;
}

/**
 * Pack reference resolved by the async ctx.
 *
 * `judge_pack` resolves both source (context pack) and rendered pack
 * by id. `render_pack` resolves source only. Each task type uses
 * whichever helpers it needs; the ctx exposes both so the surface
 * stays uniform.
 */
export interface ResolvedContextPack {
  readonly id: string;
  readonly packCid: string;
  readonly diaryId: string;
}

export interface ResolvedRenderedPack {
  readonly id: string;
  readonly packCid: string;
  /** The `context_packs.id` this rendering was produced from. */
  readonly sourcePackId: string;
  readonly diaryId: string;
}

/**
 * Correlation seal record. A correlation_id is sealed when a
 * task type that wants a monotonic add-only correlation snapshot
 * (historically `judge_eval_variant`, potentially future tasks too)
 * is created against it.
 * Subsequent task-create calls in the same correlation group reject
 * with a clear error.
 */
export interface CorrelationSeal {
  readonly correlationId: string;
  readonly sealedAt: string;
  readonly sealedByTaskId: string;
  readonly sealedByTaskType: string;
}

/**
 * Context exposed to every `validateInputAsync` invocation. Methods
 * are deliberately specific (`resolveTask`, not a generic
 * `runQuery`) so validators stay focused and the ctx surface remains
 * auditable.
 *
 * Implementations live in `@moltnet/task-service`.
 */
export interface AsyncTaskValidationContext {
  /**
   * Conditional tasks may be proposed before their producer tasks are ready.
   * Validators must still check stable facts (existence, visibility, type,
   * duplicate guards), but may defer readiness facts until the task is about
   * to become claimable.
   */
  readonly deferReadinessChecks?: boolean;

  /**
   * Task id currently being revalidated, when validation runs for an existing
   * waiting task that is about to become claimable. Uniqueness checks use this
   * to avoid treating the task as its own duplicate.
   */
  readonly currentTaskId?: string;

  /**
   * Resolve a task by id. Returns null if not found OR if the
   * caller cannot read it (the implementation runs the same
   * permission check the GET endpoint uses, so validators can't
   * use the ctx to confirm existence of tasks the caller wouldn't
   * otherwise be allowed to see).
   */
  resolveTask(taskId: string): Promise<Task | null>;

  /**
   * List tasks sharing a `correlation_id`. Same caller-bound
   * visibility as `resolveTask`. Used by eval tasks to inspect
   * sibling runs or judges in the same correlation group.
   */
  listTasksByCorrelation(correlationId: string): Promise<Task[]>;

  /**
   * Find the existing seal for a correlation_id, or null. Used by
   * task types that reject creates against sealed groups.
   */
  findCorrelationSeal(correlationId: string): Promise<CorrelationSeal | null>;

  /** Resolve a `context_packs.id`. */
  resolveContextPack(packId: string): Promise<ResolvedContextPack | null>;

  /** Resolve a `rendered_packs.id`. */
  resolveRenderedPack(packId: string): Promise<ResolvedRenderedPack | null>;
}

/**
 * Post-validation, post-insert side effects a task type wants to
 * apply atomically with task creation. Returned from a task type's
 * `onCreate` hook (separate from validators — validators are pure
 * read-side; effects are applied by the task service after the task
 * row is inserted, in the same transaction).
 *
 * v1 supports correlation sealing and transactional uniqueness guards.
 * Future side-effects (e.g. notify a webhook, kick off a follow-up task)
 * would extend this union.
 */
export type TaskCreateSideEffect =
  | {
      readonly kind: 'sealCorrelation';
      readonly correlationId: string;
    }
  | {
      readonly kind: 'guardTaskUniqueness';
      readonly taskType: string;
      readonly lockKey: string;
      readonly inputMatches: ReadonlyArray<{
        readonly path: readonly string[];
        readonly value: string | number | boolean;
      }>;
    };
