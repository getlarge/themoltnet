import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import {
  cancelSupersededTasks,
  parseSupersessionTags,
} from './cancel-superseded.js';

describe('cancelSupersededTasks', () => {
  it('cancels active tasks in the same typed correlation and tag scope', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [{ id: 'old-running' }, { id: 'old-queued' }],
    });
    const cancel = vi.fn().mockResolvedValue({});
    const agent = { tasks: { list, cancel } } as unknown as Agent;

    const cancelled = await cancelSupersededTasks({
      agent,
      teamId: 'team-id',
      taskType: 'pr_review',
      correlationId: 'correlation-id',
      selectorTags: ['workflow:legreffier-complexity-review', 'pr:1810'],
    });

    expect(list).toHaveBeenCalledWith(
      {
        taskTypes: ['pr_review'],
        statuses: ['waiting', 'queued', 'dispatched', 'running'],
        correlationId: 'correlation-id',
        tags: ['workflow:legreffier-complexity-review', 'pr:1810'],
        limit: 100,
      },
      { teamId: 'team-id' },
    );
    expect(cancel).toHaveBeenCalledTimes(2);
    expect(cancelled).toEqual(['old-running', 'old-queued']);
  });

  it('normalizes comma and newline separated selector tags', () => {
    expect(parseSupersessionTags(' workflow:review,pr:42\npr:42\r\n')).toEqual([
      'workflow:review',
      'pr:42',
    ]);
  });
});
