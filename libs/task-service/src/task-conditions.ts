import { KetoNamespace } from '@moltnet/auth';
import type { Task as DbTask } from '@moltnet/database';
import { type ClaimCondition, validateTaskInputAsync } from '@moltnet/tasks';

import {
  collectConditionTaskIds,
  evaluateClaimConditionFromTasks,
} from './claim-condition.js';
import { TaskServiceError } from './task-service.shared.js';
import type { TaskServiceDeps } from './task-service.types.js';
import type { MakeAsyncValidationContext } from './task-validation-context.js';

export interface TaskConditionHelpers {
  assertClaimConditionReadable(
    condition: ClaimCondition | undefined,
    callerId: string,
    callerNs: KetoNamespace,
  ): Promise<void>;
  isClaimConditionSatisfied(condition: ClaimCondition): Promise<boolean>;
  expireIfLifetimeElapsed(row: DbTask): Promise<DbTask>;
  promoteSatisfiedWaitingTasks(opts?: {
    triggerTaskId?: string;
  }): Promise<DbTask[]>;
  promoteWaitingTaskIfSatisfied(row: DbTask): Promise<DbTask>;
  tryPromoteSatisfiedWaitingTasks(opts: {
    triggerTaskId?: string;
  }): Promise<void>;
}

export function createTaskConditionHelpers(
  deps: Pick<
    TaskServiceDeps,
    'taskRepository' | 'permissionChecker' | 'transactionRunner' | 'logger'
  >,
  makeAsyncValidationContext: MakeAsyncValidationContext,
): TaskConditionHelpers {
  const { taskRepository, permissionChecker, transactionRunner, logger } = deps;

  async function loadConditionTaskMap(
    condition: ClaimCondition,
  ): Promise<Map<string, DbTask>> {
    const taskIds = [...collectConditionTaskIds(condition)];
    const rows = await taskRepository.findByIds(taskIds);
    return new Map(rows.map((row) => [row.id, row]));
  }

  async function assertClaimConditionReadable(
    condition: ClaimCondition | undefined,
    callerId: string,
    callerNs: KetoNamespace,
  ): Promise<void> {
    if (!condition) return;
    const taskIds = [...collectConditionTaskIds(condition)];
    if (taskIds.length === 0) return;

    const [rows, viewMap] = await Promise.all([
      taskRepository.findByIds(taskIds),
      permissionChecker.canViewTasks(taskIds, callerId, callerNs),
    ]);
    const existing = new Set(rows.map((row) => row.id));
    const unreadable = taskIds.find(
      (taskId) => !existing.has(taskId) || viewMap.get(taskId) !== true,
    );
    if (!unreadable) return;

    throw new TaskServiceError(
      'invalid',
      'claimCondition references a task that does not resolve to a readable task',
      [
        {
          field: 'claimCondition',
          message:
            'Every task referenced by claimCondition must resolve to a task readable by the proposer',
        },
      ],
    );
  }

  async function isClaimConditionSatisfied(
    condition: ClaimCondition,
  ): Promise<boolean> {
    const tasksById = await loadConditionTaskMap(condition);
    return evaluateClaimConditionFromTasks(condition, tasksById);
  }

  function isTaskLifetimeExpired(row: DbTask): boolean {
    return (
      (row.status === 'waiting' || row.status === 'queued') &&
      row.expiresAt !== null &&
      row.expiresAt.getTime() <= Date.now()
    );
  }

  async function expireIfLifetimeElapsed(row: DbTask): Promise<DbTask> {
    if (!isTaskLifetimeExpired(row)) return row;
    const expired = await taskRepository.expireIfStillNonTerminal(row.id);
    if (expired) return expired;
    return (await taskRepository.findById(row.id)) ?? row;
  }

  async function promoteSatisfiedWaitingTasks(
    opts: { triggerTaskId?: string } = {},
  ): Promise<DbTask[]> {
    const waitingTasks = opts.triggerTaskId
      ? await taskRepository.listWaitingTasksReferencingTask(opts.triggerTaskId)
      : await taskRepository.listWaitingTasks();
    const conditionalTasks = waitingTasks
      .map((task) => ({
        task,
        condition: task.claimCondition as ClaimCondition | null,
      }))
      .filter(
        (item): item is { task: DbTask; condition: ClaimCondition } =>
          item.condition !== null,
      );
    if (conditionalTasks.length === 0) return [];

    const referencedIds = new Set<string>();
    for (const { condition } of conditionalTasks) {
      collectConditionTaskIds(condition, referencedIds);
    }
    const referencedRows = await taskRepository.findByIds([...referencedIds]);
    const tasksById = new Map(referencedRows.map((row) => [row.id, row]));
    const satisfied = conditionalTasks.filter(({ condition }) =>
      evaluateClaimConditionFromTasks(condition, tasksById),
    );

    const promotableIds: string[] = [];
    for (const { task } of satisfied) {
      if (isTaskLifetimeExpired(task)) {
        await expireIfLifetimeElapsed(task);
        continue;
      }
      const proposerId = task.proposedByAgentId ?? task.proposedByHumanId;
      const proposerNs = task.proposedByAgentId
        ? KetoNamespace.Agent
        : KetoNamespace.Human;
      if (!proposerId) {
        logger.warn(
          { taskId: task.id },
          'task.promoteWaiting.missing_proposer',
        );
        continue;
      }
      const errors = await validateTaskInputAsync(
        task.taskType,
        task.input,
        makeAsyncValidationContext(proposerId, proposerNs, {
          currentTaskId: task.id,
        }),
      );
      if (errors.length > 0) {
        logger.warn(
          { taskId: task.id, errors },
          'task.promoteWaiting.strict_validation_failed',
        );
        continue;
      }
      promotableIds.push(task.id);
    }
    if (promotableIds.length === 0) return [];

    return transactionRunner.runInTransaction(
      () => taskRepository.promoteWaitingTasks(promotableIds),
      { name: 'task.promoteWaiting' },
    );
  }

  async function promoteWaitingTaskIfSatisfied(row: DbTask): Promise<DbTask> {
    row = await expireIfLifetimeElapsed(row);
    const condition = row.claimCondition as ClaimCondition | null;
    if (row.status !== 'waiting' || !condition) return row;
    const tasksById = await loadConditionTaskMap(condition);
    if (!evaluateClaimConditionFromTasks(condition, tasksById)) return row;

    const proposerId = row.proposedByAgentId ?? row.proposedByHumanId;
    const proposerNs = row.proposedByAgentId
      ? KetoNamespace.Agent
      : KetoNamespace.Human;
    if (!proposerId) {
      logger.warn({ taskId: row.id }, 'task.claim.waiting.missing_proposer');
      return row;
    }

    const errors = await validateTaskInputAsync(
      row.taskType,
      row.input,
      makeAsyncValidationContext(proposerId, proposerNs, {
        currentTaskId: row.id,
      }),
    );
    if (errors.length > 0) {
      logger.warn(
        { taskId: row.id, errors },
        'task.claim.waiting.strict_validation_failed',
      );
      return row;
    }

    const [promoted] = await transactionRunner.runInTransaction(
      () => taskRepository.promoteWaitingTasks([row.id]),
      { name: 'task.claim.promoteWaiting' },
    );
    return promoted ?? row;
  }

  async function tryPromoteSatisfiedWaitingTasks(opts: {
    triggerTaskId?: string;
  }): Promise<void> {
    try {
      const promoted = await promoteSatisfiedWaitingTasks(opts);
      if (promoted.length > 0) {
        logger.info(
          {
            triggerTaskId: opts.triggerTaskId,
            promotedTaskIds: promoted.map((task) => task.id),
          },
          'task.promoteWaiting.promoted',
        );
      }
    } catch (err) {
      logger.error(
        { triggerTaskId: opts.triggerTaskId, err },
        'task.promoteWaiting.failed',
      );
    }
  }

  return {
    assertClaimConditionReadable,
    isClaimConditionSatisfied,
    expireIfLifetimeElapsed,
    promoteSatisfiedWaitingTasks,
    promoteWaitingTaskIfSatisfied,
    tryPromoteSatisfiedWaitingTasks,
  };
}
