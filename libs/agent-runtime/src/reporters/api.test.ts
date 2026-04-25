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
    cancelled: false,
    cancelReason: null,
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

const TASK_ID = '11111111-1111-4111-8111-111111111111';

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
      // Single-message batches preserve the legacy one-POST-per-record
      // behaviour this test was originally written against.
      maxBatchSize: 1,
      flushIntervalMs: 0,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 2 });

    // Immediate heartbeat must have fired during open()
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock).toHaveBeenCalledWith(TASK_ID, 2, { leaseTtlSec: 90 });

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
      maxBatchSize: 1,
      flushIntervalMs: 0,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });

    await expect(
      reporter.record({ kind: 'error', payload: { message: 'boom' } }),
    ).rejects.toThrow(/append messages failed/);
  });

  // Regression for issue #921: token-streaming workloads fire thousands of
  // record() calls; the reporter must coalesce them into batched POSTs
  // instead of one POST per message.
  it('batches multiple records into a single appendMessages call', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 10,
      flushIntervalMs: 200,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });

    for (let i = 0; i < 5; i++) {
      await reporter.record({
        kind: 'text_delta',
        payload: { index: i, text: `chunk-${i}` },
      });
    }

    // Nothing has been flushed yet — below size threshold, timer not fired.
    expect(appendMessagesMock).not.toHaveBeenCalled();

    // Timer fires; single POST carries all 5 messages.
    await vi.advanceTimersByTimeAsync(200);
    expect(appendMessagesMock).toHaveBeenCalledTimes(1);
    const [calledTaskId, calledAttempt, body] = appendMessagesMock.mock
      .calls[0] as [
      string,
      number,
      { messages: Array<{ kind: string; payload: Record<string, unknown> }> },
    ];
    expect(calledTaskId).toBe(TASK_ID);
    expect(calledAttempt).toBe(1);
    expect(body.messages).toHaveLength(5);
    expect(body.messages[0]).toMatchObject({
      kind: 'text_delta',
      payload: { index: 0, text: 'chunk-0' },
    });
    expect(body.messages[4]).toMatchObject({
      kind: 'text_delta',
      payload: { index: 4, text: 'chunk-4' },
    });
  });

  it('flushes synchronously when buffer reaches maxBatchSize', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 3,
      flushIntervalMs: 200,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });

    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });
    await reporter.record({ kind: 'text_delta', payload: { i: 1 } });
    expect(appendMessagesMock).not.toHaveBeenCalled();

    // Third record hits the size cap and forces a flush without waiting
    // for the interval.
    await reporter.record({ kind: 'text_delta', payload: { i: 2 } });
    expect(appendMessagesMock).toHaveBeenCalledTimes(1);
  });

  it('drains the buffer on finalize', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 100,
      flushIntervalMs: 10_000,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });
    await reporter.record({ kind: 'text_delta', payload: { i: 1 } });

    // Nothing flushed yet: buffer under size, timer not fired.
    expect(appendMessagesMock).not.toHaveBeenCalled();

    await reporter.finalize({ inputTokens: 0, outputTokens: 0 });

    expect(appendMessagesMock).toHaveBeenCalledTimes(1);
    const [, , body] = appendMessagesMock.mock.calls[0] as [
      string,
      number,
      { messages: unknown[] },
    ];
    expect(body.messages).toHaveLength(2);
  });

  it('falls back to default batching when options are NaN / non-integer', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    // `??` would pass NaN through; we want the reporter to treat
    // non-integer inputs as "use default". Otherwise `buffer.length >= NaN`
    // is always false and batching is silently disabled.
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: Number.NaN,
      flushIntervalMs: Number.NaN,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });

    // Default flushIntervalMs (200ms) should fire.
    await vi.advanceTimersByTimeAsync(200);
    expect(appendMessagesMock).toHaveBeenCalledTimes(1);
  });

  it('surfaces errors from a timer-driven flush on the next record', async () => {
    const failingAppend = vi
      .fn<TasksNamespace['appendMessages']>()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValue({ count: 1 });
    const { tasks } = makeMockTasks({ appendMessages: failingAppend });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 10,
      flushIntervalMs: 100,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });

    // Timer-driven flush fires and fails; the error is stashed on the
    // reporter rather than thrown from inside the timer callback.
    await vi.advanceTimersByTimeAsync(100);
    // Give the rejected promise a microtask turn to settle.
    await vi.advanceTimersByTimeAsync(0);

    // Next record surfaces the stashed error, then continues cleanly.
    await expect(
      reporter.record({ kind: 'text_delta', payload: { i: 1 } }),
    ).rejects.toThrow(/append messages failed/);
  });

  // Regression for PR #925 review: batch must be restored to the front of
  // the buffer on flush failure so the next flush can retry, rather than
  // silently dropped by the splice-before-POST pattern.
  it('restores the batch to the buffer on flush failure for retry', async () => {
    const failingAppend = vi
      .fn<TasksNamespace['appendMessages']>()
      .mockRejectedValueOnce(new Error('503 upstream'))
      .mockResolvedValue({ count: 2 });
    const { tasks } = makeMockTasks({ appendMessages: failingAppend });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 2,
      flushIntervalMs: 0,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });
    // Second record hits size cap → flush → fails; error should surface
    // AND the two messages should be back in the buffer for retry.
    await expect(
      reporter.record({ kind: 'text_delta', payload: { i: 1 } }),
    ).rejects.toThrow(/append messages failed.*2 messages restored for retry/);

    // Next explicit flush should re-send the restored batch and succeed.
    await reporter.flush();
    expect(failingAppend).toHaveBeenCalledTimes(2);
    const [, , retryBody] = failingAppend.mock.calls[1] as unknown as [
      string,
      number,
      { messages: Array<{ payload: { i: number } }> },
    ];
    expect(retryBody.messages).toHaveLength(2);
    expect(retryBody.messages.map((m) => m.payload.i)).toEqual([0, 1]);
  });

  // Regression for PR #925 review: close() must await any in-flight POST
  // before returning, otherwise a timer-driven flush racing with close()
  // leaves a floating HTTP request whose error lands in a dead timer catch.
  it('awaits in-flight flushes before returning from close()', async () => {
    let resolveFlush: ((value: { count: number }) => void) | null = null;
    const slowAppend = vi
      .fn<TasksNamespace['appendMessages']>()
      .mockImplementationOnce(
        () =>
          new Promise<{ count: number }>((resolve) => {
            resolveFlush = resolve;
          }),
      );
    const { tasks } = makeMockTasks({ appendMessages: slowAppend });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
      maxBatchSize: 10,
      flushIntervalMs: 100,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });

    // Timer flush fires, splices the buffer, and hangs on the pending POST.
    await vi.advanceTimersByTimeAsync(100);
    expect(slowAppend).toHaveBeenCalledTimes(1);

    // Buffer is now empty. Start close(); it must await the in-flight POST
    // instead of returning immediately on the empty-buffer fast path.
    const closePromise = reporter.close();
    let closed = false;
    void closePromise.then(() => {
      closed = true;
    });

    // Micro-yield: close() should NOT have resolved yet.
    await vi.advanceTimersByTimeAsync(0);
    expect(closed).toBe(false);

    // Let the in-flight POST settle; now close() completes.
    resolveFlush!({ count: 1 });
    await closePromise;
    expect(closed).toBe(true);
  });
});
