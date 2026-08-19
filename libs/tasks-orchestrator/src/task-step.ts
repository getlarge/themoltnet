import { taskCreateIdempotencyKey, type WorkflowContext } from './types.js';

export interface TaskCreateStepMetadata {
  /** Absurd's concrete checkpoint name, including any repeat suffix. */
  stepName: string;
  /** Present only when the context has a stable durable-execution identity. */
  idempotencyKey?: string;
}

/**
 * Create one external task behind a replay-safe checkpoint. The decomposed
 * form derives the request key from Absurd's concrete checkpoint name, so two
 * calls with the same logical name still remain distinct (`name`, `name#2`).
 * Older WorkflowContext implementations fall back to their ordinary `step`.
 */
export async function createTaskStep<T>(
  ctx: WorkflowContext,
  name: string,
  create: (metadata: TaskCreateStepMetadata) => Promise<T>,
): Promise<T> {
  if (!ctx.beginStep || !ctx.completeStep) {
    return ctx.step(name, () =>
      create({
        stepName: name,
        idempotencyKey: taskCreateIdempotencyKey(ctx, name),
      }),
    );
  }

  const handle = await ctx.beginStep<T>(name);
  if (handle.done) return handle.state;
  const value = await create({
    stepName: handle.checkpointName,
    idempotencyKey: taskCreateIdempotencyKey(ctx, handle.checkpointName),
  });
  return ctx.completeStep(handle, value);
}
