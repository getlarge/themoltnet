import { isTransientMoltNetError } from '@themoltnet/sdk';
import {
  type TaskClient,
  TaskOutcomeError,
} from '@themoltnet/tasks-orchestrator';

/** A failed API operation is not evidence of a terminal child-task failure. */
export class ReviewCoordinatorError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Review coordinator ${operation} failed`, { cause });
    this.name = 'ReviewCoordinatorError';
  }
}

/** Inspect transport wrappers, but never reinterpret a terminal task outcome. */
export function isReviewCoordinatorFailure(reason: unknown): boolean {
  const seen = new Set<unknown>();
  const recoverable = (error: unknown): boolean => {
    if (
      !(error instanceof Error) ||
      seen.has(error) ||
      error instanceof TaskOutcomeError ||
      error.name === 'TaskOutcomeError'
    )
      return false;
    seen.add(error);
    if (
      error instanceof ReviewCoordinatorError ||
      isTransientMoltNetError(error) ||
      error.name === 'AbortError'
    )
      return true;
    return (
      (error instanceof AggregateError && error.errors.some(recoverable)) ||
      recoverable(error.cause)
    );
  };
  return recoverable(reason);
}

/** Enforce review scope for every child, including repairs and replacements. */
export function scopedReviewTasks(
  tasks: TaskClient,
  scope: { correlationId: string; teamId: string; diaryId: string },
): TaskClient {
  const request = async <T>(
    name: string,
    run: () => Promise<T>,
  ): Promise<T> => {
    try {
      return await run();
    } catch (cause) {
      // Preserve the shared waiter's bounded transient-read retries.
      if (isTransientMoltNetError(cause)) throw cause;
      if (isReviewCoordinatorFailure(cause))
        throw new ReviewCoordinatorError(name, cause);
      throw cause;
    }
  };
  const listMessages = tasks.listMessages?.bind(tasks);
  return {
    createTask(body, options) {
      if (
        body.teamId !== scope.teamId ||
        body.diaryId !== scope.diaryId ||
        (body.correlationId !== undefined &&
          body.correlationId !== null &&
          body.correlationId !== scope.correlationId)
      )
        throw new Error('Child task scope differs from its review');
      return request('task creation', () =>
        tasks.createTask(
          { ...body, correlationId: scope.correlationId },
          options,
        ),
      );
    },
    getTask: (id) => request('task read', () => tasks.getTask(id)),
    listAttempts: (id) => request('attempt read', () => tasks.listAttempts(id)),
    ...(tasks.stageArtifact
      ? {
          stageArtifact: (body, query, options) => {
            if (options.teamId !== scope.teamId)
              throw new Error('Artifact scope differs from its review');
            return request('artifact staging', () =>
              tasks.stageArtifact!(body, query, options),
            );
          },
        }
      : {}),
    ...(listMessages
      ? {
          listMessages: (id: string, attemptN: number) =>
            request('message read', () => listMessages(id, attemptN)),
        }
      : {}),
  };
}
