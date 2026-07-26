import { describe, expect, it } from 'vitest';

import { waitForAcceptedTask, waitForTaskOutcome } from './await-engine.js';
import { inlineContext } from './context.js';
import { FakeTasks } from './testing.js';
import type { TaskClient } from './types.js';

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

describe('waitForTaskOutcome', () => {
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
