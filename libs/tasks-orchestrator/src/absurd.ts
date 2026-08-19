import { Absurd, type JsonValue, type TaskContext } from 'absurd-sdk';

import type { Logger, WorkflowContext } from './types.js';

/**
 * Adapt an Absurd {@link TaskContext} onto the transport-neutral
 * {@link WorkflowContext}. This is the durable half of the seam: the same
 * workflow body that runs on `inlineContext` in tests runs on real Absurd
 * checkpoints in production.
 */
export function asWorkflowContext(ctx: TaskContext): WorkflowContext {
  return {
    executionId: ctx.taskID,
    step(name, fn) {
      return ctx.step(name, fn);
    },
    beginStep(name) {
      return ctx.beginStep(name);
    },
    completeStep(handle, value) {
      return ctx.completeStep(handle, value);
    },
    sleepFor(name, seconds) {
      return ctx.sleepFor(name, seconds);
    },
    awaitEvent(eventName, options) {
      return ctx.awaitEvent(eventName, options);
    },
    emitEvent(eventName, payload) {
      return ctx.emitEvent(eventName, payload as JsonValue | undefined);
    },
  };
}

export interface OrchestrationAbsurdAppArgs<TInput> {
  databaseUrl: string;
  queueName: string;
  /** Absurd task name the workflow registers under. */
  taskName: string;
  /** Absurd retry budget for the orchestration task itself. Default 3. */
  defaultMaxAttempts?: number;
  /** Optional application logger for execution start/resume diagnostics. */
  logger?: Logger;
  /**
   * The workflow body, written against the transport-neutral WorkflowContext.
   * Wrap domain dependencies in a closure at the call site.
   */
  run: (input: TInput, ctx: WorkflowContext) => Promise<unknown>;
}

/**
 * Build an Absurd app that runs a single durable orchestration workflow. The
 * workflow body stays backend-agnostic; this factory owns the Absurd wiring
 * (queue, task registration, context adaptation).
 */
export function createOrchestrationAbsurdApp<TInput>(
  args: OrchestrationAbsurdAppArgs<TInput>,
): Absurd {
  const app = new Absurd({ db: args.databaseUrl, queueName: args.queueName });

  app.registerTask<TInput, JsonValue>(
    { name: args.taskName, defaultMaxAttempts: args.defaultMaxAttempts ?? 3 },
    async (params, ctx) => {
      const executionStart = await ctx.beginStep<true>(
        'orchestration.execution.started',
      );
      const resumed = executionStart.done;
      if (!executionStart.done) {
        await ctx.completeStep(executionStart, true);
      }
      args.logger?.info(
        { executionId: ctx.taskID, resumed },
        resumed
          ? 'orchestration.execution.resumed'
          : 'orchestration.execution.started',
      );
      return (await args.run(params, asWorkflowContext(ctx))) as JsonValue;
    },
  );

  return app;
}
