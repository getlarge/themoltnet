import type { ReviewEvidence } from '@moltnet/complexity-review/evidence';
import { createSleepingContext, type Git } from '@moltnet/docs-impact-review';
import { workflowCommandValue } from '@moltnet/docs-impact-review/workflow-command';
import {
  createFreeformRepairTask,
  type SdkTask,
  type TaskClient,
  TaskOutcomeError,
  waitForAcceptedTask,
  waitForValidatedTask,
} from '@themoltnet/tasks-orchestrator';

import type { TaskBudget } from './config.js';
import type { ChangedPath, Lane, ReviewIdentity } from './core.js';
import type { AdaptivePolicy } from './policy.js';
import type { PriorFindingOutcome } from './prior-findings.js';
import type { PreviousFinding } from './threads.js';
import { WorkerUnavailableError } from './workers.js';

/** Inline diff budget shared by the focused and security briefs. */
export const MAX_INLINE_DIFF_BYTES = 120_000;

export interface LaneResult {
  lane: Lane;
  status: 'clear' | 'concern' | 'unclear' | 'failed' | 'screened';
  summary: string;
  taskIds: string[];
  findings: Array<{
    path: string;
    side?: 'old' | 'new';
    line?: number;
    concern: string;
    action?: string;
    existingFindingKey?: string;
  }>;
  unclear?: string[];
  priorFindingOutcomes?: PriorFindingOutcome[];
}

/** Everything one lane needs to review the pinned revision. */
export interface LaneContext {
  identity: ReviewIdentity;
  git: Git;
  evidence: ReviewEvidence;
  changes: readonly ChangedPath[];
  policy: AdaptivePolicy;
  /** Project-scoped and worker-guarded; records the IDs it creates. */
  tasks: TaskClient;
  profileId: string;
  budget: TaskBudget;
  projectId?: string;
  previousFindings?: readonly PreviousFinding[];
}

export function laneFailureCode(reason: unknown): string {
  if (!(reason instanceof Error)) return 'non-error-rejection';
  if (reason instanceof WorkerUnavailableError) return 'worker-unavailable';
  if (reason instanceof TaskOutcomeError && reason.kind === 'failed') {
    // The executor sets the attempt code; keep it to a log-safe slug.
    const code = reason.attemptErrorCode
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
    return code ? `task-${code}` : 'task-failed';
  }
  if (reason.message === 'invalid complexity rubric')
    return 'invalid-complexity-rubric';
  if (reason.message.startsWith('missing runtime profile for enabled '))
    return 'missing-profile';
  if (
    /^invalid (tests|conventions|blast-radius|performance) result$/.test(
      reason.message,
    )
  )
    return 'invalid-focused-result';
  if (
    /^invalid (tests|conventions|blast-radius|performance) prior finding outcomes:/.test(
      reason.message,
    )
  )
    return 'invalid-prior-finding-outcomes';
  if (/ finding does not cite a changed line$/.test(reason.message))
    return 'invalid-finding-citation';
  if (reason.message === 'accepted freeform task has no result')
    return 'missing-task-result';
  if (reason instanceof TaskOutcomeError) return 'invalid-task-output';
  // SDK errors carry `statusCode`; other HTTP clients use `status`.
  const { status, statusCode } = reason as Error & {
    status?: unknown;
    statusCode?: unknown;
  };
  const http = statusCode ?? status;
  if (typeof http === 'number' && Number.isInteger(http) && http >= 400)
    return `http-${http}`;
  if (reason.name === 'NetworkError') return 'network-error';
  return reason.name === 'TypeError' ? 'type-error' : 'unexpected-error';
}

export function logLaneFailure(
  lane: string,
  taskIds: string[],
  code: string,
  stage = taskIds.length ? 'task-outcome' : 'before-task',
): void {
  // Report errors can contain untrusted PR text or credentials. Log only
  // fixed diagnostic fields and task IDs; never log the raw error.
  const fields = `lane=${lane} stage=${stage} code=${code} taskIds=${taskIds.join(',') || 'none'}`;
  process.stderr.write(`Adaptive lane failure: ${fields}\n`);
  process.stdout.write(
    `::error title=Adaptive lane failed::${workflowCommandValue(fields)}\n`,
  );
}

/** Passes every call through, running `hook` after each task is created. */
export function withCreateHook(
  tasks: TaskClient,
  hook: (
    task: Awaited<ReturnType<TaskClient['createTask']>>,
    body: Parameters<TaskClient['createTask']>[0],
  ) => void,
): TaskClient {
  const listMessages = tasks.listMessages?.bind(tasks);
  return {
    async createTask(body, options) {
      const task = await tasks.createTask(body, options);
      hook(task, body);
      return task;
    },
    getTask: (id) => tasks.getTask(id),
    listAttempts: (id) => tasks.listAttempts(id),
    ...(listMessages ? { listMessages } : {}),
  };
}

export function logClassifierFailure(
  packetId: string,
  taskId: string | undefined,
  code: string,
): void {
  // Same rule as lane failures: fixed fields only, never the raw error.
  process.stderr.write(
    `Adaptive classifier failure: packet=${packetId} stage=${taskId ? 'task-outcome' : 'before-task'} code=${code} taskId=${taskId ?? 'none'}\n`,
  );
}

export function unwrap(output: unknown): unknown {
  if (typeof output !== 'object' || output === null || !('result' in output)) {
    throw new Error('accepted freeform task has no result');
  }
  return output.result;
}

export async function accepted<T>(
  tasks: TaskClient,
  id: string,
  parse: (output: unknown) => T,
): Promise<T> {
  const result = await waitForAcceptedTask(id, {
    tasks,
    ctx: createSleepingContext(),
    pollIntervalSec: 2,
    parse,
  });
  return result.state;
}

/** One semantic correction; execution failures and exhausted repairs stay failures. */
export async function acceptedReview<T>(
  tasks: TaskClient,
  task: SdkTask,
  body: Parameters<TaskClient['createTask']>[0],
  taskIds: string[],
  parse: (output: unknown) => T,
): Promise<T> {
  taskIds.push(task.id);
  const outcome = await waitForValidatedTask(task, {
    tasks,
    ctx: { ...createSleepingContext(), executionId: task.id },
    pollIntervalSec: 2,
    parse,
    maxRepairs: 1,
    createRepairTask: async (args) => {
      const repair = await createFreeformRepairTask(tasks, body, args);
      taskIds.push(repair.id);
      return repair;
    },
  });
  if (outcome.kind === 'accepted') return outcome.result.state;
  throw new TaskOutcomeError(
    outcome.task.id,
    outcome.kind === 'failed'
      ? outcome
      : { ...outcome, kind: 'invalid_output' },
  );
}
