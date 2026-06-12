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
  type ContextPackRepository,
  type CorrelationSealRepository,
  DBOS,
  type DiaryRepository,
  type NewTask,
  type NewTaskMessage,
  type RenderedPackRepository,
  type Task as DbTask,
  type TaskRepository,
  taskWorkflows,
  type TransactionRunner,
} from '@moltnet/database';
import {
  type AsyncTaskValidationContext,
  BUILT_IN_TASK_TYPES,
  type ClaimCondition,
  type CorrelationSeal,
  type DaemonState,
  getTaskCreateSideEffects,
  getTaskTypeRegistry,
  normalizeTaskInputForCreate,
  type OutputKind,
  type ResolvedContextPack,
  type ResolvedRenderedPack,
  type Task,
  type TaskAttempt,
  type TaskError,
  type TaskMessage,
  type TaskUsage,
  type TaskValidationError,
  validateTaskCreateRequest,
  validateTaskInputAsync,
  validateTaskOutput,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';

import {
  collectConditionTaskIds,
  evaluateClaimConditionFromTasks,
  validateClaimConditionShape,
} from './claim-condition.js';
import {
  dbAttemptToWire,
  dbMessageToWire,
  dbTaskToWire,
  TRUST_LEVEL_TO_WIRE,
} from './wire-mappers.js';

interface TaskTypeEntry {
  readonly name: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly outputKind: OutputKind;
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

/**
 * Postgres surfaces unique-key violations as SQLSTATE `23505`.
 * Drizzle / pg propagate that as `err.code === '23505'` (or
 * `cause.code` when wrapped). Used by the create flow's defensive
 * seal-insert catch (#1101 M2).
 */
function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const e = err as { code?: unknown; cause?: { code?: unknown } };
  return e.code === '23505' || e.cause?.code === '23505';
}

function taskWorkflowId(taskId: string, attemptN: number): string {
  return `task:${taskId}:attempt:${attemptN}`;
}

export interface CreateTaskInput {
  taskType: string;
  title?: string;
  tags?: string[];
  teamId: string;
  diaryId?: string;
  inputPayload: Record<string, unknown>;
  references?: unknown[];
  correlationId?: string;
  claimCondition?: ClaimCondition;
  maxAttempts?: number;
  expiresInSec?: number;
  requiredExecutorTrustLevel?: ExecutorTrustLevel;
  // Proposer-set daemon profile routing. Empty/undefined = no restriction.
  allowedProfiles?: { profileId: string }[];
  // Proposer-set timeout overrides (seconds). Undefined → server
  // defaults (DEFAULT_DISPATCH_TIMEOUT_SECONDS /
  // DEFAULT_RUNNING_TIMEOUT_SECONDS in
  // libs/database/src/workflows/task-workflows.ts).
  dispatchTimeoutSec?: number;
  runningTimeoutSec?: number;
  callerId: string;
  callerNs: KetoNamespace;
  callerIsAgent: boolean;
  /**
   * Id written to `proposedByAgentId`/`proposedByHumanId`. For agents this is
   * the Kratos identity id (= `agents.identity_id`); for humans it must be
   * `humans.id` (NOT the Kratos identity id — see
   * apps/rest-api/src/utils/auth-principal.ts header). Defaults to `callerId`
   * to preserve the agent path, where the two ids coincide.
   */
  proposerId?: string;
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
  /** Used to resolve `context_packs` in async validators (#1096). */
  contextPackRepository: ContextPackRepository;
  /** Used to resolve `rendered_packs` in async validators (#1096). */
  renderedPackRepository: RenderedPackRepository;
  /** Correlation-seal lookups + inserts for the validation pass (#1096). */
  correlationSealRepository: CorrelationSealRepository;
  permissionChecker: PermissionChecker;
  relationshipWriter: RelationshipWriter;
  /**
   * Wraps the task-insert + side-effect (e.g. correlation_seal insert)
   * DB writes in a single transaction so they commit or roll back
   * together. Required by #1096 — without it, a crash between the
   * task-insert and the seal-insert leaves a sealing task with no
   * seal, breaking the very invariant the seal protects.
   *
   * Production wires `createDBOSTransactionRunner(dataSource)`;
   * tests wire `createDrizzleTransactionRunner(db)` or a stub.
   */
  transactionRunner: TransactionRunner;
  logger: Logger;
}

function normalizeTaskTitle(title: string | null | undefined): string | null {
  const trimmed = title?.trim();
  return trimmed || null;
}

function normalizeTaskTags(tags: string[] | undefined): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags ?? []) {
    const value = tag.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }
  return normalized;
}

export function createTaskService(deps: TaskServiceDeps) {
  const {
    taskRepository,
    diaryRepository,
    agentRepository,
    contextPackRepository,
    renderedPackRepository,
    correlationSealRepository,
    permissionChecker,
    relationshipWriter,
    transactionRunner,
    logger,
  } = deps;

  /**
   * Build the async validation context (#1096) for one create call.
   * The ctx exposes read-only lookups; side effects declared via
   * `onCreate` are applied separately AFTER the task is inserted, so
   * the ctx is safe to call from any task-type validator.
   *
   * Visibility: every resolver runs the caller-bound Keto check
   * before returning a row. Returning the bare DB row would leak the
   * existence (and shape) of cross-team tasks to anyone who can
   * guess a UUID — see the get / list paths in this file that
   * already gate on `canViewTask` for the same reason. Resolvers
   * return `null` indistinguishably for "does not exist" and "you
   * cannot read it"; validators surface that as a generic
   * "does not resolve to a task you can read" error so the failure
   * mode of guessing UUIDs is the same as guessing wrong types.
   *
   * `resolveTask` returns the bare DB row mapped to the wire `Task`
   * shape so validators see the same field names proposers see.
   *
   * For `findCorrelationSeal`: seal rows are not visibility-scoped
   * — a seal carries only a correlation_id and the sealing task's
   * id/type/timestamp, none of which is sensitive on its own.
   * Proposers already know the correlation_id (they passed it). The
   * sealed-by-task metadata is the same kind of information the
   * proposer would see when trying to create a duplicate — leaking
   * "yes, sealed" is exactly the API contract.
   */
  function makeAsyncValidationContext(
    callerId: string,
    callerNs: KetoNamespace,
    opts: { deferReadinessChecks?: boolean; currentTaskId?: string } = {},
  ): AsyncTaskValidationContext {
    return {
      deferReadinessChecks: opts.deferReadinessChecks,
      currentTaskId: opts.currentTaskId,
      async resolveTask(taskId: string) {
        const canView = await permissionChecker.canViewTask(
          taskId,
          callerId,
          callerNs,
        );
        if (!canView) return null;
        const row = await taskRepository.findById(taskId);
        return row ? dbTaskToWire(row) : null;
      },
      async listAttempts(taskId: string) {
        const canView = await permissionChecker.canViewTask(
          taskId,
          callerId,
          callerNs,
        );
        if (!canView) return [];
        const attempts = await taskRepository.listAttempts(taskId);
        return attempts.map(dbAttemptToWire);
      },
      async listTasksByCorrelation(correlationId: string) {
        const rows = await taskRepository.findByCorrelationId(correlationId);
        if (rows.length === 0) return [];
        const viewMap = await permissionChecker.canViewTasks(
          rows.map((row) => row.id),
          callerId,
          callerNs,
        );
        return rows
          .filter((row) => viewMap.get(row.id) === true)
          .map((row) => dbTaskToWire(row));
      },
      async findCorrelationSeal(
        correlationId: string,
      ): Promise<CorrelationSeal | null> {
        const row =
          await correlationSealRepository.findByCorrelationId(correlationId);
        if (!row) return null;
        return {
          correlationId: row.correlationId,
          sealedAt: row.sealedAt.toISOString(),
          sealedByTaskId: row.sealedByTaskId,
          sealedByTaskType: row.sealedByTaskType,
        };
      },
      async resolveContextPack(
        packId: string,
      ): Promise<ResolvedContextPack | null> {
        const canRead = await permissionChecker.canReadPack(
          packId,
          callerId,
          callerNs,
        );
        if (!canRead) return null;
        const row = await contextPackRepository.findById(packId);
        if (!row) return null;
        return {
          id: row.id,
          packCid: row.packCid,
          diaryId: row.diaryId,
        };
      },
      async resolveRenderedPack(
        packId: string,
      ): Promise<ResolvedRenderedPack | null> {
        // Rendered packs don't have their own Keto object; visibility
        // is inherited from the source context pack. Look up the row
        // first to find the source, then check pack visibility on it.
        // Order matters: if the row doesn't exist, the caller learns
        // "no" without us having issued a permission check on an
        // unrelated id.
        const row = await renderedPackRepository.findById(packId);
        if (!row) return null;
        const canRead = await permissionChecker.canReadPack(
          row.sourcePackId,
          callerId,
          callerNs,
        );
        if (!canRead) return null;
        return {
          id: row.id,
          packCid: row.packCid,
          sourcePackId: row.sourcePackId,
          diaryId: row.diaryId,
        };
      },
    };
  }

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
    async create(input: CreateTaskInput): Promise<Task> {
      const normalizedInput = normalizeTaskInputForCreate(
        input.taskType,
        input.inputPayload,
      ) as Record<string, unknown>;
      const createErrors = validateTaskCreateRequest({
        taskType: input.taskType,
        input: normalizedInput,
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

      if (input.claimCondition !== undefined) {
        const conditionErrors = validateClaimConditionShape(
          input.claimCondition,
        );
        if (conditionErrors.length > 0) {
          throw new TaskServiceError(
            'invalid',
            'Task claimCondition failed validation',
            conditionErrors,
          );
        }
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

      const canPropose = await permissionChecker.canProposeTask(
        input.diaryId,
        input.callerId,
        input.callerNs,
      );
      if (!canPropose) {
        throw new TaskServiceError(
          'forbidden',
          'Not authorized to propose tasks on this diary',
        );
      }

      await assertClaimConditionReadable(
        input.claimCondition,
        input.callerId,
        input.callerNs,
      );

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
      const inputCid = await computeJsonCid(normalizedInput);

      const expiresAt = input.expiresInSec
        ? new Date(Date.now() + input.expiresInSec * 1000)
        : null;
      const conditionSatisfied = input.claimCondition
        ? await isClaimConditionSatisfied(input.claimCondition)
        : true;
      const deferReadinessChecks =
        input.claimCondition !== undefined && !conditionSatisfied;
      const asyncCtx = makeAsyncValidationContext(
        input.callerId,
        input.callerNs,
        { deferReadinessChecks },
      );
      const asyncErrors = await validateTaskInputAsync(
        input.taskType,
        normalizedInput,
        asyncCtx,
      );
      if (asyncErrors.length > 0) {
        throw new TaskServiceError(
          'invalid',
          `Task create payload failed async validation for task type: ${input.taskType}`,
          asyncErrors,
        );
      }

      // Service-level invariant (#1096): a sealed correlation_id
      // rejects ALL subsequent task-creates against that group —
      // regardless of task type.
      if (input.correlationId) {
        const existingSeal = await asyncCtx.findCorrelationSeal(
          input.correlationId,
        );
        if (existingSeal) {
          throw new TaskServiceError(
            'invalid',
            `correlation_id ${input.correlationId} is sealed by ${existingSeal.sealedByTaskType}/${existingSeal.sealedByTaskId}; no further tasks may be added to this correlation group`,
            [
              {
                field: 'correlationId',
                message: `correlation_id ${input.correlationId} is sealed (sealed_by_task_id=${existingSeal.sealedByTaskId}, sealed_by_task_type=${existingSeal.sealedByTaskType}, sealed_at=${existingSeal.sealedAt}). Use a fresh correlation_id for new variants.`,
              },
            ],
          );
        }
      }

      const newTask: NewTask = {
        taskType: input.taskType,
        title: normalizeTaskTitle(input.title),
        tags: normalizeTaskTags(input.tags),
        teamId: input.teamId,
        diaryId: input.diaryId,
        outputKind: taskTypeDef.outputKind,
        input: normalizedInput,
        inputSchemaCid,
        inputCid,
        taskRefs: (input.references ?? []) as NewTask['taskRefs'],
        correlationId: input.correlationId ?? null,
        proposedByAgentId: input.callerIsAgent
          ? (input.proposerId ?? input.callerId)
          : null,
        proposedByHumanId: input.callerIsAgent
          ? null
          : (input.proposerId ?? input.callerId),
        claimCondition: input.claimCondition ?? null,
        status: conditionSatisfied ? 'queued' : 'waiting',
        requiredExecutorTrustLevel:
          TRUST_LEVEL_TO_DB[input.requiredExecutorTrustLevel ?? 'selfDeclared'],
        allowedProfiles: input.allowedProfiles ?? [],
        maxAttempts: input.maxAttempts ?? 1,
        dispatchTimeoutSec: input.dispatchTimeoutSec ?? null,
        runningTimeoutSec: input.runningTimeoutSec ?? null,
        expiresAt,
      };

      // Resolve task-type-declared side effects BEFORE the
      // transaction so the validator ctx (with caller-bound
      // permission checks) runs on already-committed data. The
      // effects are pure data; applying them is what the tx wraps.
      const sideEffects = await getTaskCreateSideEffects(
        input.taskType,
        normalizedInput,
        asyncCtx,
      );

      // DB-atomic block: task insert + any seal inserts commit or
      // roll back together. Throwing anywhere inside aborts the
      // entire transaction — Postgres handles the rollback; we do
      // NOT run compensating writes for anything inside this block.
      //
      // Some task types also request transactional uniqueness guards
      // via `onCreate` side effects. Those acquire an advisory lock
      // and re-check their predicate inside the transaction so
      // concurrent creates cannot slip past a preflight-only validator.
      let row: DbTask;
      try {
        row = await transactionRunner.runInTransaction(
          async () => {
            const inserted = await taskRepository.create(newTask);
            for (const effect of sideEffects) {
              if (effect.kind === 'sealCorrelation') {
                await correlationSealRepository.acquireCorrelationLock(
                  effect.correlationId,
                );
                const existing =
                  await correlationSealRepository.findByCorrelationId(
                    effect.correlationId,
                  );
                if (existing) {
                  // Lock-protected re-check: a previous create
                  // committed its seal while we were waiting on the
                  // lock. Surface a clear conflict; the surrounding
                  // tx will roll back the task we just inserted.
                  throw new TaskServiceError(
                    'conflict',
                    `correlation_id ${effect.correlationId} was sealed by another concurrent create (sealed_by_task_id=${existing.sealedByTaskId}, sealed_by_task_type=${existing.sealedByTaskType})`,
                  );
                }
                try {
                  await correlationSealRepository.create({
                    correlationId: effect.correlationId,
                    sealedByTaskId: inserted.id,
                    sealedByTaskType: input.taskType,
                    sealedByAgentId: input.callerIsAgent
                      ? (input.proposerId ?? input.callerId)
                      : null,
                    sealedByHumanId: input.callerIsAgent
                      ? null
                      : (input.proposerId ?? input.callerId),
                  });
                } catch (sealErr) {
                  // Defensive: PK violation despite the lock + re-check
                  // (e.g. the lock helper is somehow a no-op). Surface
                  // as a conflict instead of a 500.
                  if (isUniqueViolation(sealErr)) {
                    throw new TaskServiceError(
                      'conflict',
                      `correlation_id ${effect.correlationId} was sealed by another concurrent create`,
                    );
                  }
                  throw sealErr;
                }
              } else if (effect.kind === 'guardTaskUniqueness') {
                await taskRepository.acquireTaskCreateGuardLock(effect.lockKey);
                const existing =
                  await taskRepository.findActiveTaskByInputMatch({
                    taskType: effect.taskType,
                    inputMatches: effect.inputMatches,
                    excludeTaskId: inserted.id,
                  });
                if (existing) {
                  throw new TaskServiceError(
                    'conflict',
                    `task uniqueness guard rejected duplicate ${effect.taskType} create for lockKey=${effect.lockKey}; existing task=${existing.id}`,
                  );
                }
              }
            }
            return inserted;
          },
          { name: 'task.create' },
        );
      } catch (err) {
        if (err instanceof TaskServiceError) throw err;
        logger.error(
          { taskType: input.taskType, err },
          'task.create.tx_failed',
        );
        throw new TaskServiceError(
          'conflict',
          'Task create transaction failed — task was not created',
        );
      }

      // Keto grant runs OUTSIDE the DB transaction: Keto is a
      // separate system and is not transactional with Postgres. If
      // the grant fails after we've already committed the task +
      // seal, we compensate by marking the task `cancelled` and
      // deleting any seal it acquired. Order matters here: the
      // seal's FK to tasks is `restrict`, so we MUST delete the
      // seal before any operation that might delete the task row.
      // `updateStatus → cancelled` does NOT delete the task — it
      // only mutates `status` — so the FK never fires either way.
      // Delete-first is preserved anyway because it matches the
      // mental model and keeps the order valid if a future change
      // ever switches the rollback to a hard delete.
      try {
        await relationshipWriter.grantTaskParent(row.id, input.diaryId);
      } catch (err) {
        logger.error(
          { taskId: row.id, diaryId: input.diaryId, err },
          'task.create.grant_failed — rolling back task',
        );
        // Sequential, not allSettled: if seal delete fails (e.g. DB
        // hiccup), we MUST surface that rather than silently
        // continuing — a stale seal on a cancelled task locks the
        // correlation group against recovery.
        try {
          await correlationSealRepository.deleteBySealingTaskId(row.id);
        } catch (sealDelErr) {
          logger.error(
            { taskId: row.id, err: sealDelErr },
            'task.create.grant_failed.seal_cleanup_failed — manual intervention required',
          );
        }
        try {
          await taskRepository.updateStatus(row.id, 'cancelled', {
            cancelReason: 'Keto grant failed during creation',
            cancelledByAgentId: input.callerIsAgent
              ? (input.proposerId ?? input.callerId)
              : null,
            cancelledByHumanId: input.callerIsAgent
              ? null
              : (input.proposerId ?? input.callerId),
          });
        } catch (cancelErr) {
          logger.error(
            { taskId: row.id, err: cancelErr },
            'task.create.grant_failed.cancel_failed',
          );
        }
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

      // Shared filters for the page query and the total count, so `total`
      // reflects the full matching set — not just the current page.
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

    async updateMetadata(
      taskId: string,
      input: {
        title?: string | null;
        tags?: string[];
        callerId: string;
        callerNs: KetoNamespace;
      },
    ): Promise<Task> {
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

      const initialRow = await taskRepository.findById(taskId);
      if (initialRow?.status === 'waiting') {
        const canClaimWaiting = await permissionChecker.canClaimTask(
          taskId,
          callerId,
          callerNs,
        );
        if (!canClaimWaiting)
          throw new TaskServiceError(
            'forbidden',
            'Not authorized to claim this task',
          );
      }
      const row =
        initialRow?.status === 'waiting'
          ? await promoteWaitingTaskIfSatisfied(initialRow)
          : initialRow;
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
      // For freeform continuations (#1287), serialise concurrent claim
      // attempts that target the same parent attempt with a non-blocking
      // advisory lock. If the lock is already held by another daemon, we
      // signal `conflict` so the task remains queued for the next poll
      // cycle instead of having two daemons race past `claimIfQueued`
      // (which races even though it's a CAS, because the race is at the
      // *parent attempt* level — two different queued continuations of
      // the same parent could otherwise both win).
      const continueFrom = (
        row.input as
          | { continueFrom?: { taskId: string; attemptN: number } }
          | null
          | undefined
      )?.continueFrom;
      const claimedRow = await transactionRunner.runInTransaction(
        async () => {
          if (continueFrom) {
            const acquired = await taskRepository.tryAcquireContinuationLock(
              continueFrom.taskId,
              continueFrom.attemptN,
            );
            if (!acquired) {
              throw new TaskServiceError(
                'conflict',
                'Another daemon is claiming a continuation of the same parent attempt; leaving task queued',
              );
            }
          }
          return taskRepository.claimIfQueued(taskId);
        },
        { name: 'task.claim.cas' },
      );
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

      if (!updatedTask || !attempt) {
        throw new TaskServiceError(
          'not_found',
          'Claimed task or attempt could not be reloaded',
        );
      }

      logger.info({ taskId, attemptN, callerId }, 'task.claimed');
      return {
        task: dbTaskToWire(updatedTask),
        attempt: dbAttemptToWire(attempt),
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
      // Conditional update: never clobber a terminal status (most importantly
      // `cancelled`) back to `running`. A cancel can commit between this
      // heartbeat's earlier task.findById and the write below; without the
      // exclusion the heartbeat would silently un-cancel the task (#938).
      const updated = await taskRepository.updateStatusIfNotIn(
        taskId,
        'running',
        ['completed', 'failed', 'cancelled', 'expired'],
        { claimExpiresAt },
      );
      if (!updated) {
        // Lost the race — re-read and report cancellation cleanly. Other
        // terminal states bubble up as 409 (the worker can't keep working
        // on a completed/failed/expired task).
        const fresh = await taskRepository.findById(taskId);
        if (fresh && fresh.status === 'cancelled') {
          logger.debug(
            { taskId, attemptN },
            'task.heartbeat.race_lost_to_cancel',
          );
          return {
            claimExpiresAt:
              attempt.completedAt?.toISOString() ?? new Date().toISOString(),
            cancelled: true,
            cancelReason: fresh.cancelReason ?? null,
          };
        }
        throw new TaskServiceError(
          'conflict',
          `Task is already in terminal state: ${fresh?.status ?? 'unknown'}`,
        );
      }
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
        daemonState?: DaemonState | null;
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

      // Pass `task.input` so per-type validators can run cross-field
      // rules (e.g. "verification is required when input.successCriteria
      // is set" on fulfillment task types).
      const outputErrors = validateTaskOutput(
        task.taskType,
        body.output,
        task.input,
      );
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
          daemonState: body.daemonState ?? null,
        },
        'progress',
      );

      const deadline = Date.now() + EVENT_TIMEOUT_SECONDS * 1000;
      while (true) {
        const updated = await taskRepository.findById(taskId);
        if (updated && TERMINAL_STATUSES.has(updated.status)) {
          // Defense in depth (#938): if the workflow ended up in a different
          // terminal state than the one this caller asked for, return 409
          // rather than 200. This handles the race where /cancel and
          // /complete are sent in the same window and DBOS processes the
          // cancel event first — the task ends up `cancelled`, and the
          // worker's /complete request did not actually succeed.
          if (updated.status !== 'completed') {
            logger.info(
              { taskId, attemptN, status: updated.status },
              'task.complete.race_lost',
            );
            throw new TaskServiceError(
              'conflict',
              `Task ended in terminal state ${updated.status}, not completed`,
            );
          }
          logger.info(
            { taskId, attemptN, status: updated.status },
            'task.completed',
          );
          await tryPromoteSatisfiedWaitingTasks({ triggerTaskId: taskId });
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
          // Defense in depth (#938): if the workflow ended in a different
          // terminal state (typically `cancelled` when a cancel races
          // with a fail), the caller's /fail did not actually take
          // effect — return 409.
          //
          // Note: a fail with retries-left moves task→queued (non-terminal),
          // so the loop keeps polling until either the workflow truly
          // settles or the deadline fires. We don't special-case it here.
          if (updated.status !== 'failed') {
            logger.info(
              { taskId, attemptN, status: updated.status },
              'task.fail.race_lost',
            );
            throw new TaskServiceError(
              'conflict',
              `Task ended in terminal state ${updated.status}, not failed`,
            );
          }
          logger.info(
            { taskId, attemptN, status: updated.status },
            'task.failed',
          );
          await tryPromoteSatisfiedWaitingTasks({ triggerTaskId: taskId });
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
      // Id written to cancelledBy*Id. For humans this must be humans.id, not
      // the Kratos identityId used for Keto checks (see auth-principal.ts).
      // Defaults to callerId to preserve the agent path.
      cancellerId: string = callerId,
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
      // Clear claim fields together with the status write. The workflow's
      // terminal-persist tx now uses a conditional update that skips
      // already-cancelled rows (#949), so we can't rely on it to clear
      // these. Doing it here also makes the cancel side-effect atomic on
      // the row.
      const updated = await taskRepository.updateStatus(taskId, 'cancelled', {
        cancelReason: reason,
        cancelledByAgentId: isAgent ? cancellerId : null,
        cancelledByHumanId: isAgent ? null : cancellerId,
        claimAgentId: null,
        claimExpiresAt: null,
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

      if (!updated) {
        throw new TaskServiceError('not_found', 'Task not found');
      }

      logger.info({ taskId, callerId, reason }, 'task.cancelled');
      await tryPromoteSatisfiedWaitingTasks({ triggerTaskId: taskId });
      return dbTaskToWire(updated);
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

    promoteSatisfiedWaitingTasks,
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
        : (() => {
            if (
              input.attemptN === null ||
              input.attemptN === undefined ||
              input.outputCid === null ||
              input.outputCid === undefined
            ) {
              throw new TaskServiceError(
                'invalid',
                'attemptN and outputCid are required for complete attestation verification',
              );
            }
            const attemptN = input.attemptN;
            const outputCid = input.outputCid;
            return buildExecutorCompleteAttestationPayload({
              taskId: input.task.id,
              attemptN,
              outputCid,
              executorFingerprint,
            });
          })();
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
