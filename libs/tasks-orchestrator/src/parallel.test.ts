import { SuspendTask } from 'absurd-sdk';
import { describe, expect, it } from 'vitest';

import { inlineContext } from './context.js';
import { parallelTasks } from './parallel.js';
import { replayContext } from './testing.js';
import { taskCreateIdempotencyKey } from './types.js';

const tick = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 5);
  });

describe('parallelTasks', () => {
  it('returns created tasks and results in input order', async () => {
    const items = ['a', 'b', 'c'];
    const stepNames: string[] = [];
    const { created, results } = await parallelTasks({
      ctx: inlineContext,
      items,
      createStepName: (item, index) => {
        const name = `create.${item}.${index}`;
        stepNames.push(name);
        return name;
      },
      create: (item, index) => Promise.resolve({ id: `id-${item}`, index }),
      awaitResult: (createdItem) => Promise.resolve(`result-${createdItem.id}`),
    });

    expect(created).toEqual([
      { id: 'id-a', index: 0 },
      { id: 'id-b', index: 1 },
      { id: 'id-c', index: 2 },
    ]);
    expect(results).toEqual(['result-id-a', 'result-id-b', 'result-id-c']);
    expect(new Set(stepNames).size).toBe(items.length);
  });

  it('bounds await concurrency when a limit is given', async () => {
    let active = 0;
    let maxActive = 0;
    const { results } = await parallelTasks({
      ctx: inlineContext,
      items: [0, 1, 2, 3, 4],
      createStepName: (_item, index) => `create.${index}`,
      create: (item) => Promise.resolve(item),
      awaitResult: async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        active -= 1;
        return item * 2;
      },
      concurrency: 2,
    });

    expect(maxActive).toBeLessThanOrEqual(2);
    expect(results).toEqual([0, 2, 4, 6, 8]);
  });

  it('fires onCreated with all created tasks before any await runs', async () => {
    const order: string[] = [];
    const { created } = await parallelTasks({
      ctx: inlineContext,
      items: ['a', 'b'],
      createStepName: (item) => `create.${item}`,
      create: (item) => {
        order.push(`create-${item}`);
        return Promise.resolve({ id: item });
      },
      onCreated: (all) => {
        order.push(`onCreated-${all.map((c) => c.id).join(',')}`);
      },
      awaitResult: (createdItem) => {
        order.push(`await-${createdItem.id}`);
        return Promise.resolve(createdItem.id);
      },
    });

    expect(created).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(order).toEqual([
      'create-a',
      'create-b',
      'onCreated-a,b',
      'await-a',
      'await-b',
    ]);
  });

  it('runs awaits unbounded by default', async () => {
    let active = 0;
    let maxActive = 0;
    await parallelTasks({
      ctx: inlineContext,
      items: [0, 1, 2, 3, 4],
      createStepName: (_item, index) => `create.${index}`,
      create: (item) => Promise.resolve(item),
      awaitResult: async (item) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await tick();
        active -= 1;
        return item;
      },
    });

    expect(maxActive).toBe(5);
  });

  it('awaits every create branch before surfacing an aggregate failure', async () => {
    const completed: number[] = [];
    let caught: unknown;
    try {
      await parallelTasks({
        ctx: inlineContext,
        items: [0, 1, 2],
        createStepName: (_item, index) => `create.${index}`,
        create: async (item) => {
          if (item === 0) throw new Error('first failed');
          await tick();
          completed.push(item);
          if (item === 2) throw new Error('third failed');
          return item;
        },
        awaitResult: (item) => Promise.resolve(item),
      });
    } catch (error) {
      caught = error;
    }

    expect(completed).toEqual([1, 2]);
    expect(caught).toBeInstanceOf(AggregateError);
    const aggregate = caught as AggregateError & { stepNames?: string[] };
    expect(aggregate.errors.map((error) => (error as Error).message)).toEqual([
      'first failed',
      'third failed',
    ]);
    expect(aggregate.stepNames).toEqual(['create.0', 'create.2']);
    expect((aggregate.cause as Error).message).toBe('first failed');
    expect(aggregate.message).toContain('create.0, create.2');
  });

  it('returns empty ordered arrays for an empty fan-out', async () => {
    const result = await parallelTasks({
      ctx: inlineContext,
      items: [] as string[],
      createStepName: (item) => item,
      create: (item) => Promise.resolve(item),
      awaitResult: (item) => Promise.resolve(item),
    });

    expect(result).toEqual({ created: [], results: [] });
  });

  it('propagates Absurd suspension instead of aggregating it', async () => {
    const suspension = new SuspendTask();
    await expect(
      parallelTasks({
        ctx: inlineContext,
        items: ['suspend', 'complete'],
        createStepName: (item) => `create.${item}`,
        create: (item) =>
          item === 'suspend'
            ? Promise.reject(suspension)
            : Promise.resolve(item),
        awaitResult: (item) => Promise.resolve(item),
      }),
    ).rejects.toBe(suspension);
  });

  it('passes a stable execution-scoped idempotency key to create', async () => {
    const seen: string[] = [];
    await parallelTasks({
      ctx: { ...inlineContext, executionId: 'run-123' },
      items: ['child'],
      createStepName: () => 'task.child.create',
      create: (_item, _index, metadata) => {
        seen.push(metadata.idempotencyKey as string);
        return Promise.resolve('created');
      },
      awaitResult: (item) => Promise.resolve(item),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^absurd:[A-Za-z0-9_-]{43}$/);
  });

  it('derives deterministic keys scoped by execution identity', () => {
    const first = taskCreateIdempotencyKey(
      { executionId: 'execution-a' },
      'task.create',
    );
    expect(
      taskCreateIdempotencyKey({ executionId: 'execution-a' }, 'task.create'),
    ).toBe(first);
    expect(
      taskCreateIdempotencyKey({ executionId: 'execution-b' }, 'task.create'),
    ).not.toBe(first);
    expect(taskCreateIdempotencyKey({}, 'task.create')).toBeUndefined();
  });
});

describe('parallelTasks durability (memoized/replayed ctx)', () => {
  it('does not re-create tasks on durable replay', async () => {
    const ctx = replayContext('parallel-test-execution');
    let creates = 0;
    const args = {
      ctx,
      items: ['a', 'b'],
      createStepName: (item: string) => `create.${item}`,
      create: (item: string) => {
        creates += 1;
        return Promise.resolve({ id: `id-${item}` });
      },
      awaitResult: (created: { id: string }) => Promise.resolve(created.id),
    };
    const first = await parallelTasks(args);
    ctx.resetForReplay();
    const second = await parallelTasks(args);
    expect(creates).toBe(2); // created once each; not re-created on replay
    expect(first.created).toEqual(second.created);
    expect(first.results).toEqual(['id-a', 'id-b']);
  });

  it('uses concrete numbered checkpoints when logical names repeat', async () => {
    const ctx = replayContext('parallel-test-execution');
    let creates = 0;
    const metadata: Array<{ stepName: string; idempotencyKey?: string }> = [];
    const { created } = await parallelTasks({
      ctx,
      items: ['a', 'b', 'c'],
      createStepName: () => 'create',
      create: (item: string, _index, stepMetadata) => {
        creates += 1;
        metadata.push(stepMetadata);
        return Promise.resolve({ id: `id-${item}` });
      },
      awaitResult: (created: { id: string }) => Promise.resolve(created.id),
    });
    expect(creates).toBe(3);
    expect(created).toEqual([{ id: 'id-a' }, { id: 'id-b' }, { id: 'id-c' }]);
    expect(metadata.map((item) => item.stepName)).toEqual([
      'create',
      'create#2',
      'create#3',
    ]);
    expect(new Set(metadata.map((item) => item.idempotencyKey)).size).toBe(3);
  });
});
