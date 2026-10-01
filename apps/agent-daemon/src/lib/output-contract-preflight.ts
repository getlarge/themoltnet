import type { TaskOutput } from '@moltnet/tasks';
import {
  type ClaimedTask,
  validateAgentOutputContract,
} from '@themoltnet/agent-runtime';

/** Reject unsupported contracts after claim, before planning or starting Pi. */
export function preflightOutputContract(
  claimedTask: ClaimedTask,
): TaskOutput | null {
  const errors = validateAgentOutputContract(
    claimedTask.task.taskType,
    claimedTask.task.input,
  );
  if (errors.length === 0) return null;
  return {
    taskId: claimedTask.task.id,
    attemptN: claimedTask.attemptN,
    status: 'failed',
    output: null,
    outputCid: null,
    usage: { inputTokens: 0, outputTokens: 0 },
    durationMs: 0,
    error: {
      code: 'invalid_output_contract',
      message: errors
        .map(({ field, message }) => `${field}: ${message}`)
        .join('; '),
      retryable: false,
    },
  };
}
