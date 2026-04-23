import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiTaskReporter } from './api.js';

describe('ApiTaskReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('posts messages and heartbeats via the Tasks API', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    const reporter = new ApiTaskReporter({
      baseUrl: 'https://api.example.test/',
      auth: async () => 'token-123',
      leaseTtlSec: 90,
      heartbeatIntervalMs: 1_000,
      fetch: fetchMock,
    });

    await reporter.open({
      taskId: '11111111-1111-4111-8111-111111111111',
      attemptN: 2,
    });
    await reporter.record({
      kind: 'info',
      payload: { event: 'started' },
    });

    await vi.advanceTimersByTimeAsync(1_000);
    await reporter.finalize({ inputTokens: 1, outputTokens: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/tasks/11111111-1111-4111-8111-111111111111/attempts/2/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/tasks/11111111-1111-4111-8111-111111111111/attempts/2/heartbeat',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(reporter.getUsage()).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('throws when appending messages fails', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response('bad', { status: 500, statusText: 'Server Error' }),
      );
    const reporter = new ApiTaskReporter({
      baseUrl: 'https://api.example.test',
      auth: async () => 'token-123',
      heartbeatIntervalMs: 0,
      fetch: fetchMock,
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
