import { DBOS } from '@dbos-inc/dbos-sdk';

import type { DataSource } from '../dbos.js';
import type { NewTaskAttempt, Task, TaskAttempt } from '../schema.js';

/**
 * Discriminated event sent from the HTTP layer (heartbeat / complete /
 * fail / cancel) to the running workflow over a single multiplexed
 * `progress` topic (#936). The workflow's recv loop dispatches on
 * `kind`; the union shape replaces the older two-topic
 * (`started` + `result`) state machine.
 */
export type TaskProgressEvent =
  | { kind: 'started'; leaseTtlSec?: number }
  | { kind: 'heartbeat'; leaseTtlSec?: number }
  | {
      kind: 'completed';
      output?: unknown;
      outputCid?: string;
      completedExecutorFingerprint?: string;
      usage?: unknown;
    }
  | { kind: 'failed'; error?: unknown }
  | { kind: 'cancelled'; error?: unknown };

/**
 * @deprecated Retained as the wire-shape contract for the persist tx
 * branches inside the workflow. New senders should use
 * `TaskProgressEvent` (the multiplexed `progress` topic). Will be
 * removed after the running-phase loop stabilises.
 */
export interface TaskAttemptResult {
  kind: 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  outputCid?: string;
  completedExecutorFingerprint?: string;
  error?: unknown;
  usage?: unknown;
}

export interface TaskAttemptClaimedEvent {
  taskId: string;
  attemptN: number;
}

export interface TaskAttemptFinalEvent {
  status: 'completed' | 'failed' | 'cancelled' | 'timed_out';
  taskId: string;
  attemptN: number;
  output?: unknown;
  /**
   * For `timed_out` events, distinguishes which budget ran out:
   * - `dispatch_expired` — first heartbeat never arrived
   * - `lease_expired` — heartbeat silence exceeded the worker-set lease
   * - `running_total_exceeded` — task ran longer than runningTimeoutSec
   *   even with healthy heartbeats
   */
  timeoutReason?:
    | 'dispatch_expired'
    | 'lease_expired'
    | 'running_total_exceeded';
}

export interface TaskWorkflowDeps {
  dataSource: DataSource;
  createAttempt(input: NewTaskAttempt): Promise<TaskAttempt>;
  updateAttempt(
    taskId: string,
    attemptN: number,
    fields: Partial<
      Pick<
        TaskAttempt,
        | 'status'
        | 'startedAt'
        | 'completedAt'
        | 'output'
        | 'outputCid'
        | 'claimedExecutorFingerprint'
        | 'completedExecutorFingerprint'
        | 'error'
        | 'usage'
      >
    >,
  ): Promise<TaskAttempt | null>;
  updateTaskStatus(
    taskId: string,
    status: Task['status'],
    extra?: Partial<
      Pick<
        Task,
        'completedAt' | 'acceptedAttemptN' | 'claimAgentId' | 'claimExpiresAt'
      >
    >,
  ): Promise<Task | null>;
  removeClaimantTuple(taskId: string, agentId: string): Promise<void>;
  countAttempts(taskId: string): Promise<number>;
  getMaxAttempts(taskId: string): Promise<number>;
  /**
   * Read the current task row. Used by timeout branches to detect
   * a cancel that landed on the row while the workflow was parked
   * (#938) and avoid overwriting `cancelled` with `queued`/`failed`.
   */
  findTaskById(taskId: string): Promise<Task | null>;
}

export class TaskWorkflowConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TaskWorkflowConfigurationError';
  }
}

// Time for a claimed agent to send the 'started' signal after picking up a task.
// Short tasks (tool calls, lookups): 120s is fine. For queued evals or brief
// fulfillment that may need to spin up a runtime, consider raising to 600s+
// via the leaseTtlSec parameter passed to startAttemptWorkflow.
//
// These are *defaults* — the imposer can override per-task at create time
// via tasks.dispatch_timeout_sec / running_timeout_sec, which are passed
// through to startAttemptWorkflow as `dispatchTimeoutSecOverride` and
// `runningTimeoutSecOverride`.
export const DEFAULT_DISPATCH_TIMEOUT_SECONDS = 300;
// Maximum wall-clock time between 'started' and result delivery.
// Long-running evals (brief fulfillment, judgment) can take 30–60 min.
// Agents must heartbeat (extend the lease) before this elapses to signal liveness.
export const DEFAULT_RUNNING_TIMEOUT_SECONDS = 7200;

const stepConfig = {
  retriesAllowed: true,
  maxAttempts: 3,
  intervalSeconds: 2,
  backoffRate: 2,
};

let workflowDeps: TaskWorkflowDeps | null = null;
let _workflows: {
  startAttemptWorkflow: (
    taskId: string,
    attemptN: number,
    agentId: string,
    workflowId: string,
    leaseTtlSec: number,
    claimedExecutorFingerprint?: string | null,
    dispatchTimeoutSecOverride?: number | null,
    runningTimeoutSecOverride?: number | null,
  ) => Promise<TaskAttemptFinalEvent>;
} | null = null;

function getDeps(): TaskWorkflowDeps {
  if (!workflowDeps) {
    throw new TaskWorkflowConfigurationError(
      'Task workflow deps not set. Call setTaskWorkflowDeps() before using task workflows.',
    );
  }
  return workflowDeps;
}

export function setTaskWorkflowDeps(deps: TaskWorkflowDeps): void {
  workflowDeps = deps;
}

export function initTaskWorkflows(): void {
  if (_workflows) return;

  // Single-write steps — no transaction needed, each is naturally idempotent.
  const insertAttemptStep = DBOS.registerStep(
    async (
      taskId: string,
      attemptN: number,
      agentId: string,
      workflowId: string,
      claimedExecutorFingerprint?: string | null,
    ): Promise<void> => {
      await getDeps().createAttempt({
        taskId,
        attemptN,
        claimedByAgentId: agentId,
        workflowId,
        status: 'claimed',
        claimedExecutorFingerprint: claimedExecutorFingerprint ?? null,
      });
    },
    { name: 'task.step.insertAttempt', ...stepConfig },
  );

  const dispatchTaskStep = DBOS.registerStep(
    async (
      taskId: string,
      agentId: string,
      leaseTtlSec: number,
    ): Promise<void> => {
      const leaseExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
      await getDeps().updateTaskStatus(taskId, 'dispatched', {
        claimAgentId: agentId,
        claimExpiresAt: leaseExpiresAt,
      });
    },
    { name: 'task.step.dispatchTask', ...stepConfig },
  );

  const removeClaimantTupleStep = DBOS.registerStep(
    async (taskId: string, agentId: string): Promise<void> => {
      // Keto tuple removal — best-effort, orphaned tuples cleaned up by Phase 3.
      await getDeps().removeClaimantTuple(taskId, agentId);
    },
    { name: 'task.step.removeClaimantTuple', ...stepConfig },
  );

  // Wraps countAttempts + getMaxAttempts in a step so results are recorded in
  // the DBOS event log and not re-fetched on workflow replay (determinism).
  const getRetryInfoStep = DBOS.registerStep(
    async (
      taskId: string,
    ): Promise<{ attemptCount: number; maxAttempts: number }> => {
      const [attemptCount, maxAttempts] = await Promise.all([
        getDeps().countAttempts(taskId),
        getDeps().getMaxAttempts(taskId),
      ]);
      return { attemptCount, maxAttempts };
    },
    { name: 'task.step.getRetryInfo', ...stepConfig },
  );

  _workflows = {
    startAttemptWorkflow: DBOS.registerWorkflow(
      async (
        taskId: string,
        attemptN: number,
        agentId: string,
        workflowId: string,
        leaseTtlSec: number,
        claimedExecutorFingerprint?: string | null,
        dispatchTimeoutSecOverride?: number | null,
        runningTimeoutSecOverride?: number | null,
      ): Promise<TaskAttemptFinalEvent> => {
        const dispatchTimeoutSec =
          dispatchTimeoutSecOverride ?? DEFAULT_DISPATCH_TIMEOUT_SECONDS;
        const runningTimeoutSec =
          runningTimeoutSecOverride ?? DEFAULT_RUNNING_TIMEOUT_SECONDS;
        // Steps 1-2: insert attempt row, mark task dispatched (split for idempotency).
        await insertAttemptStep(
          taskId,
          attemptN,
          agentId,
          workflowId,
          claimedExecutorFingerprint,
        );
        await dispatchTaskStep(taskId, agentId, leaseTtlSec);
        await DBOS.setEvent<TaskAttemptClaimedEvent>('claimed', {
          taskId,
          attemptN,
        });

        // Helper: if the row was already moved to a terminal state by an
        // out-of-band actor (cancel(), a peer worker reaching it first),
        // we must NOT clobber it with queued/failed. The dispatch and
        // running-timeout branches both call this, then preserve task
        // status while still recording the attempt outcome.
        const checkExternalTerminal = async () => {
          const taskNow = await getDeps().findTaskById(taskId);
          const isTerminal =
            taskNow !== null &&
            (taskNow.status === 'cancelled' ||
              taskNow.status === 'completed' ||
              taskNow.status === 'failed' ||
              taskNow.status === 'expired');
          return { taskNow, isTerminal };
        };

        // ── Dispatch phase ─────────────────────────────────────────────
        // Wait for the first event on the multiplexed `progress` topic.
        // Expected kinds here: `started`, `cancelled`. If the event is
        // missing the dispatch budget elapsed without the worker doing
        // anything (`dispatch_expired`).
        const firstEvent = await DBOS.recv<TaskProgressEvent>(
          'progress',
          dispatchTimeoutSec,
        );

        if (!firstEvent || firstEvent.kind === 'cancelled') {
          const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
          const canRetry = !firstEvent && attemptCount < maxAttempts;
          const { taskNow, isTerminal } = await checkExternalTerminal();
          await getDeps().dataSource.runTransaction(
            async () => {
              await getDeps().updateAttempt(taskId, attemptN, {
                status:
                  firstEvent?.kind === 'cancelled' ? 'cancelled' : 'timed_out',
                completedAt: new Date(),
                error:
                  firstEvent?.kind === 'cancelled'
                    ? (firstEvent.error ?? null)
                    : null,
              });
              if (!isTerminal) {
                await getDeps().updateTaskStatus(
                  taskId,
                  firstEvent?.kind === 'cancelled'
                    ? 'cancelled'
                    : canRetry
                      ? 'queued'
                      : 'failed',
                  { claimAgentId: null, claimExpiresAt: null },
                );
              } else {
                await getDeps().updateTaskStatus(taskId, taskNow!.status, {
                  claimAgentId: null,
                  claimExpiresAt: null,
                });
              }
            },
            { name: 'task.tx.markDispatchTerminal' },
          );
          await removeClaimantTupleStep(taskId, agentId);
          const finalStatus: TaskAttemptFinalEvent['status'] =
            firstEvent?.kind === 'cancelled'
              ? 'cancelled'
              : isTerminal && taskNow!.status === 'cancelled'
                ? 'cancelled'
                : 'timed_out';
          const event: TaskAttemptFinalEvent = {
            status: finalStatus,
            taskId,
            attemptN,
            ...(finalStatus === 'timed_out'
              ? { timeoutReason: 'dispatch_expired' as const }
              : {}),
          };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        // First event was a result-shaped one (completed / failed)?
        // The HTTP layer's TERMINAL_STATUSES + claimed-status guards make
        // this rare in practice, but we accept it: skip the running phase
        // and persist directly. (Prior behaviour rejected with 409.)
        if (firstEvent.kind === 'completed' || firstEvent.kind === 'failed') {
          return persistTerminalResult(firstEvent);
        }

        // Otherwise: kind === 'started' (or 'heartbeat' from a runtime
        // that skipped 'started'). Either way we now have liveness.
        const startedAtMs = Date.now();
        let currentLeaseTtlSec =
          firstEvent.kind === 'started' || firstEvent.kind === 'heartbeat'
            ? (firstEvent.leaseTtlSec ?? leaseTtlSec)
            : leaseTtlSec;

        // Atomic: mark attempt running + extend lease on task together.
        const leaseExpiresAt = new Date(
          startedAtMs + currentLeaseTtlSec * 1000,
        );
        await getDeps().dataSource.runTransaction(
          async () => {
            await getDeps().updateAttempt(taskId, attemptN, {
              status: 'running',
              startedAt: new Date(startedAtMs),
            });
            await getDeps().updateTaskStatus(taskId, 'running', {
              claimExpiresAt: leaseExpiresAt,
            });
          },
          { name: 'task.tx.markRunning' },
        );
        await DBOS.setEvent('running', { taskId, attemptN });

        // ── Running phase: sliding-window loop ────────────────────────
        // Heartbeats refresh the lease. The total budget is fixed at
        // `runningTimeoutSec`; once exceeded the attempt ends with
        // `running_total_exceeded` even if heartbeats are still flowing.
        const totalDeadlineMs = startedAtMs + runningTimeoutSec * 1000;

        async function persistTerminalResult(
          evt:
            | (TaskProgressEvent & { kind: 'completed' })
            | (TaskProgressEvent & { kind: 'failed' })
            | (TaskProgressEvent & { kind: 'cancelled' }),
        ): Promise<TaskAttemptFinalEvent> {
          const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
          const canRetry = evt.kind === 'failed' && attemptCount < maxAttempts;
          const now = new Date();
          const { taskNow, isTerminal } = await checkExternalTerminal();
          await getDeps().dataSource.runTransaction(
            async () => {
              await getDeps().updateAttempt(taskId, attemptN, {
                status: evt.kind,
                completedAt: now,
                output: evt.kind === 'completed' ? (evt.output ?? null) : null,
                outputCid:
                  evt.kind === 'completed' ? (evt.outputCid ?? null) : null,
                completedExecutorFingerprint:
                  evt.kind === 'completed'
                    ? (evt.completedExecutorFingerprint ?? null)
                    : null,
                error:
                  evt.kind === 'failed' || evt.kind === 'cancelled'
                    ? (evt.error ?? null)
                    : null,
                usage: evt.kind === 'completed' ? (evt.usage ?? null) : null,
              });
              if (evt.kind === 'completed') {
                await getDeps().updateTaskStatus(taskId, 'completed', {
                  completedAt: now,
                  acceptedAttemptN: attemptN,
                  claimAgentId: null,
                  claimExpiresAt: null,
                });
              } else if (isTerminal) {
                await getDeps().updateTaskStatus(taskId, taskNow!.status, {
                  claimAgentId: null,
                  claimExpiresAt: null,
                });
              } else {
                await getDeps().updateTaskStatus(
                  taskId,
                  canRetry ? 'queued' : evt.kind,
                  { claimAgentId: null, claimExpiresAt: null },
                );
              }
            },
            { name: 'task.tx.persistResult' },
          );
          await removeClaimantTupleStep(taskId, agentId);
          const event: TaskAttemptFinalEvent =
            evt.kind === 'completed'
              ? { status: 'completed', taskId, attemptN, output: evt.output }
              : { status: evt.kind, taskId, attemptN };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        async function persistTimeout(
          reason: 'lease_expired' | 'running_total_exceeded',
        ): Promise<TaskAttemptFinalEvent> {
          const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
          const canRetry = attemptCount < maxAttempts;
          const { taskNow, isTerminal } = await checkExternalTerminal();
          await getDeps().dataSource.runTransaction(
            async () => {
              await getDeps().updateAttempt(taskId, attemptN, {
                status: 'timed_out',
                completedAt: new Date(),
                error: { code: reason, message: reason } as unknown,
              });
              if (!isTerminal) {
                await getDeps().updateTaskStatus(
                  taskId,
                  canRetry ? 'queued' : 'failed',
                  { claimAgentId: null, claimExpiresAt: null },
                );
              } else {
                await getDeps().updateTaskStatus(taskId, taskNow!.status, {
                  claimAgentId: null,
                  claimExpiresAt: null,
                });
              }
            },
            { name: 'task.tx.markRunningTimedOut' },
          );
          await removeClaimantTupleStep(taskId, agentId);
          const event: TaskAttemptFinalEvent = {
            status:
              isTerminal && taskNow!.status === 'cancelled'
                ? 'cancelled'
                : 'timed_out',
            taskId,
            attemptN,
            ...(event_status_is_timeout(isTerminal, taskNow)
              ? { timeoutReason: reason }
              : {}),
          };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        while (true) {
          const remainingMs = totalDeadlineMs - Date.now();
          if (remainingMs <= 0) {
            return persistTimeout('running_total_exceeded');
          }
          // Cap each recv at the lease ttl, but never wait past the
          // total budget (so `running_total_exceeded` fires promptly).
          const recvSec = Math.max(
            1,
            Math.min(currentLeaseTtlSec, Math.ceil(remainingMs / 1000)),
          );
          const evt = await DBOS.recv<TaskProgressEvent>('progress', recvSec);
          if (!evt) {
            // Timed out the recv. Distinguish: if the total budget is
            // also gone, that's `running_total_exceeded`; otherwise
            // it's a missed-heartbeat `lease_expired`.
            if (Date.now() >= totalDeadlineMs) {
              return persistTimeout('running_total_exceeded');
            }
            return persistTimeout('lease_expired');
          }
          if (evt.kind === 'heartbeat' || evt.kind === 'started') {
            // Started after we're already running is a duplicate from a
            // misbehaving client; treat it as a heartbeat to refresh the
            // lease anyway. heartbeat: refresh window.
            currentLeaseTtlSec = evt.leaseTtlSec ?? currentLeaseTtlSec;
            continue;
          }
          if (
            evt.kind === 'completed' ||
            evt.kind === 'failed' ||
            evt.kind === 'cancelled'
          ) {
            return persistTerminalResult(evt);
          }
          // Unknown kind — log and continue. DBOS replay determinism
          // requires we don't throw here on event content.
        }
      },
      { name: 'task.workflow.startAttempt' },
    ),
  };
}

// Helper outside the workflow body: a `timed_out` final event only
// carries `timeoutReason` when the attempt itself ran out (not when an
// external terminal status overrode it). Pulled out for readability.
function event_status_is_timeout(
  isTerminal: boolean,
  taskNow: Task | null,
): boolean {
  if (!isTerminal) return true;
  return taskNow?.status !== 'cancelled';
}

export const taskWorkflows = new Proxy(
  {},
  {
    get(_, prop) {
      if (!_workflows) {
        throw new TaskWorkflowConfigurationError(
          'Task workflows not initialized. Call initTaskWorkflows() first.',
        );
      }
      return _workflows[prop as keyof typeof _workflows];
    },
  },
) as {
  startAttemptWorkflow: (
    taskId: string,
    attemptN: number,
    agentId: string,
    workflowId: string,
    leaseTtlSec: number,
    claimedExecutorFingerprint?: string | null,
    dispatchTimeoutSecOverride?: number | null,
    runningTimeoutSecOverride?: number | null,
  ) => Promise<TaskAttemptFinalEvent>;
};

/** @internal Reset module state for testing. */
export function _resetTaskWorkflowsForTesting(): void {
  _workflows = null;
  workflowDeps = null;
}
