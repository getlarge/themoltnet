import {
  getTask,
  listTaskAttempts,
  listTaskMessages,
  listTasks,
  type Task,
  type TaskAttempt,
  type TaskListResponse,
  type TaskMessage,
  type TaskStatus,
} from '@moltnet/api-client';

import { getApiClient } from '../api.js';

export interface TaskListFilters {
  teamId: string;
  status?: TaskStatus;
  taskType?: string;
  correlationId?: string;
  cursor?: string;
  limit?: number;
}

function assertData<T>(data: T | undefined, error: unknown): T {
  if (error) {
    if (typeof error === 'object' && error !== null) {
      const candidate = error as { detail?: string; message?: string };
      throw new Error(
        candidate.detail ?? candidate.message ?? 'Task API error',
      );
    }
    throw new Error(JSON.stringify(error));
  }
  if (data === undefined) throw new Error('Task API returned no data');
  return data;
}

export async function fetchTasks(
  filters: TaskListFilters,
): Promise<TaskListResponse> {
  const { data, error } = await listTasks({
    client: getApiClient(),
    query: {
      teamId: filters.teamId,
      status: filters.status,
      taskType: filters.taskType || undefined,
      correlationId: filters.correlationId || undefined,
      cursor: filters.cursor,
      limit: filters.limit,
    },
  });
  return assertData(data, error);
}

export async function fetchTask(id: string): Promise<Task> {
  const { data, error } = await getTask({
    client: getApiClient(),
    path: { id },
  });
  return assertData(data, error);
}

export async function fetchTaskAttempts(id: string): Promise<TaskAttempt[]> {
  const { data, error } = await listTaskAttempts({
    client: getApiClient(),
    path: { id },
  });
  return assertData(data, error);
}

export async function fetchTaskMessages(input: {
  taskId: string;
  attemptN: number;
  afterSeq?: number;
  limit?: number;
}): Promise<TaskMessage[]> {
  const { data, error } = await listTaskMessages({
    client: getApiClient(),
    path: { id: input.taskId, n: input.attemptN },
    query: {
      afterSeq: input.afterSeq,
      limit: input.limit,
    },
  });
  return assertData(data, error);
}
