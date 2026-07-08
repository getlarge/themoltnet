import type { Task as DbTask } from '@moltnet/database';
import {
  DELETE_ELIGIBLE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
} from '@moltnet/task-workflows';
import type { TaskAttempt, TaskValidationError } from '@moltnet/tasks';

export const EVENT_TIMEOUT_SECONDS = 10;
export const DEFAULT_LEASE_TTL_SEC = 300;

export const TERMINAL_STATUSES = new Set<DbTask['status']>(
  TERMINAL_TASK_STATUSES,
);

export const DELETE_ELIGIBLE_STATUSES = new Set<DbTask['status']>(
  DELETE_ELIGIBLE_TASK_STATUSES,
);

export const LIVE_STATUSES = new Set<DbTask['status']>([
  'waiting',
  'queued',
  'dispatched',
  'running',
]);

export const ATTEMPT_TERMINAL_STATUSES = new Set<TaskAttempt['status']>([
  'completed',
  'failed',
  'cancelled',
  'aborted',
  'timed_out',
]);

export class TaskServiceError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'conflict'
      | 'forbidden'
      | 'invalid'
      | 'timed_out'
      | 'unknown_task_type',
    message: string,
    public readonly validationErrors?: TaskValidationError[],
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

export function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === '23505' || e.cause?.code === '23505';
}

export function taskWorkflowId(taskId: string, attemptN: number): string {
  return `task:${taskId}:attempt:${attemptN}`;
}

export function assertActiveTaskLease(
  task: DbTask,
  callerId: string,
  message: string,
): void {
  if (task.claimAgentId !== callerId) {
    throw new TaskServiceError('forbidden', message);
  }
  if (!task.claimExpiresAt || task.claimExpiresAt.getTime() <= Date.now()) {
    throw new TaskServiceError('conflict', 'Task claim lease has expired');
  }
}

export function normalizeTaskTitle(
  title: string | null | undefined,
): string | null {
  const trimmed = title?.trim();
  return trimmed || null;
}

export function normalizeTaskTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags ?? []) {
    const value = tag.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}
