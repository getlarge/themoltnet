import { isTransientMoltNetError } from '@themoltnet/sdk';
import type { TaskClient } from '@themoltnet/tasks-orchestrator';

/** A failed API operation is not evidence of a terminal child-task failure. */
export class ReviewCoordinatorError extends Error {
  constructor(operation: string, cause: unknown) {
    super(`Review coordinator ${operation} failed`, { cause });
    this.name = 'ReviewCoordinatorError';
  }
}

export function isReviewCoordinatorFailure(reason: unknown): boolean {
  return (
    reason instanceof ReviewCoordinatorError || isTransientMoltNetError(reason)
  );
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
      throw new ReviewCoordinatorError(name, cause);
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
    ...(listMessages
      ? {
          listMessages: (id: string, attemptN: number) =>
            request('message read', () => listMessages(id, attemptN)),
        }
      : {}),
  };
}
