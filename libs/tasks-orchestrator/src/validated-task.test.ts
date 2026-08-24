import { describe, expect, it, vi } from 'vitest';

import { inlineContext } from './context.js';
import { FakeTasks, replayContext } from './testing.js';
import type {
  CreateRepairTaskArgs,
  SdkTask,
  SdkTaskAttempt,
  TaskClient,
  WaitForValidatedTaskOptions,
} from './types.js';
import { waitForValidatedTask } from './validated-task.js';

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

function options(
  tasks: TaskClient,
  overrides: Partial<WaitForValidatedTaskOptions<State>> = {},
): WaitForValidatedTaskOptions<State> {
  return {
    tasks,
    ctx: inlineContext,
    pollIntervalSec: 0,
    parse: parseState,
    maxRepairs: 1,
    createRepairTask: () => Promise.reject(new Error('unexpected repair')),
    ...overrides,
  };
}

function attachUsage(
  tasks: FakeTasks,
  usage: Array<SdkTaskAttempt['usage']>,
): void {
  const listAttempts = tasks.listAttempts.bind(tasks);
  tasks.listAttempts = async (id) => {
    const attempts = await listAttempts(id);
    const index = Number(id.slice(-12)) - 1;
    return attempts.map(
      (attempt) => ({ ...attempt, usage: usage[index] }) as SdkTaskAttempt,
    );
  };
}

describe('waitForValidatedTask', () => {
  it('returns direct success as repair zero', async () => {
    const tasks = new FakeTasks([{ phase: 'done' }]);
    const initial = await tasks.createTask(baseBody);

    const result = await waitForValidatedTask(initial, options(tasks));

    expect(result.kind).toBe('accepted');
    expect(result.chain.map((element) => element.repairN)).toEqual([0]);
    expect(result.cumulativeUsage).toEqual({
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      toolCalls: 0,
    });
  });

  it('creates one successful repair with exact parser feedback and key', async () => {
    const tasks = new FakeTasks([{ invalid: true }, { phase: 'repaired' }]);
    const initial = await tasks.createTask(baseBody);
    let received: CreateRepairTaskArgs | undefined;
    const createRepairTask = vi.fn(async (args: CreateRepairTaskArgs) => {
      received = args;
      return tasks.createTask(baseBody, {
        idempotencyKey: args.idempotencyKey,
      });
    });

    const result = await waitForValidatedTask(
      initial,
      options(tasks, {
        ctx: replayContext('validated-execution'),
        createRepairTask,
      }),
    );

    expect(result.kind).toBe('accepted');
    expect(result.chain.map((element) => element.repairN)).toEqual([0, 1]);
    expect(createRepairTask).toHaveBeenCalledTimes(1);
    expect(received?.task.id).toBe(initial.id);
    expect(received?.attempt.attemptN).toBe(1);
    expect(received?.reason).toBe('missing phase');
    expect(received?.repairN).toBe(1);
    expect(received?.idempotencyKey).toMatch(/^absurd:/);
    expect(tasks.creationOptions[1]).toEqual({
      idempotencyKey: received?.idempotencyKey,
    });
  });

  it('exhausts immediately when the explicit repair budget is zero', async () => {
    const tasks = new FakeTasks([{ invalid: true }]);
    const initial = await tasks.createTask(baseBody);
    const createRepairTask = vi.fn();

    const result = await waitForValidatedTask(
      initial,
      options(tasks, { maxRepairs: 0, createRepairTask }),
    );

    expect(result).toMatchObject({
      kind: 'exhausted',
      reason: 'missing phase',
    });
    expect(result.chain.map((element) => element.repairN)).toEqual([0]);
    expect(createRepairTask).not.toHaveBeenCalled();
  });

  it('orders repeated invalid repairs and sums all usage dimensions', async () => {
    const tasks = new FakeTasks([
      { invalid: 0 },
      { invalid: 1 },
      { invalid: 2 },
    ]);
    attachUsage(tasks, [
      {
        model: 'model-a',
        provider: 'provider-a',
        inputTokens: 10,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheWriteTokens: 4,
        toolCalls: 1,
      },
      {
        model: 'model-b',
        inputTokens: 20,
        outputTokens: 5,
        cacheReadTokens: 7,
      },
      null,
    ]);
    const initial = await tasks.createTask(baseBody);

    const result = await waitForValidatedTask(
      initial,
      options(tasks, {
        maxRepairs: 2,
        createRepairTask: () => tasks.createTask(baseBody),
      }),
    );

    expect(result.kind).toBe('exhausted');
    expect(result.chain.map((element) => element.repairN)).toEqual([0, 1, 2]);
    expect(result.cumulativeUsage).toEqual({
      inputTokens: 30,
      outputTokens: 7,
      cacheReadTokens: 10,
      cacheWriteTokens: 4,
      toolCalls: 1,
    });
    expect(
      result.chain[0]?.outcome.kind === 'invalid_output'
        ? result.chain[0].outcome.attempt.usage
        : undefined,
    ).toMatchObject({ model: 'model-a', provider: 'provider-a' });
    expect(
      result.chain[2]?.outcome.kind === 'invalid_output'
        ? result.chain[2].outcome.attempt.usage
        : undefined,
    ).toBeNull();
  });

  it.each(['failed', 'cancelled'] as const)(
    'returns an original %s task without repair',
    async (status) => {
      const tasks = new FakeTasks([{ __taskStatus: status }]);
      const initial = await tasks.createTask(baseBody);
      const createRepairTask = vi.fn();

      const result = await waitForValidatedTask(
        initial,
        options(tasks, { createRepairTask }),
      );

      expect(result.kind).toBe('failed');
      expect(result.chain.map((element) => element.repairN)).toEqual([0]);
      expect(createRepairTask).not.toHaveBeenCalled();
    },
  );

  it.each(['failed', 'cancelled'] as const)(
    'returns a repaired %s task without another repair',
    async (status) => {
      const tasks = new FakeTasks([
        { invalid: true },
        { __taskStatus: status },
      ]);
      const initial = await tasks.createTask(baseBody);

      const result = await waitForValidatedTask(
        initial,
        options(tasks, {
          maxRepairs: 2,
          createRepairTask: () => tasks.createTask(baseBody),
        }),
      );

      expect(result.kind).toBe('failed');
      expect(result.chain.map((element) => element.repairN)).toEqual([0, 1]);
    },
  );

  it('propagates repair callback failures', async () => {
    const tasks = new FakeTasks([{ invalid: true }]);
    const initial = await tasks.createTask(baseBody);

    await expect(
      waitForValidatedTask(
        initial,
        options(tasks, {
          createRepairTask: () => Promise.reject(new Error('create failed')),
        }),
      ),
    ).rejects.toThrow('create failed');
  });

  it.each([-1, 1.5, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid maxRepairs %s before awaiting',
    async (maxRepairs) => {
      const tasks = new FakeTasks([{ phase: 'unused' }]);
      const initial = await tasks.createTask(baseBody);
      const getTask = vi.spyOn(tasks, 'getTask');

      await expect(
        waitForValidatedTask(initial, options(tasks, { maxRepairs })),
      ).rejects.toThrow('maxRepairs must be a non-negative safe integer');
      expect(getTask).not.toHaveBeenCalled();
    },
  );

  it('reuses a persisted repair-creation checkpoint on replay', async () => {
    const tasks = new FakeTasks([{ invalid: true }, { phase: 'repaired' }]);
    const initial = await tasks.createTask(baseBody);
    const ctx = replayContext('persisted-repair');
    const createRepairTask = vi.fn(() => tasks.createTask(baseBody));
    const opts = options(tasks, { ctx, createRepairTask });

    const first = await waitForValidatedTask(initial, opts);
    ctx.resetForReplay();
    const replayed = await waitForValidatedTask(initial, opts);

    expect(first.kind).toBe('accepted');
    expect(replayed.kind).toBe('accepted');
    expect(createRepairTask).toHaveBeenCalledTimes(1);
    expect(tasks.created).toHaveLength(2);
    expect(ctx.checkpointNames).toEqual([
      `validated-task:${initial.id}:repair:1.create`,
    ]);
  });

  it('retries the crash gap with the same key and no duplicate task', async () => {
    const tasks = new FakeTasks([{ invalid: true }, { phase: 'repaired' }]);
    const initial = await tasks.createTask(baseBody);
    const ctx = replayContext('crash-gap-repair');
    const completeStep = ctx.completeStep.bind(ctx);
    let crash = true;
    ctx.completeStep = async (handle, value) => {
      if (handle.name.includes('repair:1.create') && crash) {
        crash = false;
        throw new Error('worker crashed before checkpoint completion');
      }
      return completeStep(handle, value);
    };
    const tasksByKey = new Map<string, SdkTask>();
    const keys: Array<string | undefined> = [];
    const createRepairTask = vi.fn(
      async ({ idempotencyKey }: CreateRepairTaskArgs) => {
        keys.push(idempotencyKey);
        const existing = idempotencyKey
          ? tasksByKey.get(idempotencyKey)
          : undefined;
        if (existing) return existing;
        const created = await tasks.createTask(baseBody, { idempotencyKey });
        if (idempotencyKey) tasksByKey.set(idempotencyKey, created);
        return created;
      },
    );
    const opts = options(tasks, { ctx, createRepairTask });

    await expect(waitForValidatedTask(initial, opts)).rejects.toThrow(
      'worker crashed before checkpoint completion',
    );
    ctx.resetForReplay();
    const result = await waitForValidatedTask(initial, opts);

    expect(result.kind).toBe('accepted');
    expect(createRepairTask).toHaveBeenCalledTimes(2);
    expect(keys[0]).toBeDefined();
    expect(keys[1]).toBe(keys[0]);
    expect(tasks.created).toHaveLength(2);
  });
});
