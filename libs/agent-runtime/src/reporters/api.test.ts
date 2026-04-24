import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiTaskReporter } from './api.js';

describe('ApiTaskReporter', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an immediate heartbeat on open, then periodic ones', async () => {
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

    // Immediate heartbeat must have fired during open()
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/tasks/11111111-1111-4111-8111-111111111111/attempts/2/heartbeat',
      expect.objectContaining({ method: 'POST' }),
    );

    await reporter.record({
      kind: 'info',
      payload: { event: 'started' },
    });

    // Advance past the interval to fire the periodic heartbeat
    await vi.advanceTimersByTimeAsync(1_000);
    await reporter.finalize({ inputTokens: 1, outputTokens: 2 });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.test/tasks/11111111-1111-4111-8111-111111111111/attempts/2/messages',
      expect.objectContaining({ method: 'POST' }),
    );
    // Immediate + one periodic heartbeat
    expect(
      fetchMock.mock.calls.filter((c) =>
        (c[0] as string).endsWith('/heartbeat'),
      ),
    ).toHaveLength(2);
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

    // open() fires an immediate heartbeat which will fail — that's fine for
    // this test; we only care that record() throws on a 500.
    await reporter
      .open({
        taskId: '11111111-1111-4111-8111-111111111111',
        attemptN: 1,
      })
      .catch(() => {});

    await expect(
      reporter.record({ kind: 'error', payload: { message: 'boom' } }),
    ).rejects.toThrow(/append messages failed/);
  });
});
