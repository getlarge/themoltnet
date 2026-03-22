import { buildCacheKey } from './pipeline-shared.js';

export interface CachedEvalResult<TTrace = unknown> {
  score: number;
  trace?: TTrace;
}

/**
 * Content-hash cache shared between metricFn and adapter.evaluate().
 *
 * Both paths in ax-llm's GEPA compile loop evaluate the same
 * (taskId, instruction) pairs. This cache ensures the expensive
 * agent run happens at most once per unique input.
 */
export class EvalCache<TTrace = unknown> {
  private cache = new Map<string, CachedEvalResult<TTrace>>();

  get(
    taskId: string,
    instruction: string,
  ): CachedEvalResult<TTrace> | undefined {
    return this.cache.get(buildCacheKey(taskId, instruction));
  }

  set(
    taskId: string,
    instruction: string,
    result: CachedEvalResult<TTrace>,
  ): void {
    this.cache.set(buildCacheKey(taskId, instruction), result);
  }

  get size(): number {
    return this.cache.size;
  }
}
