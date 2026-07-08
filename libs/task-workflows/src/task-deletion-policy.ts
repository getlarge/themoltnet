import type { Task } from '@moltnet/database';

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

export interface TaskDeletionCandidateClassification<
  T extends Pick<Task, 'id' | 'status'>,
> {
  deleteEligibleTasks: T[];
  terminalTaskIds: string[];
}

export function classifyTaskDeletionCandidates<
  T extends Pick<Task, 'id' | 'status'>,
>(tasks: readonly T[]): TaskDeletionCandidateClassification<T> {
  const deleteEligibleTasks = tasks.filter((task) =>
    isDeleteEligibleTaskStatus(task.status),
  );
  return {
    deleteEligibleTasks,
    terminalTaskIds: deleteEligibleTasks
      .filter((task) => isTerminalTaskStatus(task.status))
      .map((task) => task.id),
  };
}

export interface TaskDeletionPlan<T extends Pick<Task, 'id' | 'status'>> {
  acceptedTasks: T[];
  acceptedIds: string[];
  forceDeleteSealedTaskIds: string[];
  skipped: string[];
  skippedProtected: number;
}

export function buildTaskDeletionPlan<
  T extends Pick<Task, 'id' | 'status'>,
>(input: {
  requestedIds: readonly string[];
  deleteEligibleTasks: readonly T[];
  sealedTaskIds: readonly string[];
  forceDeleteAllowedTaskIds?: readonly string[];
}): TaskDeletionPlan<T> {
  const uniqueIds = [...new Set(input.requestedIds)];
  const sealedIdSet = new Set(input.sealedTaskIds);
  const forceAllowedIdSet = new Set(input.forceDeleteAllowedTaskIds ?? []);
  const acceptedTasks = input.deleteEligibleTasks.filter(
    (task) => !sealedIdSet.has(task.id) || forceAllowedIdSet.has(task.id),
  );
  const acceptedIdSet = new Set(acceptedTasks.map((task) => task.id));
  const forceDeleteSealedTaskIds = input.deleteEligibleTasks
    .filter(
      (task) => sealedIdSet.has(task.id) && forceAllowedIdSet.has(task.id),
    )
    .map((task) => task.id);

  return {
    acceptedTasks,
    acceptedIds: uniqueIds.filter((id) => acceptedIdSet.has(id)),
    forceDeleteSealedTaskIds,
    skipped: uniqueIds.filter((id) => !acceptedIdSet.has(id)),
    skippedProtected: input.deleteEligibleTasks.filter(
      (task) => sealedIdSet.has(task.id) && !forceAllowedIdSet.has(task.id),
    ).length,
  };
}
