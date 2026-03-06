/**
 * Generic DBOS workflow runner with built-in queue timeout and error translation.
 *
 * Wraps DBOS.startWorkflow + handle.getResult() with:
 * - `timeoutMS` passed to DBOS so the queue cancels the workflow server-side on timeout
 * - Typed error translation from all workflow-relevant DBOS errors to HTTP problem details
 */

import { DBOS, DBOSErrors, type WorkflowHandle } from '@moltnet/database';

import { createProblem } from '../problems/index.js';
import type { Logger } from './logger.js';

export const DEFAULT_WORKFLOW_TIMEOUT_MS = 60_000;

// Infer StartWorkflowParams from the SDK without importing it directly
type StartWorkflowParams = NonNullable<
  Parameters<typeof DBOS.startWorkflow>[1]
>;

export interface RunWorkflowOptions extends StartWorkflowParams {
  timeoutMS?: number;
  logger: Logger;
}

/**
 * Start a queued DBOS workflow and await its result.
 *
 * Passes `timeoutMS` to DBOS — the workflow is cancelled server-side when the
 * timeout expires, and `getResult()` will throw `DBOSWorkflowCancelledError`.
 * All DBOS error types are translated to typed HTTP problem details.
 */
export async function runWorkflow<Args extends unknown[], Return>(
  fn: (...args: Args) => Promise<Return>,
  options: RunWorkflowOptions,
  ...args: Args
): Promise<Return> {
  const {
    timeoutMS = DEFAULT_WORKFLOW_TIMEOUT_MS,
    logger,
    ...params
  } = options;

  let handle: WorkflowHandle<Return>;
  try {
    handle = await DBOS.startWorkflow(fn, { ...params, timeoutMS })(...args);
  } catch (err) {
    translateDBOSError(err, logger);
  }

  try {
    return await handle.getResult();
  } catch (err) {
    translateDBOSError(err, logger);
  }
}

function translateDBOSError(err: unknown, logger: Logger): never {
  if (err instanceof DBOSErrors.DBOSQueueDuplicatedError) {
    logger.error({ err }, 'Workflow dedup conflict');
    throw createProblem('conflict', 'A duplicate workflow is already queued.');
  }
  if (
    err instanceof DBOSErrors.DBOSWorkflowCancelledError ||
    err instanceof DBOSErrors.DBOSAwaitedWorkflowCancelledError
  ) {
    logger.error({ err }, 'Workflow timed out or was cancelled');
    throw createProblem(
      'service-unavailable',
      'Workflow timed out or was cancelled.',
    );
  }
  if (
    err instanceof DBOSErrors.DBOSExecutorNotInitializedError ||
    err instanceof DBOSErrors.DBOSNotRegisteredError
  ) {
    logger.error({ err }, 'Workflow service not ready');
    throw createProblem(
      'service-unavailable',
      'Workflow service is not ready.',
    );
  }
  if (
    err instanceof DBOSErrors.DBOSMaxStepRetriesError ||
    err instanceof DBOSErrors.DBOSError
  ) {
    logger.error({ err }, 'Workflow execution failed');
    throw createProblem('internal', 'Workflow execution failed.');
  }
  // Application-level error from the workflow function — let it propagate
  throw err;
}
