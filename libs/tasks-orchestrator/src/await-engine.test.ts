import { describe, expect, it } from 'vitest';

import { waitForAcceptedTask, waitForTaskOutcome } from './await-engine.js';
import { inlineContext } from './context.js';
import { FakeTasks } from './testing.js';
import type {
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WorkflowContext,
} from './types.js';

const baseBody: Parameters<TaskClient['createTask']>[0] = {
  taskType: 'freeform',
  diaryId: 'diary',
  teamId: 'team',
  input: {},
};

interface State {
  phase: string;
}

const parseState = (output: unknown): State => {
  const phase = (output as { phase?: unknown })?.phase;
  if (typeof phase !== 'string') throw new Error('missing phase');
  return { phase };
};

describe('waitForTaskOutcome (terminal, via FakeTasks)', () => {
  it('returns an accepted outcome with parsed state', async () => {
    const tasks = new FakeTasks([{ phase: 'done' }]);
    const task = await tasks.createTask(baseBody);
    const outcome = await waitForTaskOutcome(task.id, {
      tasks,
      ctx: inlineContext,
      pollIntervalSec: 0,
      parse: parseState,
    });
    expect(outcome.kind).toBe('accepted');
    if (outcome.kind === 'accepted') {
      expect(outcome.result.state).toEqual({ phase: 'done' });
    }
  });

  it('returns invalid_output when the parser throws', async () => {
    const tasks = new FakeTasks([{ notPhase: true }]);
    const task = await tasks.createTask(baseBody);
    const outcome = await waitForTaskOutcome(task.id, {
      tasks,
      ctx: inlineContext,
      pollIntervalSec: 0,
      parse: parseState,
    });
    expect(outcome.kind).toBe('invalid_output');
    if (outcome.kind === 'invalid_output') {
      expect(outcome.reason).toMatch(/missing phase/);
    }
  });

  it('returns failed for a terminally failed task', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'failed', error: 'boom' }]);
    const task = await tasks.createTask(baseBody);
    const outcome = await waitForTaskOutcome(task.id, {
      tasks,
      ctx: inlineContext,
      pollIntervalSec: 0,
      parse: parseState,
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.reason).toMatch(/status failed/);
    }
  });
});

// ── Nonterminal-to-terminal polling (the FakeTasks-based tests above only ever
//    see an already-terminal task) ──────────────────────────────────────────

function task(status: string, acceptedAttemptN: number | null): SdkTask {
  return { id: 't1', status, acceptedAttemptN } as unknown as SdkTask;
}
function attempt(status: string, output: unknown): SdkTaskAttempt {
  return {
    taskId: 't1',
    attemptN: 1,
    status,
    output,
    outputCid: 'cid',
  } as unknown as SdkTaskAttempt;
}

/** A TaskClient whose getTask walks a scripted status timeline. */
class ScriptedTasks implements TaskClient {
  getCalls = 0;
  constructor(
    private readonly timeline: Array<[string, number | null]>,
    private readonly accepted: SdkTaskAttempt,
    private readonly getError?: Error,
  ) {}
  createTask(): Promise<SdkTask> {
    return Promise.reject(new Error('not used'));
  }
  getTask(): Promise<SdkTask> {
    if (this.getError) return Promise.reject(this.getError);
    const i = Math.min(this.getCalls, this.timeline.length - 1);
    this.getCalls += 1;
    const [status, acceptedN] = this.timeline[i];
    return Promise.resolve(task(status, acceptedN));
  }
  listAttempts(): Promise<SdkTaskAttempt[]> {
    return Promise.resolve([this.accepted]);
  }
}

function recordingContext(overrides: Partial<WorkflowContext> = {}): {
  ctx: WorkflowContext;
  sleeps: string[];
  events: string[];
} {
  const sleeps: string[] = [];
  const events: string[] = [];
  const ctx: WorkflowContext = {
    executionId: 'await-engine-test',
    step: (_name, fn) => fn(),
    beginStep: (name) =>
      Promise.resolve({ name, checkpointName: name, done: false }),
    completeStep: (_handle, value) => Promise.resolve(value),
    sleepFor: (name) => {
      sleeps.push(name);
      return Promise.resolve();
    },
    ...overrides,
  };
  return { ctx, sleeps, events };
}

describe('waitForTaskOutcome (polling transitions)', () => {
  it('polls through nonterminal statuses until accepted, sleeping between polls', async () => {
    const tasks = new ScriptedTasks(
      [
        ['queued', null],
        ['running', null],
        ['completed', 1],
      ],
      attempt('completed', { phase: 'done' }),
    );
    const { ctx, sleeps } = recordingContext();
    const outcome = await waitForTaskOutcome('t1', {
      tasks,
      ctx,
      pollIntervalSec: 1,
      parse: parseState,
    });
    expect(outcome.kind).toBe('accepted');
    // Two nonterminal polls => two sleep boundaries before the terminal poll.
    expect(sleeps).toHaveLength(2);
    expect(tasks.getCalls).toBe(3);
  });

  it('uses awaitEvent when available instead of sleeping', async () => {
    const tasks = new ScriptedTasks(
      [
        ['queued', null],
        ['completed', 1],
      ],
      attempt('completed', { phase: 'done' }),
    );
    const events: string[] = [];
    const { ctx, sleeps } = recordingContext({
      awaitEvent: (eventName) => {
        events.push(eventName);
        return Promise.resolve(undefined);
      },
    });
    const outcome = await waitForTaskOutcome('t1', {
      tasks,
      ctx,
      pollIntervalSec: 1,
      parse: parseState,
    });
    expect(outcome.kind).toBe('accepted');
    expect(events).toEqual(['moltnet.task.updated:t1']);
    expect(sleeps).toHaveLength(0);
  });

  it('treats an awaitEvent timeout as a normal poll boundary', async () => {
    class TimeoutError extends Error {
      constructor() {
        super('timed out');
        this.name = 'TimeoutError';
      }
    }
    const tasks = new ScriptedTasks(
      [
        ['queued', null],
        ['completed', 1],
      ],
      attempt('completed', { phase: 'done' }),
    );
    const { ctx } = recordingContext({
      awaitEvent: () => Promise.reject(new TimeoutError()),
    });
    const outcome = await waitForTaskOutcome('t1', {
      tasks,
      ctx,
      pollIntervalSec: 1,
      parse: parseState,
    });
    expect(outcome.kind).toBe('accepted');
  });

  it('fails when the accepted attempt is not itself completed', async () => {
    const tasks = new ScriptedTasks(
      [['completed', 1]],
      attempt('failed', null),
    );
    const outcome = await waitForTaskOutcome('t1', {
      tasks,
      ctx: inlineContext,
      pollIntervalSec: 0,
      parse: parseState,
    });
    expect(outcome.kind).toBe('failed');
    if (outcome.kind === 'failed') {
      expect(outcome.reason).toMatch(/accepted attempt is not completed/);
    }
  });

  it('propagates an unexpected getTask rejection', async () => {
    const tasks = new ScriptedTasks(
      [['queued', null]],
      attempt('completed', { phase: 'done' }),
      new Error('network down'),
    );
    await expect(
      waitForTaskOutcome('t1', {
        tasks,
        ctx: inlineContext,
        pollIntervalSec: 0,
        parse: parseState,
      }),
    ).rejects.toThrow(/network down/);
  });
});

describe('waitForAcceptedTask', () => {
  it('returns the accepted result directly', async () => {
    const tasks = new FakeTasks([{ phase: 'planned' }]);
    const task = await tasks.createTask(baseBody);
    const result = await waitForAcceptedTask(task.id, {
      tasks,
      ctx: inlineContext,
      pollIntervalSec: 0,
      parse: parseState,
    });
    expect(result.state).toEqual({ phase: 'planned' });
  });

  it('throws on a non-accepted outcome', async () => {
    const tasks = new FakeTasks([{ __taskStatus: 'cancelled' }]);
    const task = await tasks.createTask(baseBody);
    await expect(
      waitForAcceptedTask(task.id, {
        tasks,
        ctx: inlineContext,
        pollIntervalSec: 0,
        parse: parseState,
      }),
    ).rejects.toThrow(/status cancelled/);
  });
});
