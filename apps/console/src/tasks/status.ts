import type { TaskStatus } from '@moltnet/api-client';

export const TASK_STATUS_FILTERS: TaskStatus[] = [
  'waiting',
  'queued',
  'dispatched',
  'running',
  'completed',
  'failed',
  'cancelled',
  'expired',
];

export function getTaskStatusQuery(
  value: string | null,
): TaskStatus | undefined {
  if (!value) return undefined;
  return TASK_STATUS_FILTERS.includes(value as TaskStatus)
    ? (value as TaskStatus)
    : undefined;
}

export {
  type GroupedTasks,
  groupTasksByLane,
  statusToLane,
  TASK_LANES,
  type TaskLane,
  type TaskLaneId,
} from '@moltnet/task-ui';
