import { describe, expect, it } from 'vitest';

import { inlineContext } from './context.js';
import { parallelTasks } from './parallel.js';

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
});
