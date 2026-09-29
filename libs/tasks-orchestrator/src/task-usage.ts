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
  toolCalls: 0,
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
    usage.toolCalls += attempt.usage.toolCalls ?? 0;
  }
}
