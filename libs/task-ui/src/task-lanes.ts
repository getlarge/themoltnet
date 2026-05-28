import type { TaskStatus, TaskSummary } from './types.js';

export type TaskLaneId = 'pending' | 'active' | 'done' | 'failed' | 'closed';

export interface TaskLane {
  id: TaskLaneId;
  title: string;
  /** Signal tone used for the lane dot + funnel number. */
  tone: 'info' | 'primary' | 'success' | 'error' | 'muted';
  statuses: TaskStatus[];
}

export const TASK_LANES: TaskLane[] = [
  {
    id: 'pending',
    title: 'Pending',
    tone: 'info',
    statuses: ['waiting', 'queued'],
  },
  {
    id: 'active',
    title: 'Active',
    tone: 'primary',
    statuses: ['dispatched', 'running'],
  },
  { id: 'done', title: 'Done', tone: 'success', statuses: ['completed'] },
  { id: 'failed', title: 'Failed', tone: 'error', statuses: ['failed'] },
  {
    id: 'closed',
    title: 'Closed',
    tone: 'muted',
    statuses: ['cancelled', 'expired'],
  },
];

const STATUS_TO_LANE: Record<TaskStatus, TaskLaneId> = Object.fromEntries(
  TASK_LANES.flatMap((lane) =>
    lane.statuses.map((status) => [status, lane.id]),
  ),
) as Record<TaskStatus, TaskLaneId>;

export function statusToLane(status: TaskStatus): TaskLaneId {
  return STATUS_TO_LANE[status];
}

export type GroupedTasks = Record<TaskLaneId, TaskSummary[]>;

export function groupTasksByLane(tasks: TaskSummary[]): GroupedTasks {
  const grouped: GroupedTasks = {
    pending: [],
    active: [],
    done: [],
    failed: [],
    closed: [],
  };
  for (const task of tasks) {
    grouped[statusToLane(task.status)].push(task);
  }
  return grouped;
}
