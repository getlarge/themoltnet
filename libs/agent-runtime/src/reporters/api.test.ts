import type { TasksNamespace } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiTaskReporter } from './api.js';

function makeMockTasks(overrides: Partial<TasksNamespace> = {}): {
  tasks: TasksNamespace;
  heartbeatMock: ReturnType<typeof vi.fn>;
  appendMessagesMock: ReturnType<typeof vi.fn>;
} {
  const heartbeatMock = vi.fn<TasksNamespace['heartbeat']>().mockResolvedValue({
    claimExpiresAt: new Date(Date.now() + 90_000).toISOString(),
  });
  const appendMessagesMock = vi
    .fn<TasksNamespace['appendMessages']>()
    .mockResolvedValue({ count: 1 });
  const tasks = {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    claim: vi.fn(),
    heartbeat: heartbeatMock,
    complete: vi.fn(),
    fail: vi.fn(),
    cancel: vi.fn(),
    listAttempts: vi.fn(),
    listMessages: vi.fn(),
    appendMessages: appendMessagesMock,
    ...overrides,
  } as unknown as TasksNamespace;
  return { tasks, heartbeatMock, appendMessagesMock };
}

describe('ApiTaskReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an immediate heartbeat on open, then periodic ones', async () => {
    const { tasks, heartbeatMock, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      leaseTtlSec: 90,
      heartbeatIntervalMs: 1_000,
    });

    await reporter.open({
      taskId: '11111111-1111-4111-8111-111111111111',
      attemptN: 2,
    });

    // Immediate heartbeat must have fired during open()
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock).toHaveBeenCalledWith(
      '11111111-1111-4111-8111-111111111111',
      2,
      { leaseTtlSec: 90 },
    );

    await reporter.record({ kind: 'info', payload: { event: 'started' } });

    expect(appendMessagesMock).toHaveBeenCalledTimes(1);

    // Advance past the interval to fire the periodic heartbeat
    await vi.advanceTimersByTimeAsync(1_000);
    await reporter.finalize({ inputTokens: 1, outputTokens: 2 });

    // Immediate + one periodic heartbeat
    expect(heartbeatMock).toHaveBeenCalledTimes(2);
    expect(reporter.getUsage()).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('throws when appending messages fails', async () => {
    const failingAppend = vi
      .fn<TasksNamespace['appendMessages']>()
      .mockRejectedValue(new Error('network error'));
    const { tasks } = makeMockTasks({ appendMessages: failingAppend });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
    });

    await reporter.open({
      taskId: '11111111-1111-4111-8111-111111111111',
      attemptN: 1,
    });

    await expect(
      reporter.record({ kind: 'error', payload: { message: 'boom' } }),
    ).rejects.toThrow(/append messages failed/);
  });
});
