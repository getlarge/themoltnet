import type { PermissionChecker, RelationshipWriter } from '@moltnet/auth';
import { KetoNamespace } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import {
  DBOS,
  type DiaryRepository,
  type NewTask,
  type NewTaskMessage,
  type Task as DbTask,
  type TaskAttempt as DbTaskAttempt,
  type TaskMessage as DbTaskMessage,
  type TaskRepository,
  taskWorkflows,
} from '@moltnet/database';
import {
  BUILT_IN_TASK_TYPES,
  getTaskTypeRegistry,
  type OutputKind,
  type Task,
  type TaskAttempt,
  type TaskError,
  type TaskMessage,
  type TaskUsage,
  type TaskValidationError,
  validateTaskCreateRequest,
  validateTaskOutput,
} from '@moltnet/tasks';
import type { TSchema } from '@sinclair/typebox';

interface TaskTypeEntry {
  readonly name: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly outputKind: OutputKind;
  readonly requiresCriteria: boolean;
  readonly requiresReferences: boolean;
  readonly validateInput?: (input: unknown) => string | null;
}

interface Logger {
  info(obj: object, msg: string): void;
  debug(obj: object, msg: string): void;
  warn(obj: object, msg: string): void;
  error(obj: object, msg: string): void;
}

const EVENT_TIMEOUT_SECONDS = 10;
const DEFAULT_LEASE_TTL_SEC = 300;
const TERMINAL_STATUSES = new Set<DbTask['status']>([
  'completed',
  'failed',
  'cancelled',
  'expired',
]);

export class TaskServiceError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'conflict'
      | 'forbidden'
      | 'invalid'
      | 'timed_out'
      | 'unknown_task_type',
    message: string,
    public readonly validationErrors?: TaskValidationError[],
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

function taskWorkflowId(taskId: string, attemptN: number): string {
  return `task:${taskId}:attempt:${attemptN}`;
}

function dbTaskToWire(row: DbTask): Task {
  return {
    id: row.id,
    taskType: row.taskType,
    teamId: row.teamId,
    diaryId: row.diaryId ?? null,
    outputKind: row.outputKind,
    input: row.input as Record<string, unknown>,
    inputSchemaCid: row.inputSchemaCid,
    inputCid: row.inputCid,
    criteriaCid: row.criteriaCid ?? null,
    references: row.taskRefs as unknown[] as Task['references'],
    correlationId: row.correlationId ?? null,
    imposedByAgentId: row.imposedByAgentId ?? null,
    imposedByHumanId: row.imposedByHumanId ?? null,
    acceptedAttemptN: row.acceptedAttemptN ?? null,
    status: row.status,
    queuedAt: row.queuedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    cancelledByAgentId: row.cancelledByAgentId ?? null,
    cancelledByHumanId: row.cancelledByHumanId ?? null,
    cancelReason: row.cancelReason ?? null,
    maxAttempts: row.maxAttempts,
  };
}

function dbAttemptToWire(row: DbTaskAttempt): TaskAttempt {
  return {
    taskId: row.taskId,
    attemptN: row.attemptN,
    claimedByAgentId: row.claimedByAgentId,
    runtimeId: row.runtimeId ?? null,
    claimedAt: row.claimedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
    status: row.status,
    output: (row.output as Record<string, unknown>) ?? null,
    outputCid: row.outputCid ?? null,
    error: (row.error as TaskError) ?? null,
    usage: (row.usage as TaskUsage) ?? null,
    contentSignature: row.contentSignature ?? null,
    signedAt: row.signedAt?.toISOString() ?? null,
  };
}

function dbMessageToWire(row: DbTaskMessage): TaskMessage {
  return {
    taskId: row.taskId,
    attemptN: row.attemptN,
    seq: Number(row.seq),
    timestamp: row.timestamp.toISOString(),
    kind: row.kind,
    payload: row.payload as Record<string, unknown>,
  };
}

export interface CreateTaskInput {
  taskType: string;
  teamId: string;
  diaryId?: string;
  inputPayload: Record<string, unknown>;
  references?: unknown[];
  correlationId?: string;
  maxAttempts?: number;
  expiresInSec?: number;
  criteriaCid?: string;
  callerId: string;
  callerNs: KetoNamespace;
  callerIsAgent: boolean;
}

interface TaskServiceDeps {
  taskRepository: TaskRepository;
  diaryRepository: DiaryRepository;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  logger: Logger;
}

export function createTaskService(deps: TaskServiceDeps) {
  const {
    taskRepository,
    diaryRepository,
    permissionChecker,
    relationshipWriter,
    logger,
  } = deps;

  return {
    async create(input: CreateTaskInput): Promise<Task> {
      const createErrors = validateTaskCreateRequest({
        taskType: input.taskType,
        input: input.inputPayload,
        criteriaCid: input.criteriaCid,
        references: input.references as Task['references'] | undefined,
      });
      if (createErrors.length > 0) {
        throw new TaskServiceError(
          'invalid',
          `Task create payload failed validation for task type: ${input.taskType}`,
          createErrors,
        );
      }

      const taskTypes = BUILT_IN_TASK_TYPES as Record<
        string,
        TaskTypeEntry | undefined
      >;
      const taskTypeDef = Object.prototype.hasOwnProperty.call(
        taskTypes,
        input.taskType,
      )
        ? taskTypes[input.taskType]
        : undefined;
      if (!taskTypeDef) {
        throw new TaskServiceError(
          'invalid',
          `Unknown task type: ${input.taskType}`,
          [
            {
              field: 'taskType',
              message: `Unknown task type: ${input.taskType}`,
            },
          ],
        );
      }

      if (!input.diaryId) {
        throw new TaskServiceError('invalid', 'diaryId is required', [
          { field: 'diaryId', message: 'diaryId is required' },
        ]);
      }

      const diary = await diaryRepository.findById(input.diaryId);
      if (!diary) {
        throw new TaskServiceError('not_found', 'Diary not found');
      }

      const canImpose = await permissionChecker.canImposeTask(
        input.diaryId,
        input.callerId,
        input.callerNs,
      );
      if (!canImpose) {
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to impose tasks on this diary',
        );
      }

      const schemaCids = getTaskTypeRegistry();
      const inputSchemaCid = schemaCids.get(input.taskType);
      if (!inputSchemaCid) {
        throw new TaskServiceError(
          'invalid',
          `Schema CID not found for: ${input.taskType}`,
          [
            {
              field: 'taskType',
              message: `Schema CID not found for: ${input.taskType}`,
            },
          ],
        );
      }
      const inputCid = await computeJsonCid(input.inputPayload);

      const expiresAt = input.expiresInSec
        ? new Date(Date.now() + input.expiresInSec * 1000)
        : null;

      const newTask: NewTask = {
        taskType: input.taskType,
        teamId: input.teamId,
        diaryId: input.diaryId,
        outputKind: taskTypeDef.outputKind,
        input: input.inputPayload,
        inputSchemaCid,
        inputCid,
        criteriaCid: input.criteriaCid ?? null,
        taskRefs: (input.references ?? []) as NewTask['taskRefs'],
        correlationId: input.correlationId ?? null,
        imposedByAgentId: input.callerIsAgent ? input.callerId : null,
        imposedByHumanId: input.callerIsAgent ? null : input.callerId,
        maxAttempts: input.maxAttempts ?? 1,
        expiresAt,
      };

      const row = await taskRepository.create(newTask);

      try {
        await relationshipWriter.grantTaskParent(row.id, input.diaryId);
      } catch (err) {
        logger.error(
          { taskId: row.id, diaryId: input.diaryId, err },
          'task.create.grant_failed — rolling back task',
        );
        await taskRepository
          .updateStatus(row.id, 'cancelled', {
            cancelReason: 'Keto grant failed during creation',
            cancelledByAgentId: null,
            cancelledByHumanId: null,
          })
          .catch((rollbackErr: unknown) => {
            logger.error(
              { taskId: row.id, err: rollbackErr },
              'task.create.rollback_failed',
            );
          });
        throw new TaskServiceError(
          'conflict',
          'Failed to register task ownership — task was rolled back',
        );
      }

      logger.info({ taskId: row.id, taskType: row.taskType }, 'task.created');
      return dbTaskToWire(row);
    },

    async list(opts: {
      teamId: string;
      status?: string;
      taskType?: string;
      correlationId?: string;
      limit?: number;
      cursor?: string;
      callerId: string;
      callerNs: KetoNamespace;
    }): Promise<{ items: Task[]; total: number; nextCursor?: string }> {
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

      const { items, nextCursor } = await taskRepository.list({
        teamId: opts.teamId,
        status: opts.status as DbTask['status'] | undefined,
        taskType: opts.taskType,
        correlationId: opts.correlationId,
        limit: opts.limit,
        cursor: opts.cursor,
      });
      return {
        items: items.map(dbTaskToWire),
        total: items.length,
        nextCursor,
      };
    },

    async get(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
    ): Promise<Task> {
      // Check permission before fetching to avoid leaking existence info (Issue 8).
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

    async claim(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
      leaseTtlSec = DEFAULT_LEASE_TTL_SEC,
    ): Promise<{ task: Task; attempt: TaskAttempt }> {
      // Only agents may claim tasks (Issue 4).
      if (callerNs !== KetoNamespace.Agent) {
        throw new TaskServiceError('invalid', 'Only agents may claim tasks');
      }

      // CAS update: atomically move status from 'queued' → 'dispatched' (Issue 1).
      const row = await taskRepository.claimIfQueued(taskId);
      if (!row) {
        // Either the task doesn't exist or it was not in 'queued' state.
        // We disambiguate to give a meaningful error without leaking existence.
        throw new TaskServiceError(
          'conflict',
          'Task is not queued or is already being claimed',
        );
      }

      const attemptCount = await taskRepository.countAttempts(taskId);
      if (attemptCount >= row.maxAttempts) {
        throw new TaskServiceError(
          'conflict',
          'Task has exhausted all allowed attempts',
        );
      }

      const canClaim = await permissionChecker.canClaimTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canClaim)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to claim this task',
        );

      const attemptN = attemptCount + 1;
      const workflowId = taskWorkflowId(taskId, attemptN);

      try {
        await DBOS.startWorkflow(taskWorkflows.startAttemptWorkflow, {
          workflowID: workflowId,
        })(taskId, attemptN, callerId, workflowId, leaseTtlSec);
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.name.includes('WorkflowAlreadyExists')
        ) {
          throw error;
        }
      }

      const claimed = await DBOS.getEvent<{ taskId: string; attemptN: number }>(
        workflowId,
        'claimed',
        EVENT_TIMEOUT_SECONDS,
      );
      if (!claimed) {
        throw new TaskServiceError('timed_out', 'Claim workflow timed out');
      }

      await relationshipWriter.grantTaskClaimant(taskId, callerId);

      const [updatedTask, attempt] = await Promise.all([
        taskRepository.findById(taskId),
        taskRepository.findAttempt(taskId, attemptN),
      ]);

      logger.info({ taskId, attemptN, callerId }, 'task.claimed');
      return {
        task: dbTaskToWire(updatedTask!),
        attempt: dbAttemptToWire(attempt!),
      };
    },

    async heartbeat(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      leaseTtlSec = DEFAULT_LEASE_TTL_SEC,
    ): Promise<{ claimExpiresAt: string }> {
      const canReport = await permissionChecker.canReportTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canReport)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to report on this task',
        );

      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');
      if (TERMINAL_STATUSES.has(task.status)) {
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may send heartbeats',
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      await DBOS.send(workflowId, true, 'started');

      const claimExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
      await taskRepository.updateStatus(taskId, 'running', { claimExpiresAt });

      logger.debug({ taskId, attemptN }, 'task.heartbeat');
      return { claimExpiresAt: claimExpiresAt.toISOString() };
    },

    async complete(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      body: {
        output: Record<string, unknown>;
        outputCid: string;
        usage: TaskUsage;
        contentSignature?: string;
      },
    ): Promise<Task> {
      const canReport = await permissionChecker.canReportTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canReport)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to report on this task',
        );

      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may complete this attempt',
        );
      }

      const outputErrors = validateTaskOutput(task.taskType, body.output);
      if (outputErrors.length > 0) {
        throw new TaskServiceError(
          'invalid',
          `Task output failed validation for task type: ${task.taskType}`,
          outputErrors,
        );
      }

      const computedOutputCid = await computeJsonCid(body.output);
      if (computedOutputCid !== body.outputCid) {
        throw new TaskServiceError(
          'invalid',
          'outputCid does not match the canonical CID of output',
          [
            {
              field: 'outputCid',
              message: `Expected ${computedOutputCid} for the supplied output`,
            },
          ],
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      await DBOS.send(
        workflowId,
        {
          kind: 'completed',
          output: body.output,
          outputCid: body.outputCid,
          usage: body.usage,
        },
        'result',
      );

      const deadline = Date.now() + EVENT_TIMEOUT_SECONDS * 1000;
      while (true) {
        const updated = await taskRepository.findById(taskId);
        if (updated && TERMINAL_STATUSES.has(updated.status)) {
          logger.info(
            { taskId, attemptN, status: updated.status },
            'task.completed',
          );
          return dbTaskToWire(updated);
        }
        if (Date.now() >= deadline) {
          throw new TaskServiceError(
            'timed_out',
            'Complete workflow timed out waiting for result',
          );
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 250);
        });
      }
    },

    async fail(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      error: TaskError,
    ): Promise<Task> {
      const canReport = await permissionChecker.canReportTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canReport)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to report on this task',
        );

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may fail this attempt',
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      await DBOS.send(workflowId, { kind: 'failed', error }, 'result');

      const deadline = Date.now() + EVENT_TIMEOUT_SECONDS * 1000;
      while (true) {
        const updated = await taskRepository.findById(taskId);
        if (updated && TERMINAL_STATUSES.has(updated.status)) {
          logger.info(
            { taskId, attemptN, status: updated.status },
            'task.failed',
          );
          return dbTaskToWire(updated);
        }
        if (Date.now() >= deadline) {
          throw new TaskServiceError(
            'timed_out',
            'Fail workflow timed out waiting for result',
          );
        }
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 250);
        });
      }
    },

    async cancel(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
      reason: string,
    ): Promise<Task> {
      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

      const terminalStatuses: DbTask['status'][] = [
        'completed',
        'failed',
        'cancelled',
        'expired',
      ];
      if (terminalStatuses.includes(row.status)) {
        throw new TaskServiceError(
          'conflict',
          `Cannot cancel a task in terminal state: ${row.status}`,
        );
      }

      const canCancel = await permissionChecker.canCancelTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canCancel)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to cancel this task',
        );

      const isAgent = callerNs === KetoNamespace.Agent;
      const updated = await taskRepository.updateStatus(taskId, 'cancelled', {
        cancelReason: reason,
        cancelledByAgentId: isAgent ? callerId : null,
        cancelledByHumanId: isAgent ? null : callerId,
      });

      if (row.claimAgentId) {
        await relationshipWriter
          .removeTaskClaimant(taskId, row.claimAgentId)
          .catch((err: unknown) => {
            logger.warn(
              { taskId, claimAgentId: row.claimAgentId, err },
              'task.cancel.remove_claimant_failed',
            );
          });
      }

      logger.info({ taskId, callerId, reason }, 'task.cancelled');
      return dbTaskToWire(updated!);
    },

    async listAttempts(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
    ): Promise<TaskAttempt[]> {
      // Check permission before fetching to avoid leaking existence info (Issue 8).
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

    async listMessages(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      opts: { afterSeq?: number; limit?: number },
    ): Promise<TaskMessage[]> {
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

    async appendMessages(
      taskId: string,
      attemptN: number,
      callerId: string,
      callerNs: KetoNamespace,
      messages: Array<{
        kind: string;
        payload: Record<string, unknown>;
        timestamp?: string;
      }>,
    ): Promise<{ count: number }> {
      const canReport = await permissionChecker.canReportTask(
        taskId,
        callerId,
        callerNs,
      );
      if (!canReport)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to append messages',
        );

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may append messages',
        );
      }

      // Seq is generated atomically inside the DB by the repository to avoid
      // read-then-write races (see appendMessages in task.repository.ts).
      const rows = messages.map((m) => ({
        taskId,
        attemptN,
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        kind: m.kind as NewTaskMessage['kind'],
        payload: m.payload,
      }));

      await taskRepository.appendMessages(rows);
      logger.debug(
        { taskId, attemptN, count: messages.length },
        'task.messages_appended',
      );
      return { count: messages.length };
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
