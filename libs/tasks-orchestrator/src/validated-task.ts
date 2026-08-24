import { waitForTaskOutcome } from './await-engine.js';
import { createTaskStep } from './task-step.js';
import type {
  CumulativeTaskUsage,
  SdkTask,
  SdkTaskAttempt,
  TaskOutcome,
  ValidatedTaskOutcome,
  WaitForValidatedTaskOptions,
} from './types.js';

const emptyUsage = (): CumulativeTaskUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: 0,
});

function outcomeAttempts<TState>(
  outcome: TaskOutcome<TState>,
): SdkTaskAttempt[] {
  if (outcome.kind === 'accepted') return [outcome.result.attempt];
  if (outcome.kind === 'invalid_output') return [outcome.attempt];
  return outcome.attempts;
}

function addOutcomeUsage<TState>(
  usage: CumulativeTaskUsage,
  outcome: TaskOutcome<TState>,
): void {
  for (const attempt of outcomeAttempts(outcome)) {
    if (!attempt.usage) continue;
    usage.inputTokens += attempt.usage.inputTokens;
    usage.outputTokens += attempt.usage.outputTokens;
    usage.cacheReadTokens += attempt.usage.cacheReadTokens ?? 0;
    usage.cacheWriteTokens += attempt.usage.cacheWriteTokens ?? 0;
    usage.toolCalls += attempt.usage.toolCalls ?? 0;
  }
}

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
    addOutcomeUsage(cumulativeUsage, outcome);

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
