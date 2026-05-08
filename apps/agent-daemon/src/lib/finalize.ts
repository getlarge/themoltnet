import type { TaskOutput } from '@moltnet/tasks';
import type { Agent, TasksNamespace } from '@themoltnet/sdk';

// Forward a TaskOutput to /complete or /fail. Cancelled outputs are
// dropped (server is already terminal — #938). Pure passthrough on the
// verification axis: criteria evaluation is the LLM's job, see
// docs/agent-runtime.md for the producer/judge model.
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
