import { describe, expect, it } from 'vitest';

import { inlineContext } from './context.js';
import { parallelTasks } from './parallel.js';
import type { WorkflowContext, WorkflowStepHandle } from './types.js';

/**
 * A durable-like context that memoizes each `step` by name (like Absurd): a
 * repeat call with the same name returns the cached result without re-running
 * the body, and concurrent calls with the same name share one in-flight run.
 */
function memoizingContext(): WorkflowContext {
  const cache = new Map<string, unknown>();
  const inflight = new Map<string, Promise<unknown>>();
  return {
    executionId: 'parallel-test-execution',
    async step<T>(name: string, fn: () => Promise<T>): Promise<T> {
      if (cache.has(name)) return cache.get(name) as T;
      const existing = inflight.get(name);
      if (existing) return existing as Promise<T>;
      const run = fn();
      inflight.set(name, run);
      const value = await run;
      cache.set(name, value);
      return value;
    },
    beginStep<T>(name: string): Promise<WorkflowStepHandle<T>> {
      if (cache.has(name)) {
        const state = cache.get(name) as T;
        return Promise.resolve({
          name,
          checkpointName: name,
          done: true as const,
          state,
        });
      }
      return Promise.resolve({
        name,
        checkpointName: name,
        done: false as const,
      });
    },
    completeStep<T>(handle: { checkpointName: string }, value: T) {
      cache.set(handle.checkpointName, value);
      return Promise.resolve(value);
    },
    sleepFor: () => Promise.resolve(),
  };
}

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

    await expect(
      parallelTasks({
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
      }),
    ).rejects.toMatchObject({ name: 'AggregateError' });

    expect(completed).toEqual([1, 2]);
  });

  it('passes a stable execution-scoped idempotency key to create', async () => {
    const seen: string[] = [];
    await parallelTasks({
      ctx: { ...inlineContext, executionId: 'run-123' },
      items: ['child'],
      createStepName: () => 'task.child.create',
      create: (_item, _index, metadata) => {
        seen.push(metadata.idempotencyKey);
        return Promise.resolve('created');
      },
      awaitResult: (item) => Promise.resolve(item),
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatch(/^absurd:[A-Za-z0-9_-]{43}$/);
  });
});

describe('parallelTasks durability (memoized/replayed ctx)', () => {
  it('does not re-create tasks on durable replay', async () => {
    const ctx = memoizingContext();
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
    // Replaying with the SAME ctx must reuse the cached create checkpoints.
    const second = await parallelTasks(args);
    expect(creates).toBe(2); // created once each; not re-created on replay
    expect(first.created).toEqual(second.created);
    expect(first.results).toEqual(['id-a', 'id-b']);
  });

  it('collides when createStepName is not unique (uniqueness is required)', async () => {
    const ctx = memoizingContext();
    let creates = 0;
    const { created } = await parallelTasks({
      ctx,
      items: ['a', 'b', 'c'],
      // BAD: a constant step name for every item.
      createStepName: () => 'create',
      create: (item: string) => {
        creates += 1;
        return Promise.resolve({ id: `id-${item}` });
      },
      awaitResult: (created: { id: string }) => Promise.resolve(created.id),
    });
    // The shared checkpoint name makes every item resolve to the first create —
    // exactly why createStepName must be unique per item.
    expect(creates).toBe(1);
    expect(created).toEqual([{ id: 'id-a' }, { id: 'id-a' }, { id: 'id-a' }]);
  });
});
