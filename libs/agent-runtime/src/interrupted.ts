/** Stop this worker without finalizing an attempt whose durable state can resume. */
export class TaskExecutionInterrupted extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'TaskExecutionInterrupted';
  }
}
