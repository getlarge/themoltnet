import type { KetoNamespace } from '@moltnet/auth';
import type {
  AsyncTaskValidationContext,
  CorrelationSeal,
  ResolvedContextPack,
  ResolvedRenderedPack,
} from '@moltnet/tasks';

import type { TaskServiceDeps } from './task-service.types.js';
import { dbAttemptToWire, dbTaskToWire } from './wire-mappers.js';

export type MakeAsyncValidationContext = (
  callerId: string,
  callerNs: KetoNamespace,
  opts?: { deferReadinessChecks?: boolean; currentTaskId?: string },
) => AsyncTaskValidationContext;

export function createAsyncValidationContextFactory(
  deps: Pick<
    TaskServiceDeps,
    | 'taskRepository'
    | 'contextPackRepository'
    | 'renderedPackRepository'
    | 'correlationSealRepository'
    | 'permissionChecker'
  >,
): MakeAsyncValidationContext {
  const {
    taskRepository,
    contextPackRepository,
    renderedPackRepository,
    correlationSealRepository,
    permissionChecker,
  } = deps;

  /**
   * Build the async validation context (#1096) for one create call.
   * The ctx exposes read-only lookups; side effects declared via
   * `onCreate` are applied separately AFTER the task is inserted, so
   * the ctx is safe to call from any task-type validator.
   *
   * Visibility: every resolver runs the caller-bound Keto check
   * before returning a row. Returning the bare DB row would leak the
   * existence and shape of cross-team tasks to anyone who can guess a UUID.
   * Resolvers return `null` indistinguishably for "does not exist" and
   * "you cannot read it"; validators surface that as a generic failure.
   *
   * For `findCorrelationSeal`: seal rows are not visibility-scoped. A seal
   * carries only correlation metadata, and knowing "yes, sealed" is the API
   * contract for callers that already supplied that correlation id.
   */
  return function makeAsyncValidationContext(
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
  };
}
