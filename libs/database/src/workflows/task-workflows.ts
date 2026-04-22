import { DBOS } from '@dbos-inc/dbos-sdk';

import type { DataSource } from '../dbos.js';
import type { NewTaskAttempt, Task, TaskAttempt } from '../schema.js';

export interface TaskAttemptResult {
  kind: 'completed' | 'failed' | 'cancelled';
  output?: unknown;
  outputCid?: string;
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
const DISPATCH_TIMEOUT_SECONDS = 300;
// Maximum wall-clock time between 'started' and result delivery.
// Long-running evals (brief fulfillment, judgment) can take 30–60 min.
// Agents must heartbeat (extend the lease) before this elapses to signal liveness.
const RUNNING_TIMEOUT_SECONDS = 7200;

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
    ): Promise<void> => {
      await getDeps().createAttempt({
        taskId,
        attemptN,
        claimedByAgentId: agentId,
        workflowId,
        status: 'claimed',
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
      ): Promise<TaskAttemptFinalEvent> => {
        // Steps 1-2: insert attempt row, mark task dispatched (split for idempotency).
        await insertAttemptStep(taskId, attemptN, agentId, workflowId);
        await dispatchTaskStep(taskId, agentId, leaseTtlSec);
        await DBOS.setEvent<TaskAttemptClaimedEvent>('claimed', {
          taskId,
          attemptN,
        });

        const started = await DBOS.recv<true>(
          'started',
          DISPATCH_TIMEOUT_SECONDS,
        );
        if (!started) {
          const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
          const canRetry = attemptCount < maxAttempts;
          // Atomic: mark attempt timed_out + re-queue or fail task together.
          await getDeps().dataSource.runTransaction(
            async () => {
              await getDeps().updateAttempt(taskId, attemptN, {
                status: 'timed_out',
                completedAt: new Date(),
              });
              await getDeps().updateTaskStatus(
                taskId,
                canRetry ? 'queued' : 'failed',
                { claimAgentId: null, claimExpiresAt: null },
              );
            },
            { name: 'task.tx.markDispatchTimedOut' },
          );
          await removeClaimantTupleStep(taskId, agentId);
          const event: TaskAttemptFinalEvent = {
            status: 'timed_out',
            taskId,
            attemptN,
          };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        // Atomic: mark attempt running + extend lease on task together.
        const leaseExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
        await getDeps().dataSource.runTransaction(
          async () => {
            await getDeps().updateAttempt(taskId, attemptN, {
              status: 'running',
              startedAt: new Date(),
            });
            await getDeps().updateTaskStatus(taskId, 'running', {
              claimExpiresAt: leaseExpiresAt,
            });
          },
          { name: 'task.tx.markRunning' },
        );
        await DBOS.setEvent('running', { taskId, attemptN });

        const result = await DBOS.recv<TaskAttemptResult>(
          'result',
          RUNNING_TIMEOUT_SECONDS,
        );
        if (!result) {
          const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
          const canRetry = attemptCount < maxAttempts;
          await getDeps().dataSource.runTransaction(
            async () => {
              await getDeps().updateAttempt(taskId, attemptN, {
                status: 'timed_out',
                completedAt: new Date(),
              });
              await getDeps().updateTaskStatus(
                taskId,
                canRetry ? 'queued' : 'failed',
                { claimAgentId: null, claimExpiresAt: null },
              );
            },
            { name: 'task.tx.markRunningTimedOut' },
          );
          await removeClaimantTupleStep(taskId, agentId);
          const event: TaskAttemptFinalEvent = {
            status: 'timed_out',
            taskId,
            attemptN,
          };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
        const canRetry = result.kind === 'failed' && attemptCount < maxAttempts;
        const now = new Date();
        // Atomic: persist attempt result + final task status together.
        await getDeps().dataSource.runTransaction(
          async () => {
            await getDeps().updateAttempt(taskId, attemptN, {
              status: result.kind,
              completedAt: now,
              output: result.output ?? null,
              outputCid: result.outputCid ?? null,
              error: result.error ?? null,
              usage: result.usage ?? null,
            });
            if (result.kind === 'completed') {
              await getDeps().updateTaskStatus(taskId, 'completed', {
                completedAt: now,
                acceptedAttemptN: attemptN,
                claimAgentId: null,
                claimExpiresAt: null,
              });
            } else {
              await getDeps().updateTaskStatus(
                taskId,
                canRetry ? 'queued' : result.kind,
                { claimAgentId: null, claimExpiresAt: null },
              );
            }
          },
          { name: 'task.tx.persistResult' },
        );
        await removeClaimantTupleStep(taskId, agentId);

        const event: TaskAttemptFinalEvent =
          result.kind === 'completed'
            ? { status: 'completed', taskId, attemptN, output: result.output }
            : { status: result.kind, taskId, attemptN };
        return event;
      },
      { name: 'task.workflow.startAttempt' },
    ),
  };
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
  ) => Promise<TaskAttemptFinalEvent>;
};

/** @internal Reset module state for testing. */
export function _resetTaskWorkflowsForTesting(): void {
  _workflows = null;
  workflowDeps = null;
}
