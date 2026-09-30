import { waitForTaskOutcome } from './await-engine.js';
import { createTaskStep } from './task-step.js';
import {
  addAttemptUsage,
  attemptsForOutcome,
  emptyUsage,
} from './task-usage.js';
import type {
  SdkTask,
  ValidatedTaskOutcome,
  WaitForValidatedTaskOptions,
} from './types.js';

/**
 * Await a task and repair accepted-but-domain-invalid output through bounded,
 * caller-created continuation tasks. Task status remains untouched: semantic
 * invalidity is represented only by this returned validation chain.
 */
export async function waitForValidatedTask<TState>(
  initialTask: SdkTask,
  options: WaitForValidatedTaskOptions<TState>,
): Promise<ValidatedTaskOutcome<TState>> {
  if (!Number.isSafeInteger(options.maxRepairs) || options.maxRepairs < 0) {
    throw new RangeError('maxRepairs must be a non-negative safe integer');
  }

  const chain: ValidatedTaskOutcome<TState>['chain'] = [];
  const cumulativeUsage = emptyUsage();
  let currentTask = initialTask;
  let repairN = 0;

  for (;;) {
    const outcome = await waitForTaskOutcome(currentTask.id, options);
    chain.push({ repairN, outcome });
    addAttemptUsage(cumulativeUsage, attemptsForOutcome(outcome));

    if (outcome.kind === 'accepted') {
      return {
        kind: 'accepted',
        result: outcome.result,
        chain,
        cumulativeUsage,
      };
    }
    if (outcome.kind === 'failed') {
      return {
        kind: 'failed',
        task: outcome.task,
        attempts: outcome.attempts,
        reason: outcome.reason,
        chain,
        cumulativeUsage,
      };
    }
    if (repairN === options.maxRepairs) {
      return {
        kind: 'exhausted',
        task: outcome.task,
        attempt: outcome.attempt,
        reason: outcome.reason,
        chain,
        cumulativeUsage,
      };
    }

    repairN += 1;
    currentTask = await createTaskStep(
      options.ctx,
      `validated-task:${initialTask.id}:repair:${repairN}.create`,
      ({ idempotencyKey }) =>
        options.createRepairTask({
          task: outcome.task,
          attempt: outcome.attempt,
          reason: outcome.reason,
          repairN,
          idempotencyKey,
        }),
    );
  }
}
