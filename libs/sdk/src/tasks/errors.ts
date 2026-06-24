import type { TaskValidationError } from '@moltnet/tasks';

/**
 * Render an array of field-level validation errors into a stable,
 * human-readable multi-line string (one `field: message` per line).
 *
 * @param errors - Field-level errors from `@moltnet/tasks` validators.
 * @returns One line per error, joined by newlines.
 */
export function formatValidationErrors(errors: TaskValidationError[]): string {
  return errors.map((e) => `${e.field}: ${e.message}`).join('\n');
}

/**
 * Thrown by {@link TaskBuilder.build} when the assembled create body fails
 * the shared `@moltnet/tasks` validation (the same rules the server runs).
 * Carries the raw field-level errors so callers (CLI, Node-RED) can branch
 * on `error.errors` instead of parsing the message.
 */
export class TaskBuildError extends Error {
  /** The field-level validation errors that caused the build to fail. */
  readonly errors: TaskValidationError[];

  constructor(errors: TaskValidationError[]) {
    super(`Task build failed:\n${formatValidationErrors(errors)}`);
    this.name = 'TaskBuildError';
    this.errors = errors;
  }
}

/**
 * Thrown by `readResult()` / `TaskResultReader` when a task has no accepted
 * attempt, its accepted attempt has no output/outputCid, or the output fails
 * its registered TypeBox output schema. Carries field-level detail in
 * `errors` for programmatic handling.
 */
export class TaskResultError extends Error {
  /** The field-level errors describing why the result could not be read. */
  readonly errors: TaskValidationError[];

  constructor(errors: TaskValidationError[]) {
    super(`Task result error:\n${formatValidationErrors(errors)}`);
    this.name = 'TaskResultError';
    this.errors = errors;
  }
}
