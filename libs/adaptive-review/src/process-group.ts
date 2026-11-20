import { setTimeout } from 'node:timers/promises';

const TERMINATION_GRACE_MS = 10_000;

/** A process leader exiting does not mean its descendants have stopped. */
export async function stopProcessGroup(
  pid: number,
  graceMs = TERMINATION_GRACE_MS,
): Promise<void> {
  const target = process.platform === 'win32' ? pid : -pid;
  const send = (signal: NodeJS.Signals | 0) => {
    try {
      process.kill(target, signal);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  };
  if (!send('SIGTERM')) return;
  const deadline = Date.now() + graceMs;
  while (Date.now() < deadline) {
    if (!send(0)) return;
    await setTimeout(Math.min(50, Math.max(1, deadline - Date.now())));
  }
  send('SIGKILL');
}
