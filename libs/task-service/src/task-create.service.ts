import type { ExecutorTrustLevel } from '@moltnet/crypto-service';
import {
  computeJsonCid,
  decodeBytesCidToSha256,
} from '@moltnet/crypto-service';
import type { NewTask, Task as DbTask } from '@moltnet/database';
import {
  BUILT_IN_TASK_TYPES,
  getTaskCreateSideEffects,
  getTaskTypeRegistry,
  normalizeTaskInputForCreate,
  type OutputKind,
  type Task,
  type TaskRef,
  validateTaskCreateRequest,
  validateTaskInputAsync,
} from '@moltnet/tasks';
import type { TSchema } from 'typebox';

import { validateClaimConditionShape } from './claim-condition.js';
import type { TaskConditionHelpers } from './task-conditions.js';
import {
  isUniqueViolation,
  normalizeTaskTags,
  normalizeTaskTitle,
  TaskServiceError,
} from './task-service.shared.js';
import type { CreateTaskInput, TaskServiceDeps } from './task-service.types.js';
import type { MakeAsyncValidationContext } from './task-validation-context.js';
import { dbTaskToWire } from './wire-mappers.js';

interface TaskTypeEntry {
  readonly name: string;
  readonly inputSchema: TSchema;
  readonly outputSchema: TSchema;
  readonly outputKind: OutputKind;
  readonly requiresReferences: boolean;
  readonly validateInput?: (input: unknown) => string | null;
}

const TRUST_LEVEL_TO_DB = {
  selfDeclared: 'self_declared',
  agentSigned: 'agent_signed',
  releaseVerifiedTool: 'release_verified_tool',
  sandboxAttested: 'sandbox_attested',
} as const satisfies Record<
  ExecutorTrustLevel,
  DbTask['requiredExecutorTrustLevel']
>;

export interface TaskCreateService {
  create(input: CreateTaskInput): Promise<Task>;
}

export function createTaskCreateService(
  deps: Pick<
    TaskServiceDeps,
    | 'taskRepository'
    | 'taskArtifactRepository'
    | 'taskInputArtifactObjectStore'
    | 'diaryRepository'
    | 'correlationSealRepository'
    | 'permissionChecker'
    | 'relationshipWriter'
    | 'transactionRunner'
    | 'logger'
    | 'taskLifetime'
  >,
  conditionHelpers: Pick<
    TaskConditionHelpers,
    'assertClaimConditionReadable' | 'isClaimConditionSatisfied'
  >,
  makeAsyncValidationContext: MakeAsyncValidationContext,
): TaskCreateService {
  const {
    taskRepository,
    taskArtifactRepository,
    taskInputArtifactObjectStore,
    diaryRepository,
    correlationSealRepository,
    permissionChecker,
    relationshipWriter,
    transactionRunner,
    logger,
    taskLifetime,
  } = deps;
  const { assertClaimConditionReadable, isClaimConditionSatisfied } =
    conditionHelpers;
  const defaultExpiresInSec = taskLifetime?.defaultExpiresInSec ?? null;
  const maxExpiresInSec = taskLifetime?.maxExpiresInSec ?? null;

  return {
    async create(input) {
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

      if (
        input.expiresInSec !== undefined &&
        maxExpiresInSec !== null &&
        input.expiresInSec > maxExpiresInSec
      ) {
        throw new TaskServiceError(
          'invalid',
          `expiresInSec exceeds maximum task lifetime (${maxExpiresInSec}s)`,
          [
            {
              field: 'expiresInSec',
              message: `expiresInSec must be <= ${maxExpiresInSec}`,
            },
          ],
        );
      }

      const effectiveExpiresInSec =
        input.expiresInSec ?? defaultExpiresInSec ?? null;
      const expiresAt =
        effectiveExpiresInSec !== null
          ? new Date(Date.now() + effectiveExpiresInSec * 1000)
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

      const resolvedInputArtifacts = await resolveInputArtifacts(
        taskInputArtifactObjectStore,
        input.teamId,
        input.references as TaskRef[] | undefined,
      );

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

      const sideEffects = await getTaskCreateSideEffects(
        input.taskType,
        normalizedInput,
        asyncCtx,
      );

      let row: DbTask;
      try {
        row = await transactionRunner.runInTransaction(
          async () => {
            const inserted = await taskRepository.create(newTask);
            await taskArtifactRepository.createManyForTask(
              resolvedInputArtifacts.map((artifact) => ({
                cid: artifact.cid,
                contentEncoding: null,
                contentType: artifact.contentType,
                createdByAgentId: input.callerIsAgent
                  ? (input.proposerId ?? input.callerId)
                  : null,
                kind: artifact.kind,
                objectKey: artifact.objectKey,
                sha256: artifact.sha256,
                sizeBytes: artifact.sizeBytes,
                taskId: inserted.id,
                teamId: input.teamId,
                title: artifact.title,
              })),
            );
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
          'Task create transaction failed - task was not created',
        );
      }

      try {
        await relationshipWriter.grantTaskParent(row.id, input.diaryId);
      } catch (err) {
        logger.error(
          { taskId: row.id, diaryId: input.diaryId, err },
          'task.create.grant_failed - rolling back task',
        );
        try {
          await correlationSealRepository.deleteBySealingTaskId(row.id);
        } catch (sealDelErr) {
          logger.error(
            { taskId: row.id, err: sealDelErr },
            'task.create.grant_failed.seal_cleanup_failed - manual intervention required',
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
          'Failed to register task ownership - task was rolled back',
        );
      }

      logger.info({ taskId: row.id, taskType: row.taskType }, 'task.created');
      return dbTaskToWire(row);
    },
  };
}

interface ResolvedInputArtifact {
  cid: string;
  contentType: string;
  kind: string;
  objectKey: string;
  sha256: string;
  sizeBytes: number;
  title: string;
}

/**
 * Resolve input-artifact references (taskId null + artifact without an
 * attempt) against staged objects in team storage. Staged uploads create
 * no metadata row, so existence is checked against the object store and
 * the artifact row is built from the reference plus object metadata; the
 * sha256 is recovered from the CID itself. Reference shape rules
 * (outputCid presence/equality, attemptN combos) are enforced earlier by
 * validateTaskCreateRequest via validateTaskReferences.
 *
 * A staged object could in principle be swept between this check and the
 * transaction commit; the sweep re-verifies row existence immediately
 * before deleting and the grace window covers freshly staged objects, so
 * the remaining race is milliseconds wide on objects already past the
 * grace window.
 */
async function resolveInputArtifacts(
  objectStore: TaskServiceDeps['taskInputArtifactObjectStore'],
  teamId: string,
  references: TaskRef[] | undefined,
): Promise<ResolvedInputArtifact[]> {
  const inputRefs = (references ?? []).flatMap((ref) =>
    ref.taskId === null &&
    ref.artifact !== undefined &&
    ref.artifact.attemptN === undefined
      ? [ref.artifact]
      : [],
  );
  if (inputRefs.length === 0) return [];

  const invalid = (message: string): TaskServiceError =>
    new TaskServiceError(
      'invalid',
      'Task references failed input artifact validation',
      [{ field: 'references', message }],
    );

  const seenCids = new Set<string>();
  for (const artifact of inputRefs) {
    if (seenCids.has(artifact.cid)) {
      throw invalid(`duplicate input artifact CID: ${artifact.cid}`);
    }
    seenCids.add(artifact.cid);
  }

  return Promise.all(
    inputRefs.map(async (artifact) => {
      let sha256: string;
      try {
        sha256 = decodeBytesCidToSha256(artifact.cid);
      } catch {
        throw invalid(
          `input artifact CID is not a raw-bytes sha2-256 CIDv1: ${artifact.cid}`,
        );
      }

      const objectKey = objectStore.buildObjectKey(teamId, artifact.cid);
      let head;
      try {
        head = await objectStore.headObject(objectKey);
      } catch (err) {
        throw new TaskServiceError(
          'unavailable',
          `Task input artifact storage is unavailable: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      if (!head) {
        throw invalid(
          `input artifact object not found for CID ${artifact.cid}; stage it first via PUT /task-artifacts/staged`,
        );
      }
      if (head.contentLength === undefined) {
        throw invalid(
          `input artifact object for CID ${artifact.cid} has no content length`,
        );
      }

      return {
        cid: artifact.cid,
        contentType:
          artifact.contentType ??
          head.contentType ??
          'application/octet-stream',
        kind: artifact.kind ?? 'input',
        objectKey,
        sha256,
        sizeBytes: head.contentLength,
        title: artifact.title ?? artifact.cid,
      };
    }),
  );
}
