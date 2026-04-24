import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { describe, expect, it, vi } from 'vitest';

import { makeFulfillBriefTask } from '../test-fixtures.js';
import { ApiTaskSource } from './api.js';

function makeAgent(claimImpl: TasksNamespace['claim']): Agent {
  return {
    tasks: {
      claim: claimImpl,
    },
  } as unknown as Agent;
}

describe('ApiTaskSource', () => {
  it('claims one task and returns the API attempt number', async () => {
    const task = makeFulfillBriefTask({ status: 'dispatched' });
    const claimMock = vi.fn<TasksNamespace['claim']>().mockResolvedValue({
      task,
      attempt: {
        taskId: task.id,
        attemptN: 3,
        claimedByAgentId: '33333333-3333-4333-8333-333333333333',
        runtimeId: null,
        claimedAt: '2026-04-23T10:00:00Z',
        startedAt: null,
        completedAt: null,
        status: 'claimed',
        output: null,
        outputCid: null,
        error: null,
        usage: null,
        contentSignature: null,
        signedAt: null,
      },
      traceHeaders: { traceparent: '00-abc-def-01' },
    });

    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: task.id,
      leaseTtlSec: 120,
    });

    await expect(src.claim()).resolves.toEqual({
      task,
      attemptN: 3,
      traceHeaders: { traceparent: '00-abc-def-01' },
    });
    await expect(src.claim()).resolves.toBeNull();
    expect(claimMock).toHaveBeenCalledTimes(1);
    expect(claimMock).toHaveBeenCalledWith(task.id, { leaseTtlSec: 120 });
  });

  it('surfaces claim failures', async () => {
    const claimMock = vi
      .fn<TasksNamespace['claim']>()
      .mockRejectedValue(new Error('409 Conflict'));

    const src = new ApiTaskSource({
      agent: makeAgent(claimMock),
      taskId: '11111111-1111-4111-8111-111111111111',
    });

    await expect(src.claim()).rejects.toThrow(/409 Conflict/);
  });
});
