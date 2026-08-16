import type { WorkflowContext } from './types.js';

/**
 * A non-durable {@link WorkflowContext}: steps run their body immediately and
 * sleeps are no-ops. Use it for synchronous unit tests and single-shot inline
 * runs where durability/replay is not needed. `awaitEvent`/`emitEvent` are left
 * undefined so callers fall back to `sleepFor`.
 */
export const inlineContext: WorkflowContext = {
  executionId: 'inline',
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
