import type { KetoNamespace } from '@moltnet/auth';

import {
  LIVE_STATUSES,
  TaskServiceError,
  TERMINAL_STATUSES,
} from './task-service.shared.js';
import type { TaskServiceDeps } from './task-service.types.js';

export interface DeleteManyInput {
  ids: string[];
  callerId: string;
  callerNs: KetoNamespace;
  force?: boolean;
  reason?: string;
}

export interface TaskDeleteService {
  planDeleteMany(input: DeleteManyInput): Promise<{
    accepted: string[];
    skipped: string[];
  }>;
  deleteMany(input: DeleteManyInput): Promise<{
    deleted: string[];
    skipped: string[];
  }>;
}

export function createTaskDeleteService(
  deps: Pick<
    TaskServiceDeps,
    | 'taskRepository'
    | 'permissionChecker'
    | 'relationshipWriter'
    | 'transactionRunner'
    | 'logger'
  >,
): TaskDeleteService {
  const {
    taskRepository,
    permissionChecker,
    relationshipWriter,
    transactionRunner,
    logger,
  } = deps;

  async function buildDeleteManyPlan(input: DeleteManyInput): Promise<{
    accepted: string[];
    skipped: string[];
  }> {
    const force = input.force ?? false;
    if (force && !input.reason?.trim()) {
      throw new TaskServiceError('invalid', 'force cleanup requires a reason');
    }

    const uniqueIds = [...new Set(input.ids)];
    const allowedMap = await permissionChecker.canDeleteTasks(
      uniqueIds,
      input.callerId,
      input.callerNs,
    );
    const allowedIds = uniqueIds.filter((id) => allowedMap.get(id));
    if (allowedIds.length === 0) {
      return { accepted: [], skipped: uniqueIds };
    }

    const rows = await taskRepository.findByIds(allowedIds);
    const terminalIds = rows
      .filter(
        (row) =>
          TERMINAL_STATUSES.has(row.status) && !LIVE_STATUSES.has(row.status),
      )
      .map((row) => row.id);
    const sealedIds = new Set(
      await taskRepository.findSealedTaskIds(terminalIds),
    );
    const forceAllowedMap =
      force && terminalIds.length > 0
        ? await permissionChecker.canForceDeleteTasks(
            terminalIds,
            input.callerId,
            input.callerNs,
          )
        : new Map<string, boolean>();
    const accepted = terminalIds.filter(
      (id) => !sealedIds.has(id) || Boolean(forceAllowedMap.get(id)),
    );
    const acceptedSet = new Set(accepted);

    return {
      accepted: uniqueIds.filter((id) => acceptedSet.has(id)),
      skipped: uniqueIds.filter((id) => !acceptedSet.has(id)),
    };
  }

  return {
    async planDeleteMany(input) {
      return buildDeleteManyPlan(input);
    },

    async deleteMany(input) {
      const force = input.force ?? false;
      const plan = await buildDeleteManyPlan(input);
      const deletableIds = plan.accepted;
      if (deletableIds.length === 0) {
        return { deleted: [], skipped: plan.skipped };
      }
      const rows = await taskRepository.findByIds(deletableIds);

      const deleted = await transactionRunner.runInTransaction(
        async () => {
          if (force) {
            await taskRepository.deleteCorrelationSealsForTasks(deletableIds);
          }
          const deletedTaskIds = await taskRepository.deleteMany(deletableIds);
          const deletedSet = new Set(deletedTaskIds);
          const deletedRows = rows.filter((row) => deletedSet.has(row.id));

          try {
            await relationshipWriter.removeTaskRelationsBatch(
              deletedRows.map((row) => ({
                id: row.id,
                diaryId: row.diaryId,
                claimAgentId: row.claimAgentId,
              })),
            );
          } catch (err: unknown) {
            const error = err instanceof Error ? err : new Error(String(err));

            logger.error(
              { err: error, taskIds: deletedTaskIds },
              'task.delete-many_keto_cleanup_failed',
            );

            throw new TaskServiceError(
              'invalid',
              'Failed to clean up task permissions; no tasks were deleted',
            );
          }

          return deletedTaskIds;
        },
        { name: 'task.delete-many' },
      );

      const deletedSet = new Set(deleted);
      const skipped = [
        ...plan.skipped,
        ...deletableIds.filter((id) => !deletedSet.has(id)),
      ];

      if (deleted.length > 0) {
        logger.info(
          {
            deleted: deleted.length,
            taskIds: deleted,
            force,
            callerId: input.callerId,
            callerNs: input.callerNs,
            reason: force ? input.reason?.trim() : undefined,
          },
          'task.delete-many',
        );
      }

      return { deleted, skipped };
    },
  };
}
