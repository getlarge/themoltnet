import type { PermissionChecker, RelationshipWriter } from '@moltnet/auth';
import { KetoNamespace } from '@moltnet/auth';
import {
  DBOS,
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
import { Value } from '@sinclair/typebox/value';
import { CID } from 'multiformats/cid';
import * as json from 'multiformats/codecs/json';
import { sha256 } from 'multiformats/hashes/sha2';

const EVENT_TIMEOUT_SECONDS = 10;
const DEFAULT_LEASE_TTL_SEC = 300;

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
  ) {
    super(message);
    this.name = 'TaskServiceError';
  }
}

async function computeCid(value: unknown): Promise<string> {
  const bytes = json.encode(value);
  const hash = await sha256.digest(bytes);
  return CID.create(1, json.code, hash).toString();
}

function dbTaskToWire(row: DbTask): Task {
  return {
    id: row.id,
    task_type: row.taskType,
    team_id: row.teamId,
    diary_id: row.diaryId ?? null,
    output_kind: row.outputKind,
    input: row.input as Record<string, unknown>,
    input_schema_cid: row.inputSchemaCid,
    input_cid: row.inputCid,
    criteria_cid: row.criteriaCid ?? null,
    references: row.taskRefs as unknown[] as Task['references'],
    correlation_id: row.correlationId ?? null,
    imposed_by_agent_id: row.imposedByAgentId ?? null,
    imposed_by_human_id: row.imposedByHumanId ?? null,
    accepted_attempt_n: row.acceptedAttemptN ?? null,
    status: row.status,
    queued_at: row.queuedAt.toISOString(),
    completed_at: row.completedAt?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    cancelled_by_agent_id: row.cancelledByAgentId ?? null,
    cancelled_by_human_id: row.cancelledByHumanId ?? null,
    cancel_reason: row.cancelReason ?? null,
    max_attempts: row.maxAttempts,
  };
}

function dbAttemptToWire(row: DbTaskAttempt): TaskAttempt {
  return {
    task_id: row.taskId,
    attempt_n: row.attemptN,
    claimed_by_agent_id: row.claimedByAgentId,
    runtime_id: row.runtimeId ?? null,
    claimed_at: row.claimedAt.toISOString(),
    started_at: row.startedAt?.toISOString() ?? null,
    completed_at: row.completedAt?.toISOString() ?? null,
    status: row.status,
    output: (row.output as Record<string, unknown>) ?? null,
    output_cid: row.outputCid ?? null,
    error: (row.error as TaskError) ?? null,
    usage: (row.usage as TaskUsage) ?? null,
    content_signature: row.contentSignature ?? null,
    signed_at: row.signedAt?.toISOString() ?? null,
  };
}

function dbMessageToWire(row: DbTaskMessage): TaskMessage {
  return {
    task_id: row.taskId,
    attempt_n: row.attemptN,
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
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
}

export function createTaskService(deps: TaskServiceDeps) {
  const { taskRepository, permissionChecker, relationshipWriter } = deps;

  return {
    async create(input: CreateTaskInput): Promise<Task> {
      const taskTypeDef = (
        BUILT_IN_TASK_TYPES as Record<string, TaskTypeEntry | undefined>
      )[input.taskType];
      if (!taskTypeDef) {
        throw new TaskServiceError(
          'unknown_task_type',
          `Unknown task type: ${input.taskType}`,
        );
      }

      if (!Value.Check(taskTypeDef.inputSchema, input.inputPayload)) {
        throw new TaskServiceError(
          'invalid',
          `Input does not match schema for task type: ${input.taskType}`,
        );
      }

      if (taskTypeDef.validateInput) {
        const validationError = taskTypeDef.validateInput(input.inputPayload);
        if (validationError) {
          throw new TaskServiceError('invalid', validationError);
        }
      }

      if (!input.diaryId) {
        throw new TaskServiceError('invalid', 'diary_id is required');
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
          'unknown_task_type',
          `Schema CID not found for: ${input.taskType}`,
        );
      }
      const inputCid = await computeCid(input.inputPayload);

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
      await relationshipWriter.grantTaskParent(row.id, input.diaryId);

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
    }): Promise<{ items: Task[]; next_cursor?: string }> {
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
        next_cursor: nextCursor,
      };
    },

    async get(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
    ): Promise<Task> {
      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

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

      return dbTaskToWire(row);
    },

    async claim(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
      leaseTtlSec = DEFAULT_LEASE_TTL_SEC,
    ): Promise<{ task: Task; attempt: TaskAttempt }> {
      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');
      if (row.status !== 'queued') {
        throw new TaskServiceError(
          'conflict',
          `Task cannot be claimed in status: ${row.status}`,
        );
      }

      const attemptCount = await taskRepository.countAttempts(taskId);
      if (attemptCount >= row.maxAttempts) {
        throw new TaskServiceError(
          'conflict',
          'Task has exhausted all allowed attempts',
        );
      }

      if (!row.diaryId) {
        throw new TaskServiceError('invalid', 'Task has no diary_id');
      }
      const canClaim = await permissionChecker.canClaimTask(
        row.diaryId,
        callerId,
        callerNs,
      );
      if (!canClaim)
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to claim this task',
        );

      const attemptN = attemptCount + 1;
      const workflowId = `task:${taskId}:attempt:${attemptN}`;

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
    ): Promise<{ claim_expires_at: string }> {
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
          'Only the claiming agent may send heartbeats',
        );
      }

      const workflowId = `task:${taskId}:attempt:${attemptN}`;
      await DBOS.send(workflowId, true, 'started');

      const claimExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
      await taskRepository.updateStatus(taskId, 'running', { claimExpiresAt });

      return { claim_expires_at: claimExpiresAt.toISOString() };
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

      const attempt = await taskRepository.findAttempt(taskId, attemptN);
      if (!attempt)
        throw new TaskServiceError('not_found', 'Attempt not found');
      if (attempt.claimedByAgentId !== callerId) {
        throw new TaskServiceError(
          'forbidden',
          'Only the claiming agent may complete this attempt',
        );
      }

      const workflowId = `task:${taskId}:attempt:${attemptN}`;
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

      const finalEvent = await DBOS.getEvent<{ status: string }>(
        workflowId,
        'result',
        EVENT_TIMEOUT_SECONDS,
      );
      if (!finalEvent) {
        throw new TaskServiceError(
          'timed_out',
          'Complete workflow timed out waiting for result',
        );
      }

      const updated = await taskRepository.findById(taskId);
      return dbTaskToWire(updated!);
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

      const workflowId = `task:${taskId}:attempt:${attemptN}`;
      await DBOS.send(workflowId, { kind: 'failed', error }, 'result');

      const finalEvent = await DBOS.getEvent<{ status: string }>(
        workflowId,
        'result',
        EVENT_TIMEOUT_SECONDS,
      );
      if (!finalEvent) {
        throw new TaskServiceError(
          'timed_out',
          'Fail workflow timed out waiting for result',
        );
      }

      const updated = await taskRepository.findById(taskId);
      return dbTaskToWire(updated!);
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
          .catch(() => {});
      }

      return dbTaskToWire(updated!);
    },

    async listAttempts(
      taskId: string,
      callerId: string,
      callerNs: KetoNamespace,
    ): Promise<TaskAttempt[]> {
      const row = await taskRepository.findById(taskId);
      if (!row) throw new TaskServiceError('not_found', 'Task not found');

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

      const { items: existing } = await taskRepository.listMessages(
        taskId,
        attemptN,
        { limit: 50 },
      );
      const maxSeq =
        existing.length > 0
          ? Math.max(...existing.map((m) => Number(m.seq)))
          : -1;
      const baseSeq = maxSeq + 1;

      const rows: NewTaskMessage[] = messages.map((m, i) => ({
        taskId,
        attemptN,
        seq: baseSeq + i,
        timestamp: m.timestamp ? new Date(m.timestamp) : new Date(),
        kind: m.kind as NewTaskMessage['kind'],
        payload: m.payload,
      }));

      await taskRepository.appendMessages(rows);
      return { count: messages.length };
    },
  };
}

export type TaskService = ReturnType<typeof createTaskService>;
