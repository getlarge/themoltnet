import {
  DBOS,
  type RuntimeSessionRepository,
  type TaskArtifactRepository,
  type TaskRepository,
  type WorkflowHandle,
  WorkflowQueue,
} from '@moltnet/database';

import {
  type TaskCleanupLogger,
  type TaskCleanupManifest,
  toCleanupManifestTask,
} from './task-cleanup-workflow-lib.js';
import {
  buildTaskDeletionPlan,
  classifyTaskDeletionCandidates,
  DELETE_ELIGIBLE_TASK_STATUSES,
} from './task-deletion-policy.js';

export interface TaskDeletionWorkflowInput {
  ids: string[];
  force: boolean;
  operationId?: string;
  reason?: string;
  requestedBy: {
    id: string;
    ns: 'agent' | 'human';
  };
}

export interface TaskDeletionWorkflowResult {
  requested: number;
  accepted: number;
  skipped: string[];
  deletedTaskCount: number;
  deletedObjectCount: number;
  skippedProtected: number;
}

interface TaskDeletionWorkflowDeps {
  runtimeSessionRepository: RuntimeSessionRepository;
  taskArtifactRepository: TaskArtifactRepository;
  taskRepository: TaskRepository;
  logger: TaskCleanupLogger & {
    info(payload: unknown, message: string): void;
  };
}

type DeleteTaskRowsStep = (
  manifest: TaskCleanupManifest,
  opts?: {
    deleteCorrelationSeals?: boolean;
    onlyStatuses?: typeof DELETE_ELIGIBLE_TASK_STATUSES;
  },
) => Promise<TaskCleanupManifest>;

type DeleteTaskObjectsStep = (manifest: TaskCleanupManifest) => Promise<number>;

let _taskDeletionWorkflow:
  | ((input: TaskDeletionWorkflowInput) => Promise<TaskDeletionWorkflowResult>)
  | null = null;
let _taskDeletionQueueRegistered = false;

const TASK_DELETION_QUEUE_NAME = 'task-deletion-cleanup';

export function _resetTaskDeletionWorkflowForTesting(): void {
  _taskDeletionWorkflow = null;
  _taskDeletionQueueRegistered = false;
}

function ensureTaskDeletionQueue(): void {
  if (_taskDeletionQueueRegistered) {
    return;
  }

  try {
    new WorkflowQueue(TASK_DELETION_QUEUE_NAME, { concurrency: 2 });
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes(
        `Workflow Queue '${TASK_DELETION_QUEUE_NAME}' defined multiple times`,
      )
    ) {
      _taskDeletionQueueRegistered = true;
      return;
    }
    throw err;
  }

  _taskDeletionQueueRegistered = true;
}

export async function startTaskDeletionWorkflow(
  input: TaskDeletionWorkflowInput,
  workflowId: string,
  deduplicationID?: string,
): Promise<WorkflowHandle<TaskDeletionWorkflowResult>> {
  if (!_taskDeletionWorkflow) {
    throw new Error('Task deletion workflow not registered');
  }
  return DBOS.startWorkflow(_taskDeletionWorkflow, {
    workflowID: workflowId,
    queueName: TASK_DELETION_QUEUE_NAME,
    ...(deduplicationID ? { enqueueOptions: { deduplicationID } } : undefined),
  })(input);
}

export function registerTaskDeletionWorkflow(input: {
  getDeps: () => TaskDeletionWorkflowDeps;
  deleteTaskRowsStep: DeleteTaskRowsStep;
  deleteTaskArtifactObjectsStep: DeleteTaskObjectsStep;
  deleteRuntimeSessionObjectsStep: DeleteTaskObjectsStep;
}): void {
  ensureTaskDeletionQueue();

  const buildTaskDeletionManifestStep = DBOS.registerStep(
    async (
      workflowInput: TaskDeletionWorkflowInput,
    ): Promise<TaskCleanupManifest & { skipped: string[] }> => {
      const {
        taskArtifactRepository,
        runtimeSessionRepository,
        taskRepository,
      } = input.getDeps();
      const uniqueIds = [...new Set(workflowInput.ids)];
      const rows = await taskRepository.findByIds(uniqueIds);
      const { deleteEligibleTasks, terminalTaskIds } =
        classifyTaskDeletionCandidates(rows);
      const sealedIds = new Set(
        await taskRepository.findSealedTaskIds(terminalTaskIds),
      );
      const plan = buildTaskDeletionPlan({
        requestedIds: uniqueIds,
        deleteEligibleTasks,
        sealedTaskIds: [...sealedIds],
        forceDeleteAllowedTaskIds: workflowInput.force
          ? terminalTaskIds
          : undefined,
      });
      const tasksForCleanup = plan.acceptedTasks.map(toCleanupManifestTask);
      const taskIds = tasksForCleanup.map((task) => task.id);
      const [taskArtifacts, runtimeSessions] = await Promise.all([
        taskArtifactRepository.listCleanupRefsForTasks(taskIds),
        runtimeSessionRepository.listCleanupRefsForTasks(taskIds),
      ]);

      return {
        tasks: tasksForCleanup,
        taskArtifacts,
        runtimeSessions,
        skipped: plan.skipped,
        skippedProtected: plan.skippedProtected,
        batchFull: false,
        createdAt: new Date().toISOString(),
      };
    },
    {
      name: 'maintenance.taskDeletion.buildManifest',
      retriesAllowed: true,
      maxAttempts: 3,
      intervalSeconds: 2,
      backoffRate: 2,
    },
  );

  _taskDeletionWorkflow = DBOS.registerWorkflow(
    async (
      workflowInput: TaskDeletionWorkflowInput,
    ): Promise<TaskDeletionWorkflowResult> => {
      const { logger } = input.getDeps();
      const workflowId = DBOS.workflowID;
      try {
        logger.info(
          {
            workflowId,
            operationId: workflowInput.operationId,
            requestedTaskIds: workflowInput.ids,
            requested: workflowInput.ids.length,
            force: workflowInput.force,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.workflow_started',
        );

        if (workflowInput.force && !workflowInput.reason?.trim()) {
          throw new Error('force task deletion requires a reason');
        }
        const manifest = await buildTaskDeletionManifestStep(workflowInput);
        logger.info(
          {
            workflowId,
            operationId: workflowInput.operationId,
            requestedTaskIds: workflowInput.ids,
            acceptedTaskIds: manifest.tasks.map((task) => task.id),
            skippedTaskIds: manifest.skipped,
            requested: workflowInput.ids.length,
            accepted: manifest.tasks.length,
            skipped: manifest.skipped.length,
            skippedProtected: manifest.skippedProtected,
            force: workflowInput.force,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.manifest_built',
        );

        if (manifest.tasks.length === 0) {
          logger.info(
            {
              workflowId,
              operationId: workflowInput.operationId,
              requested: workflowInput.ids.length,
              skipped: manifest.skipped.length,
              skippedTaskIds: manifest.skipped,
              skippedProtected: manifest.skippedProtected,
              force: workflowInput.force,
              requestedBy: workflowInput.requestedBy,
            },
            'task.delete.noop',
          );
          return {
            requested: workflowInput.ids.length,
            accepted: 0,
            skipped: manifest.skipped,
            deletedTaskCount: 0,
            deletedObjectCount: 0,
            skippedProtected: manifest.skippedProtected,
          };
        }

        logger.info(
          {
            workflowId,
            operationId: workflowInput.operationId,
            requested: workflowInput.ids.length,
            taskIds: manifest.tasks.map((task) => task.id),
            force: workflowInput.force,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.rows_delete_started',
        );
        const deletedManifest = await input.deleteTaskRowsStep(manifest, {
          deleteCorrelationSeals: workflowInput.force,
          onlyStatuses: DELETE_ELIGIBLE_TASK_STATUSES,
        });
        const deletedTaskIds = deletedManifest.tasks.map((task) => task.id);
        const deletedTaskIdSet = new Set(deletedTaskIds);
        const skippedAfterManifest = manifest.tasks
          .map((task) => task.id)
          .filter((id) => !deletedTaskIdSet.has(id));
        const skipped = [...manifest.skipped, ...skippedAfterManifest];
        logger.info(
          {
            workflowId,
            operationId: workflowInput.operationId,
            deletedTaskIds,
            skippedAfterManifestTaskIds: skippedAfterManifest,
            deletedTaskCount: deletedManifest.tasks.length,
            force: workflowInput.force,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.rows_deleted',
        );

        const deletedArtifactObjects =
          await input.deleteTaskArtifactObjectsStep(deletedManifest);
        const deletedRuntimeSessionObjects =
          await input.deleteRuntimeSessionObjectsStep(deletedManifest);
        const deletedObjectCount =
          deletedArtifactObjects + deletedRuntimeSessionObjects;

        logger.info(
          {
            workflowId,
            operationId: workflowInput.operationId,
            deletedArtifactObjects,
            deletedRuntimeSessionObjects,
            deletedObjectCount,
            force: workflowInput.force,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.objects_deleted',
        );

        logger.info(
          {
            workflowId,
            operationId: workflowInput.operationId,
            requested: workflowInput.ids.length,
            accepted: manifest.tasks.length,
            skipped: skipped.length,
            skippedTaskIds: skipped,
            skippedAfterManifestTaskIds: skippedAfterManifest,
            skippedProtected: manifest.skippedProtected,
            deletedTaskIds,
            deletedTaskCount: deletedManifest.tasks.length,
            deletedObjectCount,
            force: workflowInput.force,
            reason: workflowInput.force
              ? workflowInput.reason?.trim()
              : undefined,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.workflow_completed',
        );

        return {
          requested: workflowInput.ids.length,
          accepted: manifest.tasks.length,
          skipped,
          deletedTaskCount: deletedManifest.tasks.length,
          deletedObjectCount,
          skippedProtected: manifest.skippedProtected,
        };
      } catch (err) {
        logger.error(
          {
            err,
            workflowId,
            operationId: workflowInput.operationId,
            requestedTaskIds: workflowInput.ids,
            requested: workflowInput.ids.length,
            force: workflowInput.force,
            requestedBy: workflowInput.requestedBy,
          },
          'task.delete.workflow_failed',
        );
        throw err;
      }
    },
    { name: 'maintenance.taskDeletion' },
  );
}
