import type { Task as DbTask } from '@moltnet/database';
import type { ClaimCondition } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import {
  collectConditionTaskIds,
  evaluateClaimConditionFromTasks,
} from './claim-condition.js';

function task(
  id: string,
  status: DbTask['status'],
  acceptedAttemptN: number | null = null,
) {
  return { id, status, acceptedAttemptN } as DbTask;
}

describe('claim-condition evaluator', () => {
  const first = '11111111-1111-4111-8111-111111111111';
  const second = '22222222-2222-4222-8222-222222222222';
  const missing = '33333333-3333-4333-8333-333333333333';

  it('matches task_status against any allowed status', () => {
    const condition: ClaimCondition = {
      op: 'task_status',
      taskId: first,
      statuses: ['failed', 'completed'],
    };

    expect(
      evaluateClaimConditionFromTasks(
        condition,
        new Map([[first, task(first, 'failed')]]),
      ),
    ).toBe(true);
  });

  it('treats missing referenced tasks as unsatisfied', () => {
    expect(
      evaluateClaimConditionFromTasks(
        { op: 'task_accepted', taskId: missing },
        new Map(),
      ),
    ).toBe(false);
  });

  it('requires every child for all and any child for any', () => {
    const condition: ClaimCondition = {
      op: 'all',
      conditions: [
        { op: 'task_accepted', taskId: first },
        {
          op: 'any',
          conditions: [
            { op: 'task_status', taskId: second, statuses: ['failed'] },
            { op: 'task_status', taskId: second, statuses: ['cancelled'] },
          ],
        },
      ],
    };

    expect(
      evaluateClaimConditionFromTasks(
        condition,
        new Map([
          [first, task(first, 'completed', 1)],
          [second, task(second, 'failed')],
        ]),
      ),
    ).toBe(true);
    expect(
      evaluateClaimConditionFromTasks(
        condition,
        new Map([
          [first, task(first, 'completed', 1)],
          [second, task(second, 'running')],
        ]),
      ),
    ).toBe(false);
  });

  it('collects task ids across nested all/any branches once', () => {
    const condition: ClaimCondition = {
      op: 'any',
      conditions: [
        { op: 'task_accepted', taskId: first },
        {
          op: 'all',
          conditions: [
            { op: 'task_status', taskId: first, statuses: ['completed'] },
            { op: 'task_status', taskId: second, statuses: ['failed'] },
          ],
        },
      ],
    };

    expect([...collectConditionTaskIds(condition)]).toEqual([first, second]);
  });
});
