import type { Task, TaskOutput } from '@moltnet/tasks';
import type { Agent, TasksNamespace } from '@themoltnet/sdk';
import { MoltNetError } from '@themoltnet/sdk';

import {
  classifyAttemptFailure,
  classifyDeterministically,
  type RetryTriage,
} from './retry-triage.js';

// Forward a TaskOutput to /complete or attempt failure. Cancelled outputs are
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
  /**
   * Runtime slot info for the attempt — used to compute `daemonState`
   * stamped onto the attempt row at completion time. Pass `null` (or
   * omit) when there was no slot (slot-less freeform, non-freeform
   * task type). See `buildDaemonStateForComplete`.
   */
  slot?: { expiresAtMs: number | null } | null;
  retryTriage?: RetryTriage;
  writeCorrelationAnchors?: WriteCorrelationAnchors;
  log?: (msg: string, err?: unknown) => void;
}

/**
 * Build the `daemonState` payload for a `/complete` call. Freeform
 * attempts report the local warm-slot hint when one exists; slot-less
 * freeform completions report `null` for `slotResumableUntil`. The server
 * persists this verbatim as diagnostic/runtime metadata, not as the
 * continuation eligibility gate.
 *
 * Returns `null` for non-freeform task types so the field is omitted
 * from the request body (the server treats null and absent the same).
 */
export function buildDaemonStateForComplete(
  taskType: string,
  slot: { expiresAtMs: number | null } | null,
): { reportedAt: string; slotResumableUntil: string | null } | null {
  if (taskType !== 'freeform') return null;
  if (!slot || !slot.expiresAtMs) {
    return {
      reportedAt: new Date().toISOString(),
      slotResumableUntil: null,
    };
  }
  return {
    reportedAt: new Date().toISOString(),
    slotResumableUntil: new Date(slot.expiresAtMs).toISOString(),
  };
}

export async function finalizeTask(
  agent: Agent,
  output: TaskOutput,
  ctx: FinalizeContext = {},
): Promise<void> {
  if (output.status === 'cancelled') return;

  if (output.status === 'completed' && output.output && output.outputCid) {
    try {
      const daemonState = ctx.task
        ? buildDaemonStateForComplete(ctx.task.taskType, ctx.slot ?? null)
        : null;
      await agent.tasks.complete(output.taskId, output.attemptN, {
        output: output.output,
        outputCid: output.outputCid,
        usage: output.usage,
        ...(output.contentSignature
          ? { contentSignature: output.contentSignature }
          : {}),
        ...(daemonState ? { daemonState } : {}),
      });
    } catch (err) {
      // The server rejected the structured output (most commonly
      // VALIDATION_FAILED on a cross-field rule the LLM did not satisfy,
      // e.g. `output.verification is required because input.successCriteria
      // is set`). The reporter has already stopped heartbeats by the time
      // we get here, so doing nothing would let the lease expire silently
      // and the attempt would surface as `lease_expired` with no signal
      // of the real cause. Convert into an attempt failure so the
      // attempt carries the actual server-side reason — the next proposer
      // (retry, judge, etc.) can read the failure code and act.
      const reason = errorToFailReason(err);
      ctx.log?.('complete-rejected-falling-back-to-fail', err);
      await agent.tasks.failAttempt(output.taskId, output.attemptN, {
        error: reason,
      });
      return;
    }
    await maybeWriteAnchors(output, ctx);
    return;
  }

  const error: NonNullable<
    Parameters<TasksNamespace['failAttempt']>[2]
  >['error'] = output.error ?? {
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
  const classified = await prepareAttemptFailure(agent, output, error, ctx);
  ctx.log?.(`attempt-failure-classified:${classified.source}`);
  await agent.tasks.failAttempt(output.taskId, output.attemptN, {
    error: classified.error,
  });
}

function errorToFailReason(
  err: unknown,
): NonNullable<Parameters<TasksNamespace['failAttempt']>[2]>['error'] {
  if (err instanceof MoltNetError) {
    // VALIDATION_FAILED from the server carries field-level details that
    // are extremely useful for diagnosing a malformed output. Surface
    // them in the `message` so the failure record is self-contained.
    const fields = err.validationErrors?.length
      ? '; ' +
        err.validationErrors.map((e) => `${e.field}: ${e.message}`).join(' | ')
      : '';
    return {
      code: 'output_rejected_by_server',
      message:
        `Server rejected tasks.complete (${err.code}, status ${err.statusCode ?? '?'}): ` +
        `${err.detail ?? err.message}${fields}`,
      // The model produced output that violated a server-side rule. A
      // bare retry of the same attempt would hit the same rejection.
      // Mark non-retryable so the next attempt (or proposer) has a clean
      // signal that this isn't a transient transport failure.
      retryable: false,
    };
  }
  return {
    code: 'complete_call_failed',
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}

async function prepareAttemptFailure(
  agent: Agent,
  output: TaskOutput,
  error: NonNullable<Parameters<TasksNamespace['failAttempt']>[2]>['error'],
  ctx: FinalizeContext,
) {
  const task = ctx.task ?? {
    id: output.taskId,
    taskType: 'unknown',
    teamId: 'unknown',
    input: {},
    maxAttempts: null,
  };
  const deterministic = classifyDeterministically(error);
  const shouldFetchMessages = deterministic === 'ambiguous' && ctx.retryTriage;
  const recentMessages =
    shouldFetchMessages && ctx.task
      ? await agent.tasks
          .listMessages(output.taskId, output.attemptN)
          .then((messages) => messages.slice(-12))
          .catch((err) => {
            ctx.log?.('attempt-failure-message-fetch-failed', err);
            return [];
          })
      : [];

  return classifyAttemptFailure({
    task,
    attemptN: output.attemptN,
    maxAttempts: ctx.task?.maxAttempts ?? null,
    remainingAttempts:
      ctx.task?.maxAttempts === undefined
        ? null
        : Math.max(0, ctx.task.maxAttempts - output.attemptN),
    error,
    recentMessages,
    triage: ctx.retryTriage,
  });
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
