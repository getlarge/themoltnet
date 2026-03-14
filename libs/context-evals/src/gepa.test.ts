import { describe, expect, it, vi } from 'vitest';

import { buildMetricFn, buildReplicas } from './gepa.js';

describe('buildReplicas', () => {
  it('returns tasks unchanged when there are 2 or more', () => {
    const tasks = [
      { id: 'task-a', name: 'A' },
      { id: 'task-b', name: 'B' },
    ];
    const result = buildReplicas(tasks);
    expect(result).toEqual(tasks);
    expect(result).toHaveLength(2);
  });

  it('returns tasks unchanged when there are 3 or more', () => {
    const tasks = [{ id: 'task-a' }, { id: 'task-b' }, { id: 'task-c' }];
    const result = buildReplicas(tasks);
    expect(result).toHaveLength(3);
    expect(result).toEqual(tasks);
  });

  it('duplicates a single task with -replica suffix', () => {
    const tasks = [{ id: 'task-a', value: 42 }];
    const result = buildReplicas(tasks);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ id: 'task-a', value: 42 });
    expect(result[1]).toEqual({ id: 'task-a-replica', value: 42 });
  });

  it('does not mutate the original task when replicating', () => {
    const original = { id: 'task-a' };
    const tasks = [original];
    const result = buildReplicas(tasks);
    expect(result[0]).toBe(original);
    expect(original.id).toBe('task-a');
  });
});

describe('buildMetricFn', () => {
  it('calls the evaluator and returns its result', async () => {
    const evaluator = vi.fn().mockResolvedValue({ score: 0.8 });
    const metric = buildMetricFn(evaluator);
    const result = await metric('task-1', 'some instruction');
    expect(result).toEqual({ score: 0.8 });
    expect(evaluator).toHaveBeenCalledOnce();
    expect(evaluator).toHaveBeenCalledWith('task-1', 'some instruction');
  });

  it('caches the result for the same task + instruction', async () => {
    const evaluator = vi.fn().mockResolvedValue({ score: 0.5 });
    const metric = buildMetricFn(evaluator);
    const first = await metric('task-1', 'instruction-a');
    const second = await metric('task-1', 'instruction-a');
    expect(first).toEqual({ score: 0.5 });
    expect(second).toEqual({ score: 0.5 });
    expect(evaluator).toHaveBeenCalledOnce();
  });

  it('does not cache across different instructions', async () => {
    const evaluator = vi
      .fn()
      .mockResolvedValueOnce({ score: 0.3 })
      .mockResolvedValueOnce({ score: 0.7 });
    const metric = buildMetricFn(evaluator);
    const resultA = await metric('task-1', 'instruction-a');
    const resultB = await metric('task-1', 'instruction-b');
    expect(resultA.score).toBe(0.3);
    expect(resultB.score).toBe(0.7);
    expect(evaluator).toHaveBeenCalledTimes(2);
  });

  it('does not cache across different task IDs for the same instruction', async () => {
    const evaluator = vi
      .fn()
      .mockResolvedValueOnce({ score: 0.4 })
      .mockResolvedValueOnce({ score: 0.9 });
    const metric = buildMetricFn(evaluator);
    const resultA = await metric('task-a', 'same instruction');
    const resultB = await metric('task-b', 'same instruction');
    expect(resultA.score).toBe(0.4);
    expect(resultB.score).toBe(0.9);
    expect(evaluator).toHaveBeenCalledTimes(2);
  });

  it('preserves traces in cached results', async () => {
    const trace = { detail: 'some trace data' };
    const evaluator = vi.fn().mockResolvedValue({ score: 0.6, trace });
    const metric = buildMetricFn(evaluator);
    const first = await metric('task-1', 'instruction');
    const second = await metric('task-1', 'instruction');
    expect(first.trace).toBe(trace);
    expect(second.trace).toBe(trace);
    expect(evaluator).toHaveBeenCalledOnce();
  });
});
