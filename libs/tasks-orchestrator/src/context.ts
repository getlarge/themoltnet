import { randomUUID } from 'node:crypto';

import type { WorkflowContext } from './types.js';

/**
 * A non-durable {@link WorkflowContext}: steps run their body immediately and
 * sleeps are no-ops. Use it for synchronous unit tests and single-shot inline
 * runs where durability/replay is not needed. `awaitEvent`/`emitEvent` are left
 * undefined so callers fall back to `sleepFor`.
 */
export const inlineContext: WorkflowContext = {
  step(_name, fn) {
    return fn();
  },
  beginStep(name) {
    return Promise.resolve({
      name,
      checkpointName: name,
      done: false as const,
    });
  },
  completeStep(_handle, value) {
    return Promise.resolve(value);
  },
  sleepFor() {
    return Promise.resolve();
  },
};

/** Create an isolated inline run with a unique task-idempotency namespace. */
export function createInlineContext(
  executionId: string = randomUUID(),
): WorkflowContext {
  const stepCounts = new Map<string, number>();
  return {
    ...inlineContext,
    executionId,
    beginStep(name) {
      const count = (stepCounts.get(name) ?? 0) + 1;
      stepCounts.set(name, count);
      return Promise.resolve({
        name,
        checkpointName: count === 1 ? name : `${name}#${count}`,
        done: false as const,
      });
    },
  };
}
