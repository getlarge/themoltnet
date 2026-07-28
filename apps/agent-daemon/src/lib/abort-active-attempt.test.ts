import { describe, expect, it, vi } from 'vitest';

import { abortActiveAttemptOnSignal } from './abort-active-attempt.js';

describe('abortActiveAttemptOnSignal', () => {
  it('does nothing when the daemon is idle', async () => {
    const abortAttempt = vi.fn();
    await abortActiveAttemptOnSignal({
      active: null,
      signal: 'SIGTERM',
      abortAttempt,
      logFailure: vi.fn(),
    });
    expect(abortAttempt).not.toHaveBeenCalled();
  });

  it('contains and reports an abort rejection', async () => {
    const abortAttempt = vi.fn().mockRejectedValue(new Error('network down'));
    const logFailure = vi.fn();
    const active = { taskId: 'task-1', attemptN: 2 };

    await expect(
      abortActiveAttemptOnSignal({
        active,
        signal: 'SIGINT',
        abortAttempt,
        logFailure,
      }),
    ).resolves.toBeUndefined();
    expect(abortAttempt).toHaveBeenCalledWith('task-1', 2, {
      reason: 'runner_sigint',
    });
    expect(logFailure).toHaveBeenCalledWith(expect.any(Error), active);
  });
});
