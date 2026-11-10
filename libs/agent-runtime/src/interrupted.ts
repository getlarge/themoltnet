/** Stop this worker without finalizing; reconcile server state before resuming. */
export class TaskExecutionInterrupted extends Error {
  /** The executor may opt in only after all execution resources have stopped.
   * Unknown or failed cleanup must leave automatic recovery disabled. */
  recoveryAllowed = false;

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TaskExecutionInterrupted';
  }
}
