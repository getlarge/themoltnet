import type { ReviewEvidence } from '@moltnet/complexity-review/evidence';
import { createSleepingContext, type Git } from '@moltnet/docs-impact-review';
import {
  type TaskClient,
  TaskOutcomeError,
  waitForAcceptedTask,
} from '@themoltnet/tasks-orchestrator';

import type { TaskBudget } from './config.js';
import type { ChangedPath, Lane, ReviewIdentity } from './core.js';
import type { AdaptivePolicy } from './policy.js';
import { WorkerUnavailableError } from './workers.js';

/** Inline diff budget shared by the focused and security briefs. */
export const MAX_FOCUSED_DIFF_BYTES = 120_000;

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
  }>;
  unclear?: string[];
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
  if (reason.message.startsWith('missing task budget for enabled '))
    return 'missing-budget';
  if (/^invalid (tests|conventions|blast-radius) result$/.test(reason.message))
    return 'invalid-focused-result';
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
  process.stderr.write(
    `Adaptive lane failure: lane=${lane} stage=${stage} code=${code} taskIds=${taskIds.join(',') || 'none'}\n`,
  );
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
