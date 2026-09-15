import type { TasksNamespace } from '@themoltnet/sdk';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const reporterTelemetry = vi.hoisted(() => ({
  addActiveTaskEvent: vi.fn(),
}));

vi.mock('../telemetry.js', () => ({
  addActiveTaskEvent: reporterTelemetry.addActiveTaskEvent,
  traceRuntimePhase: async (
    _name: string,
    _attributes: unknown,
    run: () => Promise<unknown>,
  ) => run(),
}));

import { ApiTaskReporter } from './api.js';

function makeMockTasks(overrides: Partial<TasksNamespace> = {}): {
  tasks: TasksNamespace;
  heartbeatMock: ReturnType<typeof vi.fn<TasksNamespace['heartbeat']>>;
  appendMessagesMock: ReturnType<
    typeof vi.fn<TasksNamespace['appendMessages']>
  >;
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
    reporterTelemetry.addActiveTaskEvent.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends an immediate heartbeat on open, then periodic ones', async () => {
    const { tasks, heartbeatMock, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 1_000,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 2 });

    // Immediate heartbeat must have fired during open()
    expect(heartbeatMock).toHaveBeenCalledTimes(1);
    expect(heartbeatMock.mock.calls[0]?.slice(0, 3)).toEqual([TASK_ID, 2, {}]);
    const heartbeatOptions = heartbeatMock.mock.calls[0]?.[3];
    expect(heartbeatOptions?.signal).toBeInstanceOf(AbortSignal);

    await reporter.record({ kind: 'info', payload: { event: 'started' } });
    await vi.advanceTimersByTimeAsync(200);
    expect(appendMessagesMock).toHaveBeenCalledTimes(1);

    // Advance past the interval to fire the periodic heartbeat
    await vi.advanceTimersByTimeAsync(1_000);
    await reporter.finalize({ inputTokens: 1, outputTokens: 2 });

    // Immediate + one periodic heartbeat
    expect(heartbeatMock).toHaveBeenCalledTimes(2);
    expect(reporter.getUsage()).toEqual({ inputTokens: 1, outputTokens: 2 });
  });

  it('emits the first-useful event once per open lifecycle', async () => {
    const { tasks } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { delta: 'one' } });
    await reporter.record({ kind: 'text_delta', payload: { delta: 'two' } });
    expect(reporterTelemetry.addActiveTaskEvent).toHaveBeenCalledTimes(1);

    await reporter.open({
      taskId: '22222222-2222-4222-8222-222222222222',
      attemptN: 1,
    });
    await reporter.record({
      kind: 'tool_call_start',
      payload: { tool: 'read' },
    });

    expect(reporterTelemetry.addActiveTaskEvent).toHaveBeenCalledTimes(2);
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

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });

    await reporter.record({ kind: 'error', payload: { message: 'boom' } });
    await expect(reporter.flush()).rejects.toThrow(/append messages failed/);
  });

  // Regression for issue #921: token-streaming workloads fire thousands of
  // record() calls; the reporter must coalesce them into batched POSTs
  // instead of one POST per message.
  it('batches multiple records into a single appendMessages call', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
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

  it('flushes synchronously when the internal 50-message batch is full', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });

    for (let i = 0; i < 49; i++) {
      await reporter.record({ kind: 'text_delta', payload: { i } });
    }
    expect(appendMessagesMock).not.toHaveBeenCalled();

    await reporter.record({ kind: 'text_delta', payload: { i: 49 } });
    expect(appendMessagesMock).toHaveBeenCalledTimes(1);
  });

  it('drains the buffer on finalize', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
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

  it('uses the internal 200ms flush window', async () => {
    const { tasks, appendMessagesMock } = makeMockTasks();
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });

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
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });

    // Timer-driven flush fires and fails; the error is stashed on the
    // reporter rather than thrown from inside the timer callback.
    await vi.advanceTimersByTimeAsync(200);
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
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    for (let i = 0; i < 49; i++) {
      await reporter.record({ kind: 'text_delta', payload: { i } });
    }
    await expect(
      reporter.record({ kind: 'text_delta', payload: { i: 49 } }),
    ).rejects.toThrow(/append messages failed.*50 messages restored for retry/);

    // Next explicit flush should re-send the restored batch and succeed.
    await reporter.flush();
    expect(failingAppend).toHaveBeenCalledTimes(2);
    const [, , retryBody] = failingAppend.mock.calls[1] as unknown as [
      string,
      number,
      { messages: Array<{ payload: { i: number } }> },
    ];
    expect(retryBody.messages).toHaveLength(50);
    expect(retryBody.messages.map((m) => m.payload.i)).toEqual(
      Array.from({ length: 50 }, (_, i) => i),
    );
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
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await reporter.record({ kind: 'text_delta', payload: { i: 0 } });

    // Timer flush fires, splices the buffer, and hangs on the pending POST.
    await vi.advanceTimersByTimeAsync(200);
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

  it('retries a legacy claimant-lag 403 on the initial heartbeat', async () => {
    const error403 = Object.assign(new Error('Not authorized'), {
      statusCode: 403,
    });
    const heartbeatMock = vi
      .fn<TasksNamespace['heartbeat']>()
      .mockRejectedValueOnce(error403)
      .mockResolvedValueOnce({
        claimExpiresAt: new Date(Date.now() + 90_000).toISOString(),
        cancelled: false,
        cancelReason: null,
      });
    const { tasks } = makeMockTasks({ heartbeat: heartbeatMock });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
    });

    const openPromise = reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await vi.advanceTimersByTimeAsync(100);
    await openPromise;

    expect(heartbeatMock).toHaveBeenCalledTimes(2);
  });

  describe('appendMessages authorization failures', () => {
    it('surfaces a non-legacy 403 without retrying', async () => {
      const error403 = Object.assign(new Error('Team access denied'), {
        statusCode: 403,
      });
      const appendMock = vi
        .fn<TasksNamespace['appendMessages']>()
        .mockRejectedValue(error403);
      const { tasks } = makeMockTasks({ appendMessages: appendMock });
      const reporter = new ApiTaskReporter({
        tasks,
        heartbeatIntervalMs: 60_000,
      });

      await reporter.open({ taskId: TASK_ID, attemptN: 1 });
      await reporter.record({ kind: 'info', payload: { event: 'started' } });
      await expect(reporter.flush()).rejects.toThrow(
        /append messages failed.*Team access denied/,
      );
      expect(appendMock).toHaveBeenCalledTimes(1);
    });

    it('retries the first legacy claimant-lag 403', async () => {
      const error403 = Object.assign(new Error('Not authorized'), {
        statusCode: 403,
      });
      const appendMock = vi
        .fn<TasksNamespace['appendMessages']>()
        .mockRejectedValueOnce(error403)
        .mockResolvedValueOnce({ count: 1 });
      const { tasks } = makeMockTasks({ appendMessages: appendMock });
      const reporter = new ApiTaskReporter({
        tasks,
        heartbeatIntervalMs: 60_000,
      });

      await reporter.open({ taskId: TASK_ID, attemptN: 1 });
      await reporter.record({
        kind: 'info',
        payload: { event: 'started' },
      });
      const recordPromise = reporter.flush();
      await vi.advanceTimersByTimeAsync(100);
      await recordPromise;

      expect(appendMock).toHaveBeenCalledTimes(2);
    });
  });

  it('serializes immediate heartbeats through heartbeatNow', async () => {
    let resolveFirst: (() => void) | undefined;
    let active = 0;
    let maxActive = 0;
    const heartbeat = vi
      .fn<TasksNamespace['heartbeat']>()
      .mockImplementation(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        if (heartbeat.mock.calls.length === 1) {
          await new Promise<void>((resolve) => {
            resolveFirst = resolve;
          });
        }
        active -= 1;
        return {
          claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
          cancelled: false,
          cancelReason: null,
        };
      });
    const { tasks } = makeMockTasks({ heartbeat });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 60_000,
    });

    const opening = reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await vi.advanceTimersByTimeAsync(0);
    const manual = reporter.heartbeatNow();
    await vi.advanceTimersByTimeAsync(0);
    expect(heartbeat).toHaveBeenCalledTimes(1);

    resolveFirst?.();
    await opening;
    await manual;

    expect(heartbeat).toHaveBeenCalledTimes(2);
    expect(maxActive).toBe(1);
  });

  it('coalesces periodic ticks while a heartbeat is in flight', async () => {
    let resolvePeriodic: (() => void) | undefined;
    const heartbeat = vi
      .fn<TasksNamespace['heartbeat']>()
      .mockResolvedValueOnce({
        claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        cancelled: false,
        cancelReason: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolvePeriodic = () =>
              resolve({
                claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                cancelled: false,
                cancelReason: null,
              });
          }),
      );
    const { tasks } = makeMockTasks({ heartbeat });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 1_000,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(heartbeat).toHaveBeenCalledTimes(2);
    resolvePeriodic?.();
    await reporter.close();
  });

  it('drains a queued immediate heartbeat before close returns', async () => {
    let resolveHeartbeat: (() => void) | undefined;
    const heartbeat = vi
      .fn<TasksNamespace['heartbeat']>()
      .mockResolvedValueOnce({
        claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        cancelled: false,
        cancelReason: null,
      })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveHeartbeat = () =>
              resolve({
                claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
                cancelled: false,
                cancelReason: null,
              });
          }),
      );
    const { tasks } = makeMockTasks({ heartbeat });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 0,
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 1 });
    const immediate = reporter.heartbeatNow();
    await vi.advanceTimersByTimeAsync(0);
    const closing = reporter.close();
    let closed = false;
    void closing.then(() => {
      closed = true;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(closed).toBe(false);
    resolveHeartbeat?.();
    await immediate;
    await closing;
    expect(closed).toBe(true);
  });

  it('logs periodic heartbeat failures with task context', async () => {
    const failure = new Error('upstream unavailable');
    const heartbeat = vi
      .fn<TasksNamespace['heartbeat']>()
      .mockResolvedValueOnce({
        claimExpiresAt: new Date(Date.now() + 300_000).toISOString(),
        cancelled: false,
        cancelReason: null,
      })
      .mockRejectedValueOnce(failure);
    const warn = vi.fn();
    const { tasks } = makeMockTasks({ heartbeat });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 1_000,
      logger: { warn },
    });

    await reporter.open({ taskId: TASK_ID, attemptN: 7 });
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(warn).toHaveBeenCalledWith(
      { err: failure, taskId: TASK_ID, attemptN: 7 },
      'agent-runtime.reporter.heartbeat_failed',
    );
    await reporter.close();
  });

  it('aborts a heartbeat request after the internal deadline', async () => {
    const heartbeat = vi.fn<TasksNamespace['heartbeat']>(
      (_id, _attempt, _body, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener('abort', () => {
            reject(
              options.signal?.reason instanceof Error
                ? options.signal.reason
                : new Error('Heartbeat request aborted'),
            );
          });
        }),
    );
    const warn = vi.fn();
    const { tasks } = makeMockTasks({ heartbeat });
    const reporter = new ApiTaskReporter({
      tasks,
      heartbeatIntervalMs: 0,
      logger: { warn },
    });

    const opening = reporter.open({ taskId: TASK_ID, attemptN: 1 });
    const rejected = expect(opening).rejects.toThrow(
      'Heartbeat request timed out',
    );
    await vi.advanceTimersByTimeAsync(30_000);

    await rejected;
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
