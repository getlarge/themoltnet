import type {
  CumulativeTaskUsage,
  SdkTaskAttempt,
  TaskClient,
  TaskOutcome,
} from './types.js';

export const emptyUsage = (): CumulativeTaskUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  toolCalls: 0,
});

/** Failed outcomes include all attempts; completed outcomes expose only the accepted one. */
export async function attemptsForOutcome<TState>(
  outcome: TaskOutcome<TState>,
  tasks: TaskClient,
): Promise<SdkTaskAttempt[]> {
  if (outcome.kind === 'failed') return outcome.attempts;
  const taskId =
    outcome.kind === 'accepted' ? outcome.result.task.id : outcome.task.id;
  return tasks.listAttempts(taskId);
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
