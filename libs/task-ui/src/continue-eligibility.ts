import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface ContinueEligibility {
  eligible: boolean;
  resumableUntil: Date | null;
}

export function canContinueAttempt(
  task: Pick<TaskSummary, 'taskType'>,
  attempt: Pick<TaskAttemptSummary, 'status' | 'daemonState'>,
  now: Date = new Date(),
): ContinueEligibility {
  const slotResumableUntil = attempt.daemonState?.slotResumableUntil ?? null;
  const resumableUntil = slotResumableUntil
    ? new Date(slotResumableUntil)
    : null;

  const eligible =
    task.taskType === 'freeform' &&
    attempt.status === 'completed' &&
    resumableUntil !== null &&
    resumableUntil.getTime() > now.getTime();

  return { eligible, resumableUntil };
}
