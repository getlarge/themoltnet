import type { TaskOutput } from '@moltnet/tasks';
import type { Agent, TasksNamespace } from '@themoltnet/sdk';

/**
 * Translate a `TaskOutput` from the runtime into the corresponding
 * `complete` / `fail` REST call.
 *
 * The runtime promises that every claimed task produces exactly one
 * `TaskOutput`; this is where we honour that contract on the wire.
 *
 * Cancelled outputs are NOT reported. When the imposer cancels a task,
 * the server has already moved the row into a terminal `cancelled`
 * state and signalled the workflow (#938). Calling `/fail` afterwards
 * returns 409 "Task is already in terminal state" — the daemon's
 * cancellation acknowledgement happens implicitly via the heartbeat
 * response that fired `reporter.cancelSignal`.
 *
 * ## SuccessCriteria self-assessment is the LLM's job, not the daemon's
 *
 * The daemon does NOT evaluate `task.input.successCriteria`. When the
 * task input carries criteria, the producer LLM is responsible for
 * fetching its own task (`moltnet_get_task`), reading the criteria, and
 * including a `verification` block inside its output payload. The
 * daemon is a pure passthrough: it forwards whatever the LLM emitted to
 * `/complete` unchanged. Binding evaluation lives in a separate
 * judgment task — see `SuccessCriteria` in `@moltnet/tasks`.
 */
export async function finalizeTask(
  agent: Agent,
  output: TaskOutput,
): Promise<void> {
  if (output.status === 'cancelled') {
    return;
  }

  if (output.status === 'completed' && output.output && output.outputCid) {
    await agent.tasks.complete(output.taskId, output.attemptN, {
      output: output.output,
      outputCid: output.outputCid,
      usage: output.usage,
      ...(output.contentSignature
        ? { contentSignature: output.contentSignature }
        : {}),
    });
    return;
  }
  const error: NonNullable<Parameters<TasksNamespace['fail']>[2]>['error'] =
    output.error ?? {
      code: 'task_failed',
      message: 'Task execution failed before producing a valid output.',
      retryable: false,
    };
  await agent.tasks.fail(output.taskId, output.attemptN, { error });
}
