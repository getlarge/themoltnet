import type { Task, TaskOutput } from '@moltnet/tasks';
import type { Agent, TasksNamespace } from '@themoltnet/sdk';

// Forward a TaskOutput to /complete or /fail. Cancelled outputs are
// dropped (server is already terminal — #938). Pure passthrough on the
// verification axis: criteria evaluation is the LLM's job, see
// docs/understand/agent-runtime.md for the producer/judge model.
//
// For fulfill_brief tasks with a non-null correlationId and a
// pullRequestUrl in the output, also invokes `writeCorrelationAnchors`
// to stamp the PR body with the correlation marker. Branch name and
// first-commit trailer (the other GitHub-side anchors) are produced by
// the agent inside the fulfill run, not here. Anchor failures are
// logged and swallowed — the MoltNet `task.references` row is the
// primary anchor and does not depend on the GitHub-side writes.

export interface CorrelationAnchorInput {
  correlationId: string;
  pullRequestUrl: string;
}

export type WriteCorrelationAnchors = (
  input: CorrelationAnchorInput,
) => Promise<void>;

export interface FinalizeContext {
  /**
   * The claimed task that produced the output. When provided alongside
   * `writeCorrelationAnchors`, finalize stamps the PR with a correlation
   * marker for fulfill_brief outputs that opened a PR.
   */
  task?: Task;
  writeCorrelationAnchors?: WriteCorrelationAnchors;
  log?: (msg: string, err?: unknown) => void;
}

export async function finalizeTask(
  agent: Agent,
  output: TaskOutput,
  ctx: FinalizeContext = {},
): Promise<void> {
  if (output.status === 'cancelled') return;

  if (output.status === 'completed' && output.output && output.outputCid) {
    await agent.tasks.complete(output.taskId, output.attemptN, {
      output: output.output,
      outputCid: output.outputCid,
      usage: output.usage,
      ...(output.contentSignature
        ? { contentSignature: output.contentSignature }
        : {}),
    });
    await maybeWriteAnchors(output, ctx);
    return;
  }

  const error: NonNullable<Parameters<TasksNamespace['fail']>[2]>['error'] =
    output.error ?? {
      code: 'task_failed',
      message: 'Task execution failed before producing a valid output.',
      retryable: false,
    };
  const heartbeat = await agent.tasks.heartbeat(
    output.taskId,
    output.attemptN,
    {},
  );
  if (heartbeat.cancelled) return;
  await agent.tasks.fail(output.taskId, output.attemptN, { error });
}

async function maybeWriteAnchors(
  output: TaskOutput,
  ctx: FinalizeContext,
): Promise<void> {
  const { task, writeCorrelationAnchors, log } = ctx;
  if (!task || task.taskType !== 'fulfill_brief') return;
  if (!task.correlationId) return;
  if (!writeCorrelationAnchors) return;

  const pr = (output.output as { pullRequestUrl?: string | null } | null)
    ?.pullRequestUrl;
  if (!pr) return;

  try {
    await writeCorrelationAnchors({
      correlationId: task.correlationId,
      pullRequestUrl: pr,
    });
  } catch (err) {
    log?.('correlation-anchor-write-failed', err);
  }
}
