import type { Task, TaskOutput } from '@moltnet/tasks';
import { describe, expect, it, vi } from 'vitest';

import { TaskExecutionInterrupted } from '../src/interrupted.js';

const runtimeTelemetry = vi.hoisted(() => ({
  attributes: new Map<string, unknown>(),
}));

vi.mock('../src/telemetry.js', () => ({
  traceRuntimePhase: async (
    _name: string,
    _attributes: unknown,
    run: (span: {
      setAttribute: (name: string, value: unknown) => void;
    }) => Promise<unknown>,
  ) =>
    run({
      setAttribute: (name, value) => {
        runtimeTelemetry.attributes.set(name, value);
      },
    }),
}));

import type { TaskReporter } from '../src/reporters/index.js';
import { AgentRuntime } from '../src/runtime.js';
import type { ClaimedTask, TaskSource } from '../src/sources/index.js';
import { makeFulfillBriefTask } from './test-fixtures.js';

class ArraySource implements TaskSource {
  readonly events: string[] = [];
  private i = 0;
  constructor(private readonly tasks: Task[]) {}
  async claim(): Promise<ClaimedTask | null> {
    this.events.push('claim');
    const task = this.tasks[this.i++] ?? null;
    return task ? { task, attemptN: 1, traceHeaders: {} } : null;
  }
  async close(): Promise<void> {
    this.events.push('close');
  }
}

class RecordingReporter implements TaskReporter {
  readonly events: string[] = [];
  private readonly cancelController = new AbortController();
  cancelReason: string | null = null;
  get cancelSignal(): AbortSignal {
    return this.cancelController.signal;
  }
  /** Test hook to simulate the API reporter aborting on cancellation. */
  triggerCancel(reason = 'test cancel'): void {
    this.requestCancel(reason);
  }
  requestCancel(reason: string): void {
    if (this.cancelController.signal.aborted) return;
    this.cancelReason = reason;
    this.cancelController.abort(new Error(reason));
  }
  async open(p: { taskId: string; attemptN: number }): Promise<void> {
    this.events.push(`open:${p.taskId}`);
  }
  async record(): Promise<void> {
    this.events.push('record');
  }
  async finalize(): Promise<void> {
    this.events.push('finalize');
  }
  async close(): Promise<void> {
    this.events.push('close');
  }
}

function makeOutput(task: Task, status: TaskOutput['status']): TaskOutput {
  return {
    taskId: task.id,
    attemptN: 1,
    status,
    output: null,
    outputCid: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 1,
  };
}

describe('AgentRuntime', () => {
  it('drains the source, invoking executor in claim order', async () => {
    const a = makeFulfillBriefTask({
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    });
    const b = makeFulfillBriefTask({
      id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    });
    const source = new ArraySource([a, b]);
    const claimed: string[] = [];
    const runtime = new AgentRuntime({
      source,
      makeReporter: () => new RecordingReporter(),
      executeTask: async ({ task }) => {
        claimed.push(task.id);
        return makeOutput(task, 'completed');
      },
    });
    const outputs = await runtime.start();
    expect(claimed).toEqual([a.id, b.id]);
    expect(outputs.every((o) => o.status === 'completed')).toBe(true);
    expect(source.events).toEqual(['claim', 'claim', 'claim', 'close']);
    expect(runtime.getStatus().state).toBe('stopped');
    expect(runtime.getStatus().tasksProcessed).toBe(2);
  });

  it('converts executor throws into failed TaskOutput', async () => {
    runtimeTelemetry.attributes.clear();
    const task = makeFulfillBriefTask();
    const runtime = new AgentRuntime({
      source: new ArraySource([task]),
      makeReporter: () => new RecordingReporter(),
      executeTask: async () => {
        throw new Error('boom');
      },
    });
    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    expect(outputs[0].status).toBe('failed');
    expect(outputs[0].error?.code).toBe('executor_threw');
    expect(outputs[0].error?.message).toBe('boom');
    expect(runtimeTelemetry.attributes).toEqual(
      new Map([
        ['moltnet.task.status', 'failed'],
        ['error.type', 'executor_threw'],
      ]),
    );
  });

  it('stop() halts the loop before claiming again', async () => {
    const tasks = [
      makeFulfillBriefTask({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }),
      makeFulfillBriefTask({ id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' }),
    ];
    const source = new ArraySource(tasks);
    const runtime = new AgentRuntime({
      source,
      makeReporter: () => new RecordingReporter(),
      executeTask: async ({ task }) => {
        runtime.stop();
        return makeOutput(task, 'completed');
      },
    });
    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    expect(source.events).toEqual(['claim', 'close']);
  });

  it('stop() requests cancellation on the active reporter', async () => {
    const task = makeFulfillBriefTask();
    const reporter = new RecordingReporter();
    const runtime = new AgentRuntime({
      source: new ArraySource([task]),
      makeReporter: () => reporter,
      executeTask: async ({ task }, activeReporter) => {
        runtime.stop('daemon signal');
        expect(activeReporter.cancelSignal.aborted).toBe(true);
        expect(activeReporter.cancelReason).toBe('daemon signal');
        return makeOutput(task, 'completed');
      },
    });

    await runtime.start();

    expect(reporter.cancelSignal.aborted).toBe(true);
    expect(reporter.cancelReason).toBe('daemon signal');
  });

  it('refuses to start twice', async () => {
    const runtime = new AgentRuntime({
      source: new ArraySource([]),
      makeReporter: () => new RecordingReporter(),
      executeTask: vi.fn(),
    });
    await runtime.start();
    await expect(runtime.start()).rejects.toThrow(/cannot start/);
  });

  describe('onTaskFinished hook', () => {
    it('fires per task inside the loop, in claim order', async () => {
      // Without this hook, long-polling sources never finalize tasks
      // because `start()` doesn't return — every lease expires even when
      // the executor produced a clean output. The hook MUST run inside
      // the loop, not after, so each task's `/complete` POST happens
      // before we claim the next one.
      const a = makeFulfillBriefTask({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      const b = makeFulfillBriefTask({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      });
      const events: string[] = [];
      const runtime = new AgentRuntime({
        source: new ArraySource([a, b]),
        makeReporter: () => new RecordingReporter(),
        executeTask: async ({ task }) => {
          events.push(`exec:${task.id}`);
          return makeOutput(task, 'completed');
        },
        onTaskFinished: async (output) => {
          events.push(`finalize:${output.taskId}`);
        },
      });
      await runtime.start();
      // Each task's finalize must run before the next exec — that's the
      // whole point. exec(a), finalize(a), exec(b), finalize(b).
      expect(events).toEqual([
        `exec:${a.id}`,
        `finalize:${a.id}`,
        `exec:${b.id}`,
        `finalize:${b.id}`,
      ]);
    });

    it('logs and continues when the hook throws', async () => {
      // One task's wire-finalize failure must not poison the next
      // claim. The runtime swallows the error after logging it.
      const a = makeFulfillBriefTask({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      });
      const b = makeFulfillBriefTask({
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      });
      const finalized: string[] = [];
      const runtime = new AgentRuntime({
        source: new ArraySource([a, b]),
        makeReporter: () => new RecordingReporter(),
        executeTask: async ({ task }) => makeOutput(task, 'completed'),
        onTaskFinished: async (output) => {
          finalized.push(output.taskId);
          if (output.taskId === a.id) {
            throw new Error('network fail');
          }
        },
      });
      const outputs = await runtime.start();
      expect(finalized).toEqual([a.id, b.id]);
      expect(outputs).toHaveLength(2);
      expect(runtime.getStatus().state).toBe('stopped');
    });

    it('is optional — runtime works without the hook', async () => {
      const task = makeFulfillBriefTask();
      const runtime = new AgentRuntime({
        source: new ArraySource([task]),
        makeReporter: () => new RecordingReporter(),
        executeTask: async () => makeOutput(task, 'completed'),
      });
      const outputs = await runtime.start();
      expect(outputs).toHaveLength(1);
      expect(outputs[0].status).toBe('completed');
    });
  });
});

it('does not finalize a durably interrupted attempt', async () => {
  const source = new ArraySource([makeFulfillBriefTask()]);
  const reporter = new RecordingReporter();
  const onTaskFinished = vi.fn();
  const runtime = new AgentRuntime({
    source,
    makeReporter: () => reporter,
    onTaskFinished,
    executeTask: async () => {
      throw new TaskExecutionInterrupted('writer lost');
    },
  });
  await expect(runtime.start()).rejects.toThrow('writer lost');
  expect(onTaskFinished).not.toHaveBeenCalled();
  expect(source.events).toContain('close');
  expect(reporter.events).toContain('close');
});

it('resumes an interrupted attempt with a fresh reporter before claiming more work', async () => {
  const task = makeFulfillBriefTask();
  const source = new ArraySource([task]);
  const reporters: RecordingReporter[] = [];
  const onTaskFinished = vi.fn();
  const executeTask = vi
    .fn()
    .mockRejectedValueOnce(new TaskExecutionInterrupted('writer lost'))
    .mockResolvedValue(makeOutput(task, 'completed'));
  const resumeInterruptedTask = vi.fn(async (claimed: ClaimedTask) => {
    expect(reporters[0].events).toContain('close');
    expect(onTaskFinished).not.toHaveBeenCalled();
    return claimed;
  });
  const runtime = new AgentRuntime({
    source,
    makeReporter: () => {
      const reporter = Object.assign(new RecordingReporter(), {
        reconcileAttempt: async () => {
          throw new Error('API temporarily unavailable');
        },
      });
      reporters.push(reporter);
      return reporter;
    },
    executeTask,
    resumeInterruptedTask,
    onTaskFinished,
  });

  expect(await runtime.start()).toEqual([makeOutput(task, 'completed')]);
  expect(executeTask).toHaveBeenCalledTimes(2);
  expect(executeTask.mock.calls[0][0]).toEqual(executeTask.mock.calls[1][0]);
  expect(reporters).toHaveLength(2);
  expect(source.events).toEqual(['claim', 'claim', 'close']);
  expect(onTaskFinished).toHaveBeenCalledTimes(1);
  expect(runtime.getStatus().tasksProcessed).toBe(1);
});

it('bounds repeated interruptions without finalizing uncertain work', async () => {
  const interruption = new TaskExecutionInterrupted('still unavailable');
  const resumeInterruptedTask = vi.fn(async (claimed: ClaimedTask) => claimed);
  const executeTask = vi.fn(async () => {
    throw interruption;
  });
  const onTaskFinished = vi.fn();
  const runtime = new AgentRuntime({
    source: new ArraySource([makeFulfillBriefTask()]),
    makeReporter: () => new RecordingReporter(),
    executeTask,
    resumeInterruptedTask,
    onTaskFinished,
  });
  await expect(runtime.start()).rejects.toBe(interruption);
  expect(resumeInterruptedTask).toHaveBeenCalledTimes(2);
  expect(executeTask).toHaveBeenCalledTimes(3);
  expect(onTaskFinished).not.toHaveBeenCalled();
});

it.each([
  'cancelled',
  'stopped',
  'stopped during recovery',
  'terminal',
  'denied',
  'lookup failed',
])('does not resume %s work', async (mode) => {
  const task = makeFulfillBriefTask();
  const interruption = new TaskExecutionInterrupted('writer lost');
  const reporter = Object.assign(new RecordingReporter(), {
    reconcileAttempt: vi.fn(async () =>
      mode === 'terminal' ? makeOutput(task, 'completed') : null,
    ),
  });
  const resumeInterruptedTask = vi.fn(async () => {
    if (mode === 'lookup failed') throw new Error('lookup unavailable');
    if (mode === 'stopped during recovery') {
      runtime.stop();
      return { task, attemptN: 1, traceHeaders: {} };
    }
    return null;
  });
  const executeTask = vi.fn(async () => {
    if (mode === 'cancelled') reporter.triggerCancel();
    if (mode === 'stopped') runtime.stop();
    throw interruption;
  });
  const onTaskFinished = vi.fn();
  const runtime = new AgentRuntime({
    source: new ArraySource([task]),
    makeReporter: () => reporter,
    executeTask,
    resumeInterruptedTask,
    onTaskFinished,
  });
  if (mode === 'terminal')
    expect(await runtime.start()).toEqual([makeOutput(task, 'completed')]);
  else await expect(runtime.start()).rejects.toBe(interruption);
  expect(executeTask).toHaveBeenCalledTimes(1);
  expect(onTaskFinished).not.toHaveBeenCalled();
  expect(resumeInterruptedTask).toHaveBeenCalledTimes(
    mode === 'denied' ||
      mode === 'lookup failed' ||
      mode === 'stopped during recovery'
      ? 1
      : 0,
  );
});

it('reports an authoritative timeout and continues without finalizing it again', async () => {
  const first = makeFulfillBriefTask({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  });
  const next = makeFulfillBriefTask({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  });
  const timeout = {
    ...makeOutput(first, 'failed'),
    error: {
      code: 'running_total_exceeded',
      message: 'running_total_exceeded',
      retryable: false,
    },
  };
  const reporter = Object.assign(new RecordingReporter(), {
    reconcileAttempt: vi.fn(async () => timeout),
  });
  // A late local cancellation must not overwrite the server's timeout.
  reporter.triggerCancel();
  const onTaskFinished = vi.fn();
  const runtime = new AgentRuntime({
    source: new ArraySource([first, next]),
    makeReporter: ({ task }) =>
      task.id === first.id ? reporter : new RecordingReporter(),
    onTaskFinished,
    executeTask: async ({ task }) => {
      if (task.id === first.id)
        throw new TaskExecutionInterrupted('writer lost');
      return makeOutput(task, 'completed');
    },
  });

  const outputs = await runtime.start();

  expect(outputs).toEqual([timeout, makeOutput(next, 'completed')]);
  expect(onTaskFinished).toHaveBeenCalledTimes(1);
  expect(onTaskFinished).toHaveBeenCalledWith(
    makeOutput(next, 'completed'),
    expect.objectContaining({ task: next }),
  );
  expect(runtime.getStatus().tasksProcessed).toBe(2);
});

it.each(['active', 'lookup failed'])(
  'keeps interruption semantics when reconciliation is %s',
  async (mode) => {
    const interruption = new TaskExecutionInterrupted('writer lost', {
      cause: new Error('transport failed'),
    });
    const onTaskFinished = vi.fn();
    const reporter = Object.assign(new RecordingReporter(), {
      reconcileAttempt: vi.fn(async () => {
        if (mode === 'lookup failed') throw new Error('API unavailable');
        return null;
      }),
    });
    const runtime = new AgentRuntime({
      source: new ArraySource([makeFulfillBriefTask()]),
      makeReporter: () => reporter,
      executeTask: async () => {
        throw interruption;
      },
      onTaskFinished,
    });

    await expect(runtime.start()).rejects.toBe(interruption);
    expect(onTaskFinished).not.toHaveBeenCalled();
  },
);
