import { DBOS } from '@dbos-inc/dbos-sdk';

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

const DISPATCH_TIMEOUT_SECONDS = 120;
const RUNNING_TIMEOUT_SECONDS = 3600;

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

  // Split into two steps so each is independently idempotent under retry.
  // insertAttemptStep uses ON CONFLICT DO NOTHING guard via the unique index
  // on workflow_id — if the INSERT already succeeded on a prior attempt, the
  // re-run is a no-op and the step proceeds to the UPDATE safely.
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

  const markRunningStep = DBOS.registerStep(
    async (
      taskId: string,
      attemptN: number,
      leaseTtlSec: number,
    ): Promise<void> => {
      const leaseExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
      await getDeps().updateAttempt(taskId, attemptN, {
        status: 'running',
        startedAt: new Date(),
      });
      await getDeps().updateTaskStatus(taskId, 'running', {
        claimExpiresAt: leaseExpiresAt,
      });
    },
    { name: 'task.step.markRunning', ...stepConfig },
  );

  const persistResultStep = DBOS.registerStep(
    async (
      taskId: string,
      attemptN: number,
      agentId: string,
      result: TaskAttemptResult,
      maxAttempts: number,
      attemptCount: number,
    ): Promise<TaskAttemptFinalEvent> => {
      const now = new Date();
      await getDeps().updateAttempt(taskId, attemptN, {
        status: result.kind,
        completedAt: now,
        output: result.output ?? null,
        outputCid: result.outputCid ?? null,
        error: result.error ?? null,
        usage: result.usage ?? null,
      });
      await getDeps().removeClaimantTuple(taskId, agentId);

      if (result.kind === 'completed') {
        await getDeps().updateTaskStatus(taskId, 'completed', {
          completedAt: now,
          acceptedAttemptN: attemptN,
          claimAgentId: null,
          claimExpiresAt: null,
        });
        return { status: 'completed', taskId, attemptN, output: result.output };
      }

      // failed or cancelled — re-queue if attempts remain
      const canRetry = result.kind === 'failed' && attemptCount < maxAttempts;
      await getDeps().updateTaskStatus(
        taskId,
        canRetry ? 'queued' : result.kind,
        { claimAgentId: null, claimExpiresAt: null },
      );
      return { status: result.kind, taskId, attemptN };
    },
    { name: 'task.step.persistResult', ...stepConfig },
  );

  const markTimedOutStep = DBOS.registerStep(
    async (
      taskId: string,
      attemptN: number,
      agentId: string,
      maxAttempts: number,
      attemptCount: number,
    ): Promise<void> => {
      await getDeps().updateAttempt(taskId, attemptN, {
        status: 'timed_out',
        completedAt: new Date(),
      });
      await getDeps().removeClaimantTuple(taskId, agentId);
      const canRetry = attemptCount < maxAttempts;
      await getDeps().updateTaskStatus(taskId, canRetry ? 'queued' : 'failed', {
        claimAgentId: null,
        claimExpiresAt: null,
      });
    },
    { name: 'task.step.markTimedOut', ...stepConfig },
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
          await markTimedOutStep(
            taskId,
            attemptN,
            agentId,
            maxAttempts,
            attemptCount,
          );
          const event: TaskAttemptFinalEvent = {
            status: 'timed_out',
            taskId,
            attemptN,
          };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        await markRunningStep(taskId, attemptN, leaseTtlSec);
        await DBOS.setEvent('running', { taskId, attemptN });

        const result = await DBOS.recv<TaskAttemptResult>(
          'result',
          RUNNING_TIMEOUT_SECONDS,
        );
        if (!result) {
          const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
          await markTimedOutStep(
            taskId,
            attemptN,
            agentId,
            maxAttempts,
            attemptCount,
          );
          const event: TaskAttemptFinalEvent = {
            status: 'timed_out',
            taskId,
            attemptN,
          };
          await DBOS.setEvent<TaskAttemptFinalEvent>('result', event);
          return event;
        }

        const { attemptCount, maxAttempts } = await getRetryInfoStep(taskId);
        return persistResultStep(
          taskId,
          attemptN,
          agentId,
          result,
          maxAttempts,
          attemptCount,
        );
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
