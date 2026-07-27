import type { WorkflowContext } from './types.js';

export interface ParallelTasksArgs<TItem, TCreated, TResult> {
  ctx: WorkflowContext;
  items: readonly TItem[];
  /**
   * Unique, stable durable-step name for creating the task for one item. Must be
   * distinct per item so replay checkpoints don't collide.
   */
  createStepName: (item: TItem, index: number) => string;
  /** Create (and durably checkpoint) the MoltNet task for one item. */
  create: (item: TItem, index: number) => Promise<TCreated>;
  /** Await the created task's result. */
  awaitResult: (
    created: TCreated,
    item: TItem,
    index: number,
  ) => Promise<TResult>;
  /**
   * Optional hook fired after all tasks are created but before any are awaited.
   * The point where every task id exists — use it to update status or to build a
   * `joinCondition` over the created ids for a downstream declared task.
   */
  onCreated?: (created: TCreated[]) => Promise<void> | void;
  /**
   * Optional bound on how many awaits run concurrently. Task *creation* is
   * always unbounded (tasks are durable and just queue); this only back-pressures
   * the await/poll fan-out. Default: unbounded.
   */
  concurrency?: number;
}

export interface ParallelTasksResult<TCreated, TResult> {
  /** Created tasks, in input order. Use for building a `joinCondition`. */
  created: TCreated[];
  /** Awaited results, in input order. */
  results: TResult[];
}

async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number | undefined,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (!limit || limit <= 0 || limit >= items.length) {
    return Promise.all(items.map((item, index) => fn(item, index)));
  }
  const results = new Array<R>(items.length);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

/**
 * Fan out one MoltNet task per item, then await them all — the generalized form
 * of the hand-rolled `Promise.all(items.map(ctx.step(...)))` fan-out. Creation
 * runs first (all task ids exist quickly, so a downstream `joinCondition` can
 * reference them), then results are awaited (optionally concurrency-bounded).
 * Both arrays are returned in input order.
 */
export async function parallelTasks<TItem, TCreated, TResult>(
  args: ParallelTasksArgs<TItem, TCreated, TResult>,
): Promise<ParallelTasksResult<TCreated, TResult>> {
  const {
    ctx,
    items,
    createStepName,
    create,
    awaitResult,
    onCreated,
    concurrency,
  } = args;
  const created = await Promise.all(
    items.map((item, index) =>
      ctx.step(createStepName(item, index), () => create(item, index)),
    ),
  );
  await onCreated?.(created);
  const results = await mapWithConcurrency(
    created,
    concurrency,
    (createdItem, index) => awaitResult(createdItem, items[index], index),
  );
  return { created, results };
}
