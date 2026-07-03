import type { PermissionChecker } from '@moltnet/auth';
import type { KetoNamespace } from '@moltnet/auth';
import type {
  TaskActivityAnalyticsResult,
  TaskActivityGroupBy,
  TaskRepository,
} from '@moltnet/database';

export interface TaskActivityAnalyticsInput {
  teamId: string;
  completedAfter: string;
  completedBefore: string;
  tags?: string[];
  taskTypes?: string[];
  profileIds?: string[];
  diaryIds?: string[];
  claimedByAgentIds?: string[];
  groupBy?: TaskActivityGroupBy;
  callerId: string;
  callerNs: KetoNamespace;
}

export class TaskAnalyticsServiceError extends Error {
  constructor(
    public readonly code: 'forbidden' | 'invalid',
    message: string,
    public readonly validationErrors?: Array<{
      field: string;
      message: string;
    }>,
  ) {
    super(message);
    this.name = 'TaskAnalyticsServiceError';
  }
}

interface TaskAnalyticsServiceDeps {
  taskRepository: TaskRepository;
  permissionChecker: PermissionChecker;
}

export interface TaskAnalyticsService {
  recomputeAttemptActivityStats(
    taskId: string,
    attemptN: number,
  ): Promise<void>;
  getActivityAnalytics(
    opts: TaskActivityAnalyticsInput,
  ): Promise<TaskActivityAnalyticsResult>;
}

export function createTaskAnalyticsService({
  taskRepository,
  permissionChecker,
}: TaskAnalyticsServiceDeps): TaskAnalyticsService {
  return {
    async recomputeAttemptActivityStats(taskId, attemptN): Promise<void> {
      await taskRepository.recomputeAttemptActivityStats(taskId, attemptN);
    },

    async getActivityAnalytics(
      opts: TaskActivityAnalyticsInput,
    ): Promise<TaskActivityAnalyticsResult> {
      const canAccess = await permissionChecker.canAccessTeam(
        opts.teamId,
        opts.callerId,
        opts.callerNs,
      );
      if (!canAccess) {
        throw new TaskAnalyticsServiceError(
          'forbidden',
          'Not authorized to view task analytics for this team',
        );
      }

      const completedAfter = parseRequiredDate(
        opts.completedAfter,
        'completedAfter',
      );
      const completedBefore = parseRequiredDate(
        opts.completedBefore,
        'completedBefore',
      );
      if (completedAfter >= completedBefore) {
        throw new TaskAnalyticsServiceError(
          'invalid',
          'Invalid analytics date range',
          [
            {
              field: 'completedBefore',
              message: 'completedBefore must be after completedAfter',
            },
          ],
        );
      }

      const maxRangeMs = 366 * 24 * 60 * 60 * 1000;
      if (completedBefore.getTime() - completedAfter.getTime() > maxRangeMs) {
        throw new TaskAnalyticsServiceError(
          'invalid',
          'Invalid analytics date range',
          [
            {
              field: 'completedBefore',
              message: 'Date range must be 366 days or less',
            },
          ],
        );
      }

      return taskRepository.getTaskActivityAnalytics({
        claimedByAgentIds: opts.claimedByAgentIds,
        completedAfter,
        completedBefore,
        diaryIds: opts.diaryIds,
        groupBy: opts.groupBy,
        profileIds: opts.profileIds,
        tags: opts.tags,
        taskTypes: opts.taskTypes,
        teamId: opts.teamId,
      });
    },
  };
}

function parseRequiredDate(value: string, field: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TaskAnalyticsServiceError('invalid', 'Invalid analytics date', [
      { field, message: `${field} must be a valid ISO 8601 date` },
    ]);
  }
  return date;
}
