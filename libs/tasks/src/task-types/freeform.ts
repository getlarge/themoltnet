import { type Static, Type } from '@sinclair/typebox';

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
     * v1 wire schema only. `'extend'` (default) resumes the parent slot in
     * place. `'fork'` is the API surface for the future copy-on-write
     * continuation tracked in #1293; v1 server-side validator rejects it.
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
    /**
     * Optional operator-facing title. The brief remains the source of truth
     * for exploratory intent.
     */
    title: Type.Optional(Type.String({ minLength: 1 })),
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
     * When set, the daemon treats this task as a warm-resume continuation
     * of the named source attempt. See docs/superpowers/specs/2026-06-04-
     * tasks-continue-design.md.
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
 * resume a prior freeform attempt's warm slot (#1287).
 *
 * Failure modes, in evaluation order:
 *  1. `freeform.sourceTaskNotFound` — source task id does not resolve
 *     (does not exist OR caller can't read it; we don't distinguish).
 *  2. `freeform.sourceTaskTypeNotSupported` — source isn't `freeform`.
 *     v1 only supports freeform → freeform continuation.
 *  3. `freeform.sourceAttemptNotCompleted` — named attempt is missing
 *     or not in `completed` state; warm continuation only makes sense
 *     once the parent has produced a terminal output.
 *  4. `freeform.forkModeNotImplemented` — `mode: 'fork'` is the wire
 *     surface for copy-on-write continuation tracked in #1293; v1
 *     rejects it server-side so daemons never have to branch.
 *  5. `freeform.executionWorkspaceNotInheritable` — caller set
 *     `execution.workspace` together with `continueFrom`. Workspace
 *     mode for a continuation is inherited from the parent slot
 *     (`maybeAttachWarmSlotContext` forces `dedicated_worktree` +
 *     the parent's worktreeBranch), so any caller-supplied override
 *     is silently dropped at the daemon plan stage. Reject explicitly
 *     so misconfiguration surfaces at create time.
 *  6. `freeform.sourceNotResumeEligible` — `daemonState` is null or
 *     `slotResumableUntil` is null. Older completions (pre-#1287) and
 *     daemons that opt out fall here.
 *  7. `freeform.sourceResumeExpired` — `slotResumableUntil` is in the
 *     past; the warm slot's TTL has elapsed and no daemon is
 *     guaranteed to still hold it.
 *
 * Returns on the first failure (no "report all six") — the checks
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

  // Stable check: fork mode rejection doesn't depend on parent runtime
  // state. Fires even when readiness checks are deferred (e.g. a
  // continuation proposed with a `task_status: completed` claim
  // condition while the parent is still running) so callers learn the
  // mode is invalid at create time rather than at claim time.
  if (cf.mode === 'fork') {
    return [
      {
        field: 'input/continueFrom/mode',
        message:
          'fork mode not yet implemented; see https://github.com/getlarge/themoltnet/issues/1293',
        code: 'freeform.forkModeNotImplemented',
      },
    ];
  }

  // Stable check: workspace mode for a continuation is inherited from
  // the parent slot via maybeAttachWarmSlotContext (forces
  // dedicated_worktree + the parent's worktreeBranch). A caller-supplied
  // execution.workspace would be silently overridden at the daemon plan
  // stage, so reject it at create time rather than let it look honored.
  const execution = (input as { execution?: { workspace?: string } }).execution;
  if (execution && execution.workspace) {
    return [
      {
        field: 'input/execution/workspace',
        message:
          'execution.workspace is inherited from the parent slot when continueFrom is set; omit it',
        code: 'freeform.executionWorkspaceNotInheritable',
      },
    ];
  }

  // Readiness checks: parent attempt completed, daemon-reported
  // eligibility, fresh TTL. When `ctx.deferReadinessChecks` is true
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

  if (!attempt.daemonState || attempt.daemonState.slotResumableUntil === null) {
    return [
      {
        field: 'input/continueFrom',
        message:
          'Source attempt did not report continuation eligibility (older completion or daemon opted out)',
        code: 'freeform.sourceNotResumeEligible',
      },
    ];
  }

  const expiresAt = new Date(attempt.daemonState.slotResumableUntil).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    return [
      {
        field: 'input/continueFrom',
        message: `Source attempt's warm slot expired at ${attempt.daemonState.slotResumableUntil} (reported at ${attempt.daemonState.reportedAt})`,
        code: 'freeform.sourceResumeExpired',
      },
    ];
  }

  return [];
}
