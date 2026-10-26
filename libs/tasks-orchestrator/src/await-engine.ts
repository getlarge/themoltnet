import { isTransientMoltNetError } from '@themoltnet/sdk';

import type {
  AcceptedTaskResult,
  Logger,
  SdkTaskAttempt,
  TaskOutcome,
  WaitForTaskOptions,
  WorkflowContext,
} from './types.js';

const DEFAULT_LOG_PREFIX = 'orchestration';
/** Consecutive transient read failures tolerated before the wait fails. */
const MAX_CONSECUTIVE_READ_FAILURES = 5;

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

/**
 * Poll a MoltNet task to a terminal outcome. Between polls it prefers a durable
 * `moltnet.task.updated:<id>` event and falls back to sleeping. Returns one of
 * `accepted` (with parsed state), `failed`, or `invalid_output`.
 *
 * A transient read failure (transport, HTTP 408/429/5xx) counts as a missed
 * poll and is retried on the poll cadence. After
 * {@link MAX_CONSECUTIVE_READ_FAILURES} in a row, or on any other error, the
 * error propagates: a read failure says nothing about the task's outcome.
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
  const pause = () =>
    waitForSignalOrSleep({
      ctx,
      eventName: `moltnet.task.updated:${taskId}`,
      stepName: `wait-task:${taskId}`,
      seconds: pollIntervalSec,
      logger,
      description,
      logPrefix: prefix,
    });
  let readFailures = 0;
  // Resolves undefined after a tolerated transient failure; the caller then
  // pauses and polls again.
  const read = async <T>(request: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await request();
    } catch (error) {
      readFailures += 1;
      if (
        !isTransientMoltNetError(error) ||
        readFailures > MAX_CONSECUTIVE_READ_FAILURES
      )
        throw error;
      logger?.warn(
        { taskId, description, readFailures },
        `${prefix}.task.wait.read_retry`,
      );
      return undefined;
    }
  };
  for (;;) {
    const task = await read(() => tasks.getTask(taskId));
    if (!task) {
      await pause();
      continue;
    }
    logger?.debug?.(
      {
        taskId,
        description,
        status: task.status,
        acceptedAttemptN: task.acceptedAttemptN,
      },
      `${prefix}.task.wait.poll`,
    );
    if (
      task.status === 'failed' ||
      task.status === 'cancelled' ||
      task.status === 'expired' ||
      (task.status === 'completed' && task.acceptedAttemptN === null)
    ) {
      const attempts = await read(() => tasks.listAttempts(taskId));
      if (!attempts) {
        await pause();
        continue;
      }
      logger?.error(
        { taskId, description, status: task.status },
        `${prefix}.task.wait.terminal_failure`,
      );
      return {
        kind: 'failed',
        task,
        attempts,
        reason:
          task.status === 'completed'
            ? `task ${taskId} completed without an accepted attempt`
            : `task ${taskId} ended with status ${task.status}`,
      };
    }
    if (task.status === 'completed' && task.acceptedAttemptN !== null) {
      const attempts = await read(() => tasks.listAttempts(taskId));
      if (!attempts) {
        await pause();
        continue;
      }
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
          attempts,
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
        return { kind: 'invalid_output', task, attempt, attempts, reason };
      }
    }
    // Only a full non-terminal poll clears the count, so a terminal task
    // whose attempts keep failing to load cannot poll forever.
    readFailures = 0;
    await pause();
  }
}

/**
 * A non-accepted task outcome. The message is the outcome reason; the fields
 * let callers classify the failure without parsing it.
 */
export class TaskOutcomeError extends Error {
  readonly taskId: string;
  readonly kind: 'failed' | 'invalid_output';
  /** Error code of the latest attempt (e.g. `max_turns_exceeded`), if any. */
  readonly attemptErrorCode: string | null;

  constructor(
    taskId: string,
    outcome: Exclude<TaskOutcome<unknown>, { kind: 'accepted' }>,
  ) {
    super(outcome.reason);
    this.name = 'TaskOutcomeError';
    this.taskId = taskId;
    this.kind = outcome.kind;
    const latest = (outcome.attempts ?? []).reduce<SdkTaskAttempt | undefined>(
      (last, attempt) =>
        !last || attempt.attemptN > last.attemptN ? attempt : last,
      undefined,
    );
    const code: unknown = (latest?.error as { code?: unknown } | null)?.code;
    this.attemptErrorCode = typeof code === 'string' ? code : null;
  }
}

/**
 * Like {@link waitForTaskOutcome} but throws {@link TaskOutcomeError} on any
 * non-accepted outcome, returning the parsed accepted result directly.
 */
export async function waitForAcceptedTask<TState>(
  taskId: string,
  opts: WaitForTaskOptions<TState>,
): Promise<AcceptedTaskResult<TState>> {
  const outcome = await waitForTaskOutcome(taskId, opts);
  if (outcome.kind === 'accepted') return outcome.result;
  throw new TaskOutcomeError(taskId, outcome);
}
