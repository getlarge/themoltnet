import { describe, expect, it } from 'vitest';

import { EvalCache } from './eval-cache.js';

describe('EvalCache', () => {
  it('returns undefined on cache miss', () => {
    const cache = new EvalCache();
    expect(cache.get('task-1', 'instruction-a')).toBeUndefined();
  });

  it('returns cached result on hit', () => {
    const cache = new EvalCache();
    const result = { score: 0.8, trace: { taskId: 'task-1' } };
    cache.set('task-1', 'instruction-a', result);
    expect(cache.get('task-1', 'instruction-a')).toBe(result);
  });

  it('does not collide across different instructions', () => {
    const cache = new EvalCache();
    cache.set('task-1', 'instruction-a', { score: 0.5 });
    cache.set('task-1', 'instruction-b', { score: 0.9 });
    expect(cache.get('task-1', 'instruction-a')?.score).toBe(0.5);
    expect(cache.get('task-1', 'instruction-b')?.score).toBe(0.9);
  });

  it('does not collide across different task IDs', () => {
    const cache = new EvalCache();
    cache.set('task-a', 'same', { score: 0.3 });
    cache.set('task-b', 'same', { score: 0.7 });
    expect(cache.get('task-a', 'same')?.score).toBe(0.3);
    expect(cache.get('task-b', 'same')?.score).toBe(0.7);
  });

  it('preserves trace data in cached results', () => {
    const cache = new EvalCache<{ detail: string }>();
    const trace = { detail: 'some trace data' };
    cache.set('task-1', 'instruction', { score: 0.6, trace });
    const cached = cache.get('task-1', 'instruction');
    expect(cached?.trace).toBe(trace);
  });

  it('reports size correctly', () => {
    const cache = new EvalCache();
    expect(cache.size).toBe(0);
    cache.set('task-1', 'a', { score: 0.5 });
    expect(cache.size).toBe(1);
    cache.set('task-2', 'b', { score: 0.7 });
    expect(cache.size).toBe(2);
  });
});
