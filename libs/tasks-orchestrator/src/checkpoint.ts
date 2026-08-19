import type { JsonValue } from 'absurd-sdk';

import type { WorkflowContext, WorkflowStepHandle } from './types.js';

/** Start a decomposed checkpoint, with a non-durable compatibility fallback. */
export function beginWorkflowStep<T = JsonValue>(
  ctx: WorkflowContext,
  name: string,
): Promise<WorkflowStepHandle<T>> {
  return ctx.beginStep
    ? ctx.beginStep<T>(name)
    : Promise.resolve({ name, checkpointName: name, done: false as const });
}

/** Complete a decomposed checkpoint, with a non-durable compatibility fallback. */
export function completeWorkflowStep<T>(
  ctx: WorkflowContext,
  handle: WorkflowStepHandle<T>,
  value: T,
): Promise<T> {
  return ctx.completeStep
    ? ctx.completeStep(handle, value)
    : Promise.resolve(value);
}
