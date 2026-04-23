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
    return task ? { task, attemptN: 1 } : null;
  }
  async close(): Promise<void> {
    this.events.push('close');
  }
}

class RecordingReporter implements TaskReporter {
  readonly events: string[] = [];
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

  it('refuses to start twice', async () => {
    const runtime = new AgentRuntime({
      source: new ArraySource([]),
      makeReporter: () => new RecordingReporter(),
      executeTask: vi.fn(),
    });
    await runtime.start();
    await expect(runtime.start()).rejects.toThrow(/cannot start/);
  });
});
