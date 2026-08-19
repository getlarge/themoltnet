import { CancelledTask, FailedTask, SuspendTask } from 'absurd-sdk';

/** Absurd control-flow exceptions must escape application error handling. */
export function isWorkflowInterruption(error: unknown): boolean {
  return (
    error instanceof SuspendTask ||
    error instanceof CancelledTask ||
    error instanceof FailedTask
  );
}
