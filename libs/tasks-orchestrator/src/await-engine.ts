import type {
  AcceptedTaskResult,
  Logger,
  TaskClient,
  TaskOutcome,
  WorkflowContext,
} from './types.js';

const DEFAULT_LOG_PREFIX = 'orchestration';

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.constructor.name === 'TimeoutError')
  );
}

/**
 * Wait for a durable event, falling back to `sleepFor` when the context has no
 * event support (e.g. `inlineContext`) or the event times out. A timeout is a
 * normal poll boundary, not an error.
 */
export async function waitForSignalOrSleep(args: {
  ctx: WorkflowContext;
  eventName: string;
  stepName: string;
  seconds: number;
  logger?: Logger;
  description?: string;
  logPrefix?: string;
}): Promise<void> {
  const prefix = args.logPrefix ?? DEFAULT_LOG_PREFIX;
  if (!args.ctx.awaitEvent) {
    await args.ctx.sleepFor(args.stepName, args.seconds);
    return;
  }
  try {
    args.logger?.debug?.(
      {
        eventName: args.eventName,
        stepName: args.stepName,
        timeoutSec: args.seconds,
        description: args.description,
      },
      `${prefix}.wait.event.start`,
    );
    await args.ctx.awaitEvent(args.eventName, {
      stepName: args.stepName,
      timeout: args.seconds,
    });
    args.logger?.debug?.(
      { eventName: args.eventName, description: args.description },
      `${prefix}.wait.event.received`,
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      args.logger?.debug?.(
        { eventName: args.eventName, description: args.description },
        `${prefix}.wait.event.timeout`,
      );
      return;
    }
    throw error;
  }
}

export interface WaitForTaskOptions<TState> {
  tasks: TaskClient;
  ctx: WorkflowContext;
  pollIntervalSec: number;
  /**
   * Parse an accepted attempt's raw output into the domain state artifact.
   * Throwing here yields an `invalid_output` outcome (never an accepted one).
   */
  parse: (output: unknown) => TState;
  logger?: Logger;
  description?: string;
  /** Prefix for structured log event names. Default `orchestration`. */
  logPrefix?: string;
}

/**
 * Poll a MoltNet task to a terminal outcome. Between polls it prefers a durable
 * `moltnet.task.updated:<id>` event and falls back to sleeping. Returns one of
 * `accepted` (with parsed state), `failed`, or `invalid_output`.
 */
export async function waitForTaskOutcome<TState>(
  taskId: string,
  opts: WaitForTaskOptions<TState>,
): Promise<TaskOutcome<TState>> {
  const prefix = opts.logPrefix ?? DEFAULT_LOG_PREFIX;
  const { tasks, ctx, pollIntervalSec, parse, logger, description } = opts;
  logger?.info(
    { taskId, description, pollIntervalSec },
    `${prefix}.task.wait.start`,
  );
  for (;;) {
    const task = await tasks.getTask(taskId);
    logger?.debug?.(
      {
        taskId,
        description,
        status: task.status,
        acceptedAttemptN: task.acceptedAttemptN,
      },
      `${prefix}.task.wait.poll`,
    );
    if (task.status === 'failed' || task.status === 'cancelled') {
      const attempts = await tasks.listAttempts(taskId);
      logger?.error(
        { taskId, description, status: task.status },
        `${prefix}.task.wait.terminal_failure`,
      );
      return {
        kind: 'failed',
        task,
        attempts,
        reason: `task ${taskId} ended with status ${task.status}`,
      };
    }
    if (task.status === 'completed' && task.acceptedAttemptN !== null) {
      const attempts = await tasks.listAttempts(taskId);
      const attempt = attempts.find(
        (candidate) => candidate.attemptN === task.acceptedAttemptN,
      );
      if (!attempt || attempt.status !== 'completed') {
        return {
          kind: 'failed',
          task,
          attempts,
          reason: `task ${taskId} accepted attempt is not completed`,
        };
      }
      logger?.info(
        {
          taskId,
          description,
          acceptedAttemptN: task.acceptedAttemptN,
          outputCid: attempt.outputCid,
        },
        `${prefix}.task.wait.accepted`,
      );
      try {
        return {
          kind: 'accepted',
          result: { task, attempt, state: parse(attempt.output) },
        };
      } catch (error) {
        const reason =
          error instanceof Error
            ? error.message
            : `invalid task output: ${String(error)}`;
        logger?.error(
          {
            taskId,
            description,
            acceptedAttemptN: task.acceptedAttemptN,
            reason,
          },
          `${prefix}.task.wait.invalid_output`,
        );
        return { kind: 'invalid_output', task, attempt, reason };
      }
    }
    await waitForSignalOrSleep({
      ctx,
      eventName: `moltnet.task.updated:${taskId}`,
      stepName: `wait-task:${taskId}`,
      seconds: pollIntervalSec,
      logger,
      description,
      logPrefix: prefix,
    });
  }
}

/**
 * Like {@link waitForTaskOutcome} but throws on any non-accepted outcome,
 * returning the parsed accepted result directly.
 */
export async function waitForAcceptedTask<TState>(
  taskId: string,
  opts: WaitForTaskOptions<TState>,
): Promise<AcceptedTaskResult<TState>> {
  const outcome = await waitForTaskOutcome(taskId, opts);
  if (outcome.kind === 'accepted') return outcome.result;
  throw new Error(outcome.reason);
}
