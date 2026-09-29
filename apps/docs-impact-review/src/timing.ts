import type {
  SdkTask,
  SdkTaskAttempt,
  TaskMessage,
} from '@themoltnet/tasks-orchestrator';

import type { StageTiming } from './types.js';

function elapsed(
  from: string | null | undefined,
  to: string | null | undefined,
): number | null {
  if (!from || !to) return null;
  return Date.parse(to) - Date.parse(from);
}

function isModelEvent(message: TaskMessage): boolean {
  if (message.kind === 'tool_call_start') return true;
  if (message.kind !== 'text_delta') return false;
  const delta = (message.payload as { delta?: unknown } | null)?.delta;
  return typeof delta === 'string' && delta.trim().length > 0;
}

function isExecuteStart(message: TaskMessage): boolean {
  return (
    message.kind === 'info' &&
    (message.payload as { event?: unknown } | null)?.event === 'execute_start'
  );
}

/**
 * Splits one attempt into runtime phases. `messages` may be a first page of
 * the transcript: both markers are emitted early, and a missing marker yields
 * `null` phases rather than a guessed value.
 */
export function stageTiming(args: {
  task: SdkTask;
  attempt?: SdkTaskAttempt;
  messages: readonly TaskMessage[];
  observedMs: number;
}): StageTiming {
  const { task, attempt, messages } = args;
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  const queuedAt = task.queuedAt ?? null;
  const claimedAt = attempt?.claimedAt ?? null;
  const startedAt = attempt?.startedAt ?? null;
  const completedAt = attempt?.completedAt ?? null;
  const executeStartAt = ordered.find(isExecuteStart)?.timestamp ?? null;
  const firstModelEventAt = ordered.find(isModelEvent)?.timestamp ?? null;
  return {
    taskId: task.id,
    queuedAt,
    claimedAt,
    startedAt,
    executeStartAt,
    firstModelEventAt,
    completedAt,
    queueMs: elapsed(queuedAt, claimedAt),
    openMs: elapsed(claimedAt, startedAt),
    setupMs: elapsed(startedAt, executeStartAt),
    firstModelEventMs: elapsed(executeStartAt, firstModelEventAt),
    modelMs: elapsed(firstModelEventAt, completedAt),
    executionMs: elapsed(startedAt, completedAt),
    observedMs: args.observedMs,
    toolCalls: messages.length
      ? ordered.filter((message) => message.kind === 'tool_call_start').length
      : null,
    inputTokens: attempt?.usage?.inputTokens ?? null,
    outputTokens: attempt?.usage?.outputTokens ?? null,
    model: attempt?.usage?.model ?? null,
  };
}
