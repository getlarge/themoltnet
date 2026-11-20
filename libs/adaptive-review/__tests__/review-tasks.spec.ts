import { MoltNetError, NetworkError } from '@themoltnet/sdk';
import { type SdkTask, TaskOutcomeError } from '@themoltnet/tasks-orchestrator';
import { describe, expect, it } from 'vitest';

import {
  isReviewCoordinatorFailure,
  scopedReviewTasks,
} from '../src/review-tasks.js';
import { IdempotentReviewTasks } from './recovery-fixture.js';

describe('coordinator failure classification', () => {
  it.each([400, 401, 403, 404, 409, 422])(
    'keeps deterministic HTTP %s rejections out of recovery',
    async (statusCode) => {
      const error = new MoltNetError('Rejected', {
        code: 'REJECTED',
        statusCode,
      });
      const tasks = scopedReviewTasks(
        {
          ...new IdempotentReviewTasks(),
          getTask: () => Promise.reject(error),
          createTask: () => Promise.reject(error),
          listAttempts: () => Promise.reject(error),
        },
        { teamId: 'team', diaryId: 'diary', correlationId: 'review' },
      );
      await expect(tasks.getTask('task')).rejects.toBe(error);
      expect(isReviewCoordinatorFailure(error)).toBe(false);
    },
  );
  it.each([408, 429, 500, 503])(
    'recovers wrapped HTTP %s interruptions',
    (statusCode) => {
      const error = new MoltNetError('Interrupted', {
        code: 'TRANSIENT',
        statusCode,
      });
      expect(
        isReviewCoordinatorFailure(
          new AggregateError([
            new Error('permanent'),
            new Error('wrapper', { cause: error }),
          ]),
        ),
      ).toBe(true);
    },
  );
  it('handles cyclic causes and preserves terminal task outcomes', () => {
    const error = new Error('cycle');
    error.cause = error;
    expect(isReviewCoordinatorFailure(error)).toBe(false);
    const terminal = new TaskOutcomeError('task', {
      kind: 'failed',
      reason: 'exhausted',
      attempts: [],
      task: { id: 'task' } as SdkTask,
    });
    terminal.cause = new NetworkError('old attempt transport failure');
    expect(isReviewCoordinatorFailure(terminal)).toBe(false);
    expect(isReviewCoordinatorFailure(new AggregateError([terminal]))).toBe(
      false,
    );
  });
});
