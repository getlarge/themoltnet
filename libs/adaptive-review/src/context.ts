import {
  beginWorkflowStep,
  completeWorkflowStep,
  type WorkflowContext,
} from '@themoltnet/tasks-orchestrator';

/** Namespace every branch; polling deliberately uses fresh reads and durable sleeps. */
export function reviewContext(
  ctx: WorkflowContext,
  prefix: string,
): WorkflowContext {
  const beginStep = ctx.beginStep?.bind(ctx);
  return {
    executionId: ctx.executionId,
    suspendsOnSleep: ctx.suspendsOnSleep,
    step: (name, fn) => ctx.step(`${prefix}.${name}`, fn),
    beginStep: beginStep ? (name) => beginStep(`${prefix}.${name}`) : undefined,
    completeStep: ctx.completeStep?.bind(ctx),
    sleepFor: (name, seconds) => ctx.sleepFor(`${prefix}.${name}`, seconds),
  };
}

/** A result spanning child checkpoints and durable waits cannot be a nested step. */
export async function reviewCheckpoint<T>(
  ctx: WorkflowContext,
  name: string,
  run: () => Promise<T>,
): Promise<T> {
  const handle = await beginWorkflowStep<T>(ctx, name);
  if (handle.done) return handle.state;
  return completeWorkflowStep(ctx, handle, await run());
}
