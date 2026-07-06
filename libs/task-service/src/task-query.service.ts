import type { KetoNamespace } from '@moltnet/auth';
import type { Task as DbTask } from '@moltnet/database';
import type { Task, TaskAttempt, TaskMessage } from '@moltnet/tasks';

import {
  normalizeTaskTags,
  normalizeTaskTitle,
  TaskServiceError,
} from './task-service.shared.js';
import type { TaskServiceDeps } from './task-service.types.js';
import {
  dbAttemptToWire,
  dbMessageToWire,
  dbTaskToWire,
} from './wire-mappers.js';

export interface TaskListInput {
  teamId: string;
  status?: string;
  statuses?: string[];
  taskTypes?: string[];
  query?: string;
  tags?: string[];
  excludeTags?: string[];
  profileId?: string;
  correlationId?: string;
  diaryId?: string;
  proposedByAgentId?: string;
  proposedByHumanId?: string;
  claimedByAgentId?: string;
  hasAttempts?: boolean;
  queuedAfter?: string;
  queuedBefore?: string;
  completedAfter?: string;
  completedBefore?: string;
  limit?: number;
  cursor?: string;
  callerId: string;
  callerNs: KetoNamespace;
}

export interface TaskQueryService {
  list(opts: TaskListInput): Promise<{
    items: Task[];
    total: number;
    nextCursor?: string;
  }>;
  get(taskId: string, callerId: string, callerNs: KetoNamespace): Promise<Task>;
  updateMetadata(
    taskId: string,
    input: {
      title?: string | null;
      tags?: string[];
      callerId: string;
      callerNs: KetoNamespace;
    },
  ): Promise<Task>;
  listAttempts(
    taskId: string,
    callerId: string,
    callerNs: KetoNamespace,
  ): Promise<TaskAttempt[]>;
  listMessages(
    taskId: string,
    attemptN: number,
    callerId: string,
    callerNs: KetoNamespace,
    opts: { afterSeq?: number; limit?: number },
  ): Promise<TaskMessage[]>;
}

export function createTaskQueryService(
  deps: Pick<TaskServiceDeps, 'taskRepository' | 'permissionChecker'>,
): TaskQueryService {
  const { taskRepository, permissionChecker } = deps;

  return {
    async list(opts) {
      const canAccess = await permissionChecker.canAccessTeam(
        opts.teamId,
        opts.callerId,
        opts.callerNs,
      );
      if (!canAccess)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to list tasks for this team',
        );

      const filterOpts = {
        teamId: opts.teamId,
        status: opts.status as DbTask['status'] | undefined,
        statuses: opts.statuses as DbTask['status'][] | undefined,
        query: opts.query,
        taskTypes: opts.taskTypes,
        tags: opts.tags,
        excludeTags: opts.excludeTags,
        profileId: opts.profileId,
        correlationId: opts.correlationId,
        diaryId: opts.diaryId,
        proposedByAgentId: opts.proposedByAgentId,
        proposedByHumanId: opts.proposedByHumanId,
        claimedByAgentId: opts.claimedByAgentId,
        hasAttempts: opts.hasAttempts,
        queuedAfter: opts.queuedAfter ? new Date(opts.queuedAfter) : undefined,
        queuedBefore: opts.queuedBefore
          ? new Date(opts.queuedBefore)
          : undefined,
        completedAfter: opts.completedAfter
          ? new Date(opts.completedAfter)
          : undefined,
        completedBefore: opts.completedBefore
          ? new Date(opts.completedBefore)
          : undefined,
      };
      const [{ items, nextCursor }, total] = await Promise.all([
        taskRepository.list({
          ...filterOpts,
          limit: opts.limit,
          cursor: opts.cursor,
        }),
        taskRepository.count(filterOpts),
      ]);
      return {
        items: items.map(dbTaskToWire),
        total,
        nextCursor,
      };
    },

    async get(taskId, callerId, callerNs) {
      const canView = await permissionChecker.canViewTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canView)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to view this task',
        );

      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

      return dbTaskToWire(row);
    },

    async updateMetadata(taskId, input) {
      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

      const canEditMetadata = await permissionChecker.canEditTaskMetadata(
        taskId,
        input.callerId,
        input.callerNs,
      );
      if (!canEditMetadata)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to update task metadata',
        );

      const updated = await taskRepository.updateMetadata(taskId, {
        ...(input.title !== undefined
          ? { title: normalizeTaskTitle(input.title) }
          : {}),
        ...(input.tags !== undefined
          ? { tags: normalizeTaskTags(input.tags) }
          : {}),
      });
      if (!updated) throw new TaskServiceError('not_found', 'Task not found');
      return dbTaskToWire(updated);
    },

    async listAttempts(taskId, callerId, callerNs) {
      const canView = await permissionChecker.canViewTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canView)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to view this task',
        );

      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

      const attempts = await taskRepository.listAttempts(taskId);
      return attempts.map(dbAttemptToWire);
    },

    async listMessages(taskId, attemptN, callerId, callerNs, opts) {
      const canView = await permissionChecker.canViewTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canView)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to view this task',
        );

      const { items } = await taskRepository.listMessages(
        taskId,
        attemptN,
        opts,
      );
      return items.map(dbMessageToWire);
    },
  };
}
