import type { TaskOutput } from '@moltnet/tasks';
import type { Agent, TasksNamespace } from '@themoltnet/sdk';

/**
 * Translate a `TaskOutput` from the runtime into the corresponding
 * `complete` / `fail` REST call.
 *
 * The runtime promises that every claimed task produces exactly one
 * `TaskOutput`; this is where we honour that contract on the wire.
 */
export async function finalizeTask(
  agent: Agent,
  output: TaskOutput,
): Promise<void> {
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
      code: output.status === 'cancelled' ? 'task_cancelled' : 'task_failed',
      message:
        output.status === 'cancelled'
          ? 'Task was cancelled by the runtime.'
          : 'Task execution failed before producing a valid output.',
      retryable: false,
    };
  await agent.tasks.fail(output.taskId, output.attemptN, { error });
}
