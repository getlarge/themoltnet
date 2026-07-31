import type { Agent } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { cancelCorrelatedTasks } from './run-cleanup.js';

describe('cancelCorrelatedTasks', () => {
  it('cancels unclaimed tasks, preserves running work, and contains sibling failures', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [
        { id: 'waiting', status: 'waiting' },
        { id: 'queued', status: 'queued' },
        { id: 'done', status: 'completed' },
        { id: 'running', status: 'running' },
        { id: 'dispatched', status: 'dispatched' },
      ],
    });
    const cancel = vi
      .fn()
      .mockRejectedValueOnce(new Error('raced'))
      .mockResolvedValueOnce(undefined);
    const agent = {
      tasks: {
        list,
        cancel,
      },
    } as unknown as Agent;

    await expect(
      cancelCorrelatedTasks(agent, 'team-1', 'corr-1'),
    ).resolves.toBe(1);
    expect(list).toHaveBeenCalledWith(
      { correlationId: 'corr-1' },
      { teamId: 'team-1' },
    );
    expect(cancel).toHaveBeenNthCalledWith(1, 'waiting', {
      reason: 'multi-lens-review run aborted',
    });
    expect(cancel).toHaveBeenNthCalledWith(2, 'queued', {
      reason: 'multi-lens-review run aborted',
    });
  });
});
