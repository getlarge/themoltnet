import type { Task, TaskOutput } from '@moltnet/tasks';
import { describe, expect, it, vi } from 'vitest';

import type { TaskReporter } from './reporters/index.js';
import { AgentRuntime } from './runtime.js';
import type { ClaimedTask, TaskSource } from './sources/index.js';
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
