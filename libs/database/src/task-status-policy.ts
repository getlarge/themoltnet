import type { Task } from './schema.js';

export const TERMINAL_TASK_STATUSES = [
  'completed',
  'failed',
  'cancelled',
  'expired',
] as const satisfies readonly Task['status'][];

export const DELETE_ELIGIBLE_TASK_STATUSES = [
  'waiting',
  'queued',
  ...TERMINAL_TASK_STATUSES,
] as const satisfies readonly Task['status'][];

export function isTerminalTaskStatus(
  status: Task['status'],
): status is (typeof TERMINAL_TASK_STATUSES)[number] {
  return (TERMINAL_TASK_STATUSES as readonly Task['status'][]).includes(status);
}

export function isDeleteEligibleTaskStatus(
  status: Task['status'],
): status is (typeof DELETE_ELIGIBLE_TASK_STATUSES)[number] {
  return (DELETE_ELIGIBLE_TASK_STATUSES as readonly Task['status'][]).includes(
    status,
  );
}
