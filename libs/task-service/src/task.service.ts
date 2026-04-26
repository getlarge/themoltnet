import type { PermissionChecker, RelationshipWriter } from '@moltnet/auth';
import { KetoNamespace } from '@moltnet/auth';
import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  canonicalJson,
  computeExecutorManifestCid,
  computeJsonCid,
  EXECUTOR_MANIFEST_SCHEMA_VERSION,
  type ExecutorTrustLevel,
  verifyExecutorAttestation,
} from '@moltnet/crypto-service';
import {
  type AgentRepository,
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
  type ExecutorTrustLevel as WireExecutorTrustLevel,
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

const TRUST_LEVEL_TO_DB = {
  selfDeclared: 'self_declared',
  agentSigned: 'agent_signed',
  releaseVerifiedTool: 'release_verified_tool',
  sandboxAttested: 'sandbox_attested',
} as const satisfies Record<
  ExecutorTrustLevel,
  DbTask['requiredExecutorTrustLevel']
>;

const TRUST_LEVEL_TO_WIRE = {
  self_declared: 'selfDeclared',
  agent_signed: 'agentSigned',
  release_verified_tool: 'releaseVerifiedTool',
  sandbox_attested: 'sandboxAttested',
} as const satisfies Record<
  DbTask['requiredExecutorTrustLevel'],
  WireExecutorTrustLevel
>;

const TRUST_ORDER: Record<ExecutorTrustLevel, number> = {
  selfDeclared: 0,
  agentSigned: 1,
  releaseVerifiedTool: 2,
  sandboxAttested: 3,
};

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
    requiredExecutorTrustLevel:
      TRUST_LEVEL_TO_WIRE[row.requiredExecutorTrustLevel],
    status: row.status,
    queuedAt: row.queuedAt.toISOString(),
    completedAt: row.completedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    cancelledByAgentId: row.cancelledByAgentId ?? null,
    cancelledByHumanId: row.cancelledByHumanId ?? null,
    cancelReason: row.cancelReason ?? null,
    maxAttempts: row.maxAttempts,
    dispatchTimeoutSec: row.dispatchTimeoutSec ?? null,
    runningTimeoutSec: row.runningTimeoutSec ?? null,
  };
}

function dbAttemptToWire(
  row: DbTaskAttempt & {
    claimedExecutorManifest?: unknown;
    completedExecutorManifest?: unknown;
  },
): TaskAttempt {
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
    claimedExecutorFingerprint: row.claimedExecutorFingerprint ?? null,
    claimedExecutorManifest:
      (row.claimedExecutorManifest as Record<string, unknown> | null) ?? null,
    completedExecutorFingerprint: row.completedExecutorFingerprint ?? null,
    completedExecutorManifest:
      (row.completedExecutorManifest as Record<string, unknown> | null) ?? null,
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
  requiredExecutorTrustLevel?: ExecutorTrustLevel;
  // Imposer-set timeout overrides (seconds). Undefined → server
  // defaults (DEFAULT_DISPATCH_TIMEOUT_SECONDS /
  // DEFAULT_RUNNING_TIMEOUT_SECONDS in
  // libs/database/src/workflows/task-workflows.ts).
  dispatchTimeoutSec?: number;
  runningTimeoutSec?: number;
  callerId: string;
  callerNs: KetoNamespace;
  callerIsAgent: boolean;
}

interface ExecutorAttestationInput {
  executorManifest?: Record<string, unknown>;
  executorFingerprint?: string;
  executorSignature?: string;
}

interface VerifiedExecutorAttestation {
  fingerprint: string;
  verification?: {
    trustLevel: 'agent_signed';
    evidence: Record<string, unknown>;
  };
}

interface TaskServiceDeps {
  taskRepository: TaskRepository;
  diaryRepository: DiaryRepository;
  agentRepository: AgentRepository;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  logger: Logger;
}

export function createTaskService(deps: TaskServiceDeps) {
  const {
    taskRepository,
    diaryRepository,
    agentRepository,
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
        requiredExecutorTrustLevel:
          TRUST_LEVEL_TO_DB[input.requiredExecutorTrustLevel ?? 'selfDeclared'],
        maxAttempts: input.maxAttempts ?? 1,
        dispatchTimeoutSec: input.dispatchTimeoutSec ?? null,
        runningTimeoutSec: input.runningTimeoutSec ?? null,
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
      executorAttestation: ExecutorAttestationInput = {},
    ): Promise<{ task: Task; attempt: TaskAttempt }> {
      // Only agents may claim tasks (Issue 4).
      if (callerNs !== KetoNamespace.Agent) {
        throw new TaskServiceError('invalid', 'Only agents may claim tasks');
      }

      const row = await taskRepository.findById(taskId);
      if (!row || row.status !== 'queued') {
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
      const claimedExecutor = await verifyExecutorForPhase({
        phase: 'claim',
        task: row,
        callerId,
        attemptN: null,
        outputCid: null,
        attestation: executorAttestation,
        taskRepository,
        agentRepository,
      });

      // CAS update: atomically move status from 'queued' → 'dispatched' (Issue 1).
      const claimedRow = await taskRepository.claimIfQueued(taskId);
      if (!claimedRow) {
        throw new TaskServiceError(
          'conflict',
          'Task is not queued or is already being claimed',
        );
      }
      await persistExecutorVerification(claimedExecutor, taskRepository);

      try {
        await DBOS.startWorkflow(taskWorkflows.startAttemptWorkflow, {
          workflowID: workflowId,
        })(
          taskId,
          attemptN,
          callerId,
          workflowId,
          leaseTtlSec,
          claimedExecutor?.fingerprint ?? null,
          row.dispatchTimeoutSec ?? null,
          row.runningTimeoutSec ?? null,
        );
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
        taskRepository.findAttemptWithManifests(taskId, attemptN),
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
    ): Promise<{
      claimExpiresAt: string;
      cancelled: boolean;
      cancelReason: string | null;
    }> {
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
          'Only the claiming agent may send heartbeats',
        );
      }

      // Cancellation is reported via the response, not as 409 — the
      // runtime needs a clean signal to abort the executor without
      // having to interpret an error envelope (#938). Other terminal
      // states (completed / failed / expired) remain 409 because there
      // is no executor to abort and a heartbeat against them is a
      // contract violation.
      if (task.status === 'cancelled') {
        logger.debug({ taskId, attemptN }, 'task.heartbeat.on_cancelled_task');
        return {
          claimExpiresAt:
            attempt.completedAt?.toISOString() ?? new Date().toISOString(),
          cancelled: true,
          cancelReason: task.cancelReason ?? null,
        };
      }
      if (TERMINAL_STATUSES.has(task.status)) {
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${task.status}`,
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      // Multiplexed `progress` topic (#936): the workflow's running-phase
      // recv loop dispatches on `kind`. First heartbeat is `started`
      // (transitions claimed→running); subsequent ones are `heartbeat`
      // and refresh the sliding lease window inside the loop without
      // accumulating orphaned events.
      const isFirstHeartbeat = attempt.status === 'claimed';
      const progressKind: 'started' | 'heartbeat' = isFirstHeartbeat
        ? 'started'
        : 'heartbeat';
      await DBOS.send(
        workflowId,
        { kind: progressKind, leaseTtlSec },
        'progress',
      );

      const claimExpiresAt = new Date(Date.now() + leaseTtlSec * 1000);
      await taskRepository.updateStatus(taskId, 'running', { claimExpiresAt });
      // Synchronously stamp attempt.status = 'running' on the first
      // heartbeat. The workflow's markRunning tx will also set this
      // (idempotent overwrite) but writing it here closes a race: the
      // worker's next /complete or /fail call expects attempt.status
      // !== 'claimed' (otherwise the 409 heartbeat-required guard
      // fires). Without this row write, a fast worker can call
      // /complete before the workflow's recv→tx round-trip lands.
      if (isFirstHeartbeat) {
        await taskRepository.updateAttempt(taskId, attemptN, {
          status: 'running',
          startedAt: new Date(),
        });
      }

      logger.debug({ taskId, attemptN }, 'task.heartbeat');
      return {
        claimExpiresAt: claimExpiresAt.toISOString(),
        cancelled: false,
        cancelReason: null,
      };
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
        executorManifest?: Record<string, unknown>;
        executorFingerprint?: string;
        executorSignature?: string;
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
      if (TERMINAL_STATUSES.has(task.status)) {
        // Defense in depth (#938): a /complete that races with a /cancel
        // must not be able to overwrite the cancelled status. Without
        // this guard the workflow would persist 'completed' on top of
        // 'cancelled', silently undoing the cancellation.
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
          'Only the claiming agent may complete this attempt',
        );
      }
      if (attempt.status === 'claimed') {
        // The DBOS workflow blocks on recv('started') before it will accept
        // a result. Without a prior /heartbeat the workflow has not crossed
        // claimed → running, so sending the result here would deadlock the
        // HTTP handler waiting for terminal status. Reject fast with a
        // diagnosable error instead.
        throw new TaskServiceError(
          'conflict',
          'Cannot complete an attempt that has not been started; call /heartbeat first',
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
      const completedExecutor = await verifyExecutorForPhase({
        phase: 'complete',
        task,
        callerId,
        attemptN,
        outputCid: body.outputCid,
        attestation: body,
        taskRepository,
        agentRepository,
      });
      await persistExecutorVerification(completedExecutor, taskRepository);

      const workflowId = taskWorkflowId(taskId, attemptN);
      // Multiplexed `progress` topic (#936).
      await DBOS.send(
        workflowId,
        {
          kind: 'completed',
          output: body.output,
          outputCid: body.outputCid,
          usage: body.usage,
          completedExecutorFingerprint: completedExecutor?.fingerprint ?? null,
        },
        'progress',
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

      const task = await taskRepository.findById(taskId);
      if (!task) throw new TaskServiceError('not_found', 'Task not found');
      if (TERMINAL_STATUSES.has(task.status)) {
        // Defense in depth (#938): a /fail that races with a /cancel
        // must not be able to overwrite the cancelled status.
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
          'Only the claiming agent may fail this attempt',
        );
      }
      if (attempt.status === 'claimed') {
        throw new TaskServiceError(
          'conflict',
          'Cannot fail an attempt that has not been started; call /heartbeat first',
        );
      }

      const workflowId = taskWorkflowId(taskId, attemptN);
      // Multiplexed `progress` topic (#936).
      await DBOS.send(workflowId, { kind: 'failed', error }, 'progress');

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

      // Signal any active workflow so it unblocks and persists the
      // attempt as cancelled. Without this, the workflow sits parked
      // until runningTimeoutSec elapses and the worker keeps burning
      // compute on work that is no longer wanted (#938).
      //
      // With the multiplexed `progress` topic (#936), a single
      // `cancelled` send unblocks the workflow regardless of whether
      // it's parked in the dispatch-phase recv (waiting for the first
      // event) or the running-phase loop. The workflow's dispatch
      // branch handles `cancelled` directly; the running-phase loop
      // falls through to persistTerminalResult.
      //
      // We deliberately do NOT remove the Keto claimant tuple here,
      // and the workflow's terminal persist tx for cancel ALSO
      // preserves it (see persistTerminalResult / dispatch-phase first
      // event handler in task-workflows.ts — `if (evt.kind !==
      // 'cancelled') removeClaimantTupleStep(...)`). The claimer
      // needs to keep the `report` permit so its next /heartbeat can
      // pass `canReportTask` and observe `cancelled: true` to drive
      // executor abort. Orphan-recovery sweeper (#937) cleans up later.
      const attempts = await taskRepository.listAttempts(taskId);
      const active = attempts.find(
        (a) => a.status === 'claimed' || a.status === 'running',
      );
      if (active) {
        const workflowId = taskWorkflowId(taskId, active.attemptN);
        // The workflow persists `error` to attempt.error, which is
        // serialized via the TaskError schema {code, message, ...}.
        await DBOS.send(
          workflowId,
          {
            kind: 'cancelled',
            error: {
              code: 'task_cancelled',
              message: reason,
              retryable: false,
            },
          },
          'progress',
        );
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

async function verifyExecutorForPhase(input: {
  phase: 'claim' | 'complete';
  task: DbTask;
  callerId: string;
  attemptN: number | null;
  outputCid: string | null;
  attestation: ExecutorAttestationInput;
  taskRepository: TaskRepository;
  agentRepository: AgentRepository;
}): Promise<VerifiedExecutorAttestation | null> {
  const requiredTrustLevel =
    TRUST_LEVEL_TO_WIRE[input.task.requiredExecutorTrustLevel];
  const hasAny =
    input.attestation.executorManifest !== undefined ||
    input.attestation.executorFingerprint !== undefined ||
    input.attestation.executorSignature !== undefined;

  if (!hasAny) {
    if (requiredTrustLevel === 'selfDeclared') return null;
    throw new TaskServiceError(
      'invalid',
      `Executor attestation is required for trust level: ${requiredTrustLevel}`,
      [
        {
          field: 'executorManifest',
          message:
            'executorManifest, executorFingerprint, and executorSignature are required',
        },
      ],
    );
  }

  const { executorManifest, executorFingerprint, executorSignature } =
    input.attestation;
  if (!executorManifest || !executorFingerprint) {
    throw new TaskServiceError(
      'invalid',
      'executorManifest and executorFingerprint must be provided together',
      [
        {
          field: 'executorFingerprint',
          message:
            'executorManifest and executorFingerprint must be provided together',
        },
      ],
    );
  }

  let computed: string;
  try {
    computed = computeExecutorManifestCid(executorManifest);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new TaskServiceError('invalid', message, [
      { field: 'executorManifest', message },
    ]);
  }
  if (computed !== executorFingerprint) {
    throw new TaskServiceError(
      'invalid',
      'executorFingerprint does not match executorManifest',
      [
        {
          field: 'executorFingerprint',
          message: `Expected ${computed} for the supplied executorManifest`,
        },
      ],
    );
  }

  let verification: VerifiedExecutorAttestation['verification'];

  if (TRUST_ORDER[requiredTrustLevel] >= TRUST_ORDER.agentSigned) {
    if (!executorSignature) {
      throw new TaskServiceError(
        'invalid',
        'executorSignature is required for agentSigned executor trust',
        [
          {
            field: 'executorSignature',
            message: 'executorSignature is required',
          },
        ],
      );
    }
    const agent = await input.agentRepository.findByIdentityId(input.callerId);
    if (!agent) throw new TaskServiceError('not_found', 'Agent not found');
    const payload =
      input.phase === 'claim'
        ? buildExecutorClaimAttestationPayload({
            taskId: input.task.id,
            executorFingerprint,
          })
        : buildExecutorCompleteAttestationPayload({
            taskId: input.task.id,
            attemptN: input.attemptN!,
            outputCid: input.outputCid!,
            executorFingerprint,
          });
    const valid = await verifyExecutorAttestation(
      payload,
      executorSignature,
      agent.publicKey,
    );
    if (!valid) {
      throw new TaskServiceError(
        'invalid',
        'executorSignature is not valid for the supplied executor attestation',
        [
          {
            field: 'executorSignature',
            message: 'executorSignature verification failed',
          },
        ],
      );
    }
    verification = {
      trustLevel: 'agent_signed',
      evidence: { phase: input.phase, signerAgentId: input.callerId },
    };
  }

  if (TRUST_ORDER[requiredTrustLevel] >= TRUST_ORDER.releaseVerifiedTool) {
    throw new TaskServiceError(
      'invalid',
      `executor trust level '${requiredTrustLevel}' is not yet implemented`,
      [
        {
          field: 'requiredExecutorTrustLevel',
          message: `${requiredTrustLevel} requires a verifier before claim acceptance`,
        },
      ],
    );
  }

  await input.taskRepository.upsertExecutorManifest({
    fingerprint: executorFingerprint,
    manifest: executorManifest,
    schemaVersion:
      typeof executorManifest.schemaVersion === 'string'
        ? executorManifest.schemaVersion
        : EXECUTOR_MANIFEST_SCHEMA_VERSION,
  });

  const stored =
    await input.taskRepository.findExecutorManifest(executorFingerprint);
  if (
    stored &&
    canonicalJson(stored.manifest) !== canonicalJson(executorManifest)
  ) {
    throw new TaskServiceError(
      'conflict',
      'executorFingerprint already maps to a different manifest',
    );
  }

  return { fingerprint: executorFingerprint, verification };
}

async function persistExecutorVerification(
  verified: VerifiedExecutorAttestation | null,
  taskRepository: TaskRepository,
): Promise<void> {
  if (!verified?.verification) return;
  await taskRepository.upsertExecutorManifestVerification({
    fingerprint: verified.fingerprint,
    trustLevel: verified.verification.trustLevel,
    status: 'verified',
    evidence: verified.verification.evidence,
  });
}
