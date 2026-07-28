import { describe, expect, it, vi } from 'vitest';

import { emitTaskEvent } from './task-event-emitter.js';

describe('emitTaskEvent', () => {
  function makeReporter(overrides?: { record?: ReturnType<typeof vi.fn> }) {
    return {
      open: vi.fn(async () => {}),
      record: overrides?.record ?? vi.fn(async () => {}),
      finalize: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      cancelSignal: new AbortController().signal,
      cancelReason: null,
    };
  }

  it('logs reporter.record failures without rejecting the task event', async () => {
    const reporter = makeReporter({
      record: vi.fn(async () => {
        throw new Error('fetch failed');
      }),
    });
    const log = vi.fn();

    await expect(
      emitTaskEvent({
        kind: 'text_delta',
        payload: { delta: 'hello' },
        onTurnEvent: vi.fn(),
        reporter,
        taskId: 'task-1',
        attemptN: 1,
        log,
      }),
    ).resolves.toBeUndefined();

    expect(log).toHaveBeenCalledWith(
      'executePiTask: reporter.record() failed for task task-1 ' +
        'attempt 1 kind="text_delta": fetch failed',
    );
  });

  it('keeps recording when the local turn mirror throws', async () => {
    const reporter = makeReporter();

    await emitTaskEvent({
      kind: 'info',
      payload: { event: 'started' },
      onTurnEvent: () => {
        throw new Error('mirror broke');
      },
      reporter,
      taskId: 'task-1',
      attemptN: 1,
      log: vi.fn(),
    });

    expect(reporter.record).toHaveBeenCalledWith({
      kind: 'info',
      payload: { event: 'started' },
    });
  });
});
