import { type Static, Type } from 'typebox';

import type {
  AsyncTaskValidationContext,
  TaskValidationError,
} from '../async-validation.js';
import { TaskContext } from '../context.js';
import { SuccessCriteria, VerificationRecord } from '../success-criteria.js';

export const FREEFORM_TYPE = 'freeform' as const;

export const FreeformExecutionOptions = Type.Object(
  {
    /**
     * Workspace mode the proposer wants for this task. Matches the
     * `run_eval` convention so the daemon's registry-level override
     * resolution is uniform across task types.
     */
    workspace: Type.Optional(
      Type.Union([
        Type.Literal('none'),
        Type.Literal('shared_mount'),
        Type.Literal('dedicated_worktree'),
      ]),
    ),
  },
  { $id: 'FreeformExecutionOptions', additionalProperties: false },
);
export type FreeformExecutionOptions = Static<typeof FreeformExecutionOptions>;

export const FreeformContinueFrom = Type.Object(
  {
    taskId: Type.String({ format: 'uuid' }),
    attemptN: Type.Integer({ minimum: 1 }),
    /**
     * `'extend'` (default) continues the parent conversation and branch when
     * branch metadata is available. `'fork'` cuts a new branch from the parent
     * branch into a fresh worktree.
     */
    mode: Type.Optional(
      Type.Union([Type.Literal('extend'), Type.Literal('fork')]),
    ),
  },
  { $id: 'FreeformContinueFrom', additionalProperties: false },
);
export type FreeformContinueFrom = Static<typeof FreeformContinueFrom>;

export const FreeformTaskTypeProposal = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    rationale: Type.String({ minLength: 1 }),
    inputShape: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
    outputShape: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { $id: 'FreeformTaskTypeProposal', additionalProperties: false },
);
export type FreeformTaskTypeProposal = Static<typeof FreeformTaskTypeProposal>;

export const FreeformInput = Type.Object(
  {
    /** Natural-language work request when no narrower task type fits yet. */
    brief: Type.String({ minLength: 1 }),
    /**
     * Optional expectation about the shape or destination of the answer.
     * Kept as prose because this task type is the discovery lane.
     */
    expectedOutput: Type.Optional(Type.String({ minLength: 1 })),
    constraints: Type.Optional(
      Type.Array(Type.String({ minLength: 1 }), { maxItems: 20 }),
    ),
    /** Proposer's best guess; does not need to be registered yet. */
    suggestedTaskType: Type.Optional(Type.String({ minLength: 1 })),
    successCriteria: Type.Optional(SuccessCriteria),
    context: Type.Optional(TaskContext),
    /**
     * Optional proposer-supplied execution hints. The `workspace` field
     * mirrors run_eval's input.execution.workspace surface; the daemon
     * honors it because the freeform registry entry sets
     * acceptsInputWorkspaceOverride.
     */
    execution: Type.Optional(FreeformExecutionOptions),
    /**
     * When set, the daemon treats this task as a continuation of the named
     * source attempt.
     */
    continueFrom: Type.Optional(FreeformContinueFrom),
  },
  { $id: 'FreeformInput', additionalProperties: false },
);
export type FreeformInput = Static<typeof FreeformInput>;

export const FreeformArtifact = Type.Object(
  {
    kind: Type.String({ minLength: 1 }),
    title: Type.String({ minLength: 1 }),
    description: Type.Optional(Type.String({ minLength: 1 })),
    url: Type.Optional(Type.String({ minLength: 1 })),
    path: Type.Optional(Type.String({ minLength: 1 })),
    /**
     * Persistent task-artifact CID produced with `moltnet_upload_task_artifact`.
     * Use this for large or binary bytes stored outside the structured output.
     */
    cid: Type.Optional(Type.String({ minLength: 1 })),
    contentType: Type.Optional(Type.String({ minLength: 1 })),
    contentEncoding: Type.Optional(Type.String({ minLength: 1 })),
    sizeBytes: Type.Optional(Type.Integer({ minimum: 0 })),
    /**
     * Inline artifact content, up to 64 KiB. Matches the diary-entry content
     * cap so structured editors and renderers can handle either uniformly.
     * For larger or binary content use `path` (worktree-ephemeral) or `url`
     * (caller-managed); persistent file-backed artifacts are a follow-up.
     */
    body: Type.Optional(Type.String({ maxLength: 65536 })),
  },
  { $id: 'FreeformArtifact', additionalProperties: false },
);
export type FreeformArtifact = Static<typeof FreeformArtifact>;

export const FreeformOutput = Type.Object(
  {
    /** 2-5 sentence result summary. */
    summary: Type.String({ minLength: 1 }),
    /**
     * Branch used for code-changing freeform work. Optional because many
     * exploratory tasks produce prose or inline artifacts only.
     */
    branch: Type.Optional(Type.String({ minLength: 1 })),
    artifacts: Type.Optional(Type.Array(FreeformArtifact, { maxItems: 20 })),
    proposedTaskType: Type.Optional(FreeformTaskTypeProposal),
    diaryEntryIds: Type.Optional(Type.Array(Type.String({ format: 'uuid' }))),
    /**
     * Required when input.successCriteria is set, including the submit-output
     * gate injected by create-time normalization.
     */
    verification: Type.Optional(VerificationRecord),
  },
  { $id: 'FreeformOutput', additionalProperties: false },
);
export type FreeformOutput = Static<typeof FreeformOutput>;

/**
 * Server-side preflight for `freeform` task-create. Runs after the
 * sync TypeBox check passes and only kicks in when
 * `input.continueFrom` is set — i.e. the proposer is asking to
 * continue from a prior freeform attempt (#1287).
 *
 * Failure modes, in evaluation order:
 *  1. `freeform.sourceTaskNotFound` — source task id does not resolve
 *     (does not exist OR caller can't read it; we don't distinguish).
 *  2. `freeform.sourceTaskTypeNotSupported` — source isn't `freeform`.
 *     v1 only supports freeform → freeform continuation.
 *  3. `freeform.sourceAttemptNotCompleted` — named attempt is missing
 *     or not in `completed` state; continuation only makes sense
 *     once the parent has produced a terminal output.
 *  4. `freeform.executionWorkspaceNotInheritable` — caller set
 *     `execution.workspace` together with `continueFrom`. Workspace
 *     mode for a continuation is derived by the daemon from parent runtime
 *     context (local slot first, durable session + source attempt branch
 *     second), so any caller-supplied override is silently dropped at the
 *     daemon plan stage. Reject explicitly so misconfiguration surfaces at
 *     create time.
 *
 * Returns on the first failure — the checks
 * are sequential preconditions, later ones presume earlier ones hold.
 */
export async function validateFreeformInputAsync(
  input: unknown,
  ctx: AsyncTaskValidationContext,
): Promise<TaskValidationError[]> {
  const cf = (input as { continueFrom?: FreeformContinueFrom }).continueFrom;
  if (!cf) return [];

  const source = await ctx.resolveTask(cf.taskId);
  if (!source) {
    return [
      {
        field: 'input/continueFrom/taskId',
        message: `Source task ${cf.taskId} does not resolve to a task you can read`,
        code: 'freeform.sourceTaskNotFound',
      },
    ];
  }

  if (source.taskType !== FREEFORM_TYPE) {
    return [
      {
        field: 'input/continueFrom/taskId',
        message: `Source task type '${source.taskType}' is not continuable; only freeform → freeform is supported in v1`,
        code: 'freeform.sourceTaskTypeNotSupported',
      },
    ];
  }

  // Stable check: workspace mode for a continuation is derived by the
  // daemon from parent runtime context. A caller-supplied execution.workspace
  // would be silently overridden at the daemon plan stage, so reject it at
  // create time rather than let it look honored.
  const execution = (input as Partial<FreeformInput>).execution;
  if (execution?.workspace) {
    return [
      {
        field: 'input/execution/workspace',
        message:
          'execution.workspace is derived from parent runtime context when continueFrom is set; omit it',
        code: 'freeform.executionWorkspaceNotInheritable',
      },
    ];
  }

  // Readiness check: parent attempt completed. When
  // `ctx.deferReadinessChecks` is true
  // (set by task-service when the create carries an unsatisfied
  // claim condition such as the auto-injected `task_status: completed`
  // gate `tasks_continue` injects), these are re-evaluated when the
  // claim condition is later checked. Skipping them here lets callers
  // propose a continuation against a still-running parent — the
  // claim-time recheck is the real gate.
  if (ctx.deferReadinessChecks) return [];

  const attempts = await ctx.listAttempts(cf.taskId);
  const attempt = attempts.find((a) => a.attemptN === cf.attemptN);
  if (!attempt || attempt.status !== 'completed') {
    return [
      {
        field: 'input/continueFrom/attemptN',
        message: `Source attempt ${cf.attemptN} on task ${cf.taskId} is not in 'completed' state`,
        code: 'freeform.sourceAttemptNotCompleted',
      },
    ];
  }

  return [];
}
