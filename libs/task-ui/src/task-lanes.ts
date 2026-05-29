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

/**
 * Statuses where a task is still progressing (pending + active lanes). Consumers
 * use this to decide whether to keep polling a task and its attempts — a task in
 * any of these can still transition (e.g. queued → dispatched → running), so the
 * live pane must keep refetching until the task is terminal.
 */
export const TASK_NON_TERMINAL_STATUSES: TaskStatus[] = TASK_LANES.filter(
  (lane) => lane.id === 'pending' || lane.id === 'active',
).flatMap((lane) => lane.statuses);

export function isTaskNonTerminal(status: TaskStatus): boolean {
  return TASK_NON_TERMINAL_STATUSES.includes(status);
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
