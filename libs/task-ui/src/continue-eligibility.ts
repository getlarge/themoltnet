import type { TaskAttemptSummary, TaskSummary } from './types.js';

export interface ContinueEligibility {
  /** True when the UI should expose the Continue affordance. */
  eligible: boolean;
  /** Parsed slot TTL; null when the daemon never reported one. */
  resumableUntil: Date | null;
  /**
   * True when the slot was reported but is now in the past. Lets the UI
   * tell "no slot ever" (don't render the badge) from "slot expired"
   * (render a muted/historical badge) without re-implementing the date
   * comparison.
   */
  expired: boolean;
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

  const inFuture =
    resumableUntil !== null && resumableUntil.getTime() > now.getTime();
  const expired = resumableUntil !== null && !inFuture;

  const eligible =
    task.taskType === 'freeform' && attempt.status === 'completed' && inFuture;

  return { eligible, resumableUntil, expired };
}
