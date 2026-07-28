export interface ActiveAttempt {
  taskId: string;
  attemptN: number;
}

interface AbortActiveAttemptOptions {
  active: ActiveAttempt | null;
  signal: 'SIGINT' | 'SIGTERM';
  abortAttempt: (
    taskId: string,
    attemptN: number,
    body: { reason: string },
  ) => Promise<unknown>;
  logFailure: (err: unknown, active: ActiveAttempt) => void;
}

/** Best-effort signal cleanup; lease expiry remains the final backstop. */
export async function abortActiveAttemptOnSignal(
  opts: AbortActiveAttemptOptions,
): Promise<void> {
  if (opts.active === null) return;
  try {
    await opts.abortAttempt(opts.active.taskId, opts.active.attemptN, {
      reason: `runner_${opts.signal.toLowerCase()}`,
    });
  } catch (err) {
    opts.logFailure(err, opts.active);
  }
}
