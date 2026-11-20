export const DEFAULT_HOST_TIMEOUT_SEC = 7200;
export const MAX_HOST_TIMEOUT_SEC = 86400;
export const ACTION_CLEANUP_RESERVE_SEC = 120;
export const ACTION_JOB_TIMEOUT_SEC = 125 * 60;

/** Recompute at invocation, after provider installation may have used job time. */
export function hostTimeoutSeconds(
  source: NodeJS.ProcessEnv,
  requested = DEFAULT_HOST_TIMEOUT_SEC,
): number {
  if (
    !Number.isSafeInteger(requested) ||
    requested < 1 ||
    requested > MAX_HOST_TIMEOUT_SEC
  )
    throw new Error('timeout-sec must be between 1 and 86400');
  if (!source.ADAPTIVE_JOB_STARTED_MS) return requested;
  const started = Number(source.ADAPTIVE_JOB_STARTED_MS);
  if (!Number.isFinite(started) || started <= 0)
    throw new Error('Invalid job start timestamp');
  const remaining =
    Math.floor((started + ACTION_JOB_TIMEOUT_SEC * 1000 - Date.now()) / 1000) -
    ACTION_CLEANUP_RESERVE_SEC;
  if (remaining < 1) throw new Error('No review host time remains after setup');
  return Math.min(requested, remaining);
}
