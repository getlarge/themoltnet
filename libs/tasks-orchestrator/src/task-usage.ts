import type {
  CumulativeTaskUsage,
  SdkTaskAttempt,
  TaskOutcome,
} from './types.js';

export const emptyUsage = (): CumulativeTaskUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  reasoningTokens: 0,
  toolCalls: 0,
  estimatedCostUsd: 0,
  costComplete: true,
});

/** Await outcomes carry the full attempt snapshot; accept legacy constructed outcomes too. */
export function attemptsForOutcome<TState>(
  outcome: TaskOutcome<TState>,
): SdkTaskAttempt[] {
  if (outcome.kind === 'failed') return outcome.attempts;
  if (outcome.attempts) return outcome.attempts;
  return outcome.kind === 'accepted'
    ? [outcome.result.attempt]
    : [outcome.attempt];
}

export function addAttemptUsage(
  usage: CumulativeTaskUsage,
  attempts: SdkTaskAttempt[],
): void {
  for (const attempt of attempts) {
    if (!attempt.usage) continue;
    usage.inputTokens += attempt.usage.inputTokens;
    usage.outputTokens += attempt.usage.outputTokens;
    usage.cacheReadTokens += attempt.usage.cacheReadTokens ?? 0;
    usage.cacheWriteTokens += attempt.usage.cacheWriteTokens ?? 0;
    usage.reasoningTokens += attempt.usage.reasoningTokens ?? 0;
    usage.toolCalls += attempt.usage.toolCalls ?? 0;
    const cost = attempt.usage.cost;
    usage.estimatedCostUsd += cost?.total ?? 0;
    const spent = attempt.usage.inputTokens + attempt.usage.outputTokens > 0;
    if (spent && !cost?.complete) usage.costComplete = false;
  }
}
