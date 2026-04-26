/**
 * Per-task resolvers for `pi-extension`'s `resolvePromptExtras` hook.
 *
 * The pi-extension's prompt builders for some task types (notably
 * `assess_brief`) need data the task input doesn't carry — e.g. the
 * judge's `target` projection is built from the *target* fulfill_brief
 * task's accepted attempt output, not from the assess_brief task
 * itself.
 *
 * Resolution lives here in the daemon (not in pi-extension) because the
 * daemon has the SDK in scope to fetch dependent rows. Pi-extension
 * stays task-type-agnostic: it just calls whatever resolver the daemon
 * registered.
 */
import {
  ASSESS_BRIEF_TYPE,
  type AssessBriefInput,
  type FulfillBriefOutput,
  validateTaskInput,
} from '@moltnet/tasks';
import {
  ASSESS_BRIEF_TARGET_EXTRA_KEY,
  type AssessBriefTarget,
  type ClaimedTask,
} from '@themoltnet/agent-runtime';
import type { Agent } from '@themoltnet/sdk';

function logResolveFailure(reason: string, detail: Record<string, unknown>) {
  // Stderr is already where the daemon logs its lifecycle events; keeping
  // this consistent with `[poll]` / `[once]` output. Each early-return path
  // calls this so the operator can distinguish "target task not found"
  // from "target output shape mismatch" without crawling SDK internals.
  process.stderr.write(
    `[resolve-extras] assess_brief: ${reason} ${JSON.stringify(detail)}\n`,
  );
}

/**
 * Build the resolver passed to `createPiTaskExecutor.resolvePromptExtras`.
 * Returns `undefined` for task types that don't need per-task extras
 * (most of them) so the pi-extension can fall back to its static
 * `promptExtras`.
 */
export function createPromptExtrasResolver(agent: Agent) {
  return async function resolvePromptExtras(
    claimedTask: ClaimedTask,
  ): Promise<Record<string, unknown> | undefined> {
    const task = claimedTask.task;

    if (task.taskType === ASSESS_BRIEF_TYPE) {
      return resolveAssessBriefExtras(agent, task.input, task.id);
    }

    return undefined;
  };
}

/**
 * For assess_brief: fetch the target fulfill_brief task and project
 * its accepted attempt output into the `target` projection the judge
 * prompt expects.
 *
 * Failure mode: every short-circuit logs the reason and returns
 * `undefined`. The prompt builder's existing throw fires next with
 * "requires ctx.extras.target", giving the operator a clear
 * `prompt_build_failed` (and they can grep stderr for
 * `[resolve-extras]` to find which path tripped).
 */
async function resolveAssessBriefExtras(
  agent: Agent,
  rawInput: unknown,
  assessTaskId: string,
): Promise<Record<string, unknown> | undefined> {
  // Validate before reaching for fields. The pi-extension prompt
  // builder validates input again right after, so this is
  // belt-and-braces — but we'd rather log a typed reason here than
  // pass through bad data and have the prompt builder throw with a
  // less actionable error.
  const validationErrors = validateTaskInput(ASSESS_BRIEF_TYPE, rawInput);
  if (validationErrors.length > 0) {
    logResolveFailure('input failed validation', {
      assessTaskId,
      errors: validationErrors.slice(0, 3),
    });
    return undefined;
  }
  const input = rawInput as AssessBriefInput;
  const targetTaskId = input.targetTaskId;

  let targetTask;
  try {
    targetTask = await agent.tasks.get(targetTaskId);
  } catch (err) {
    logResolveFailure('target task fetch failed', {
      assessTaskId,
      targetTaskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  if (targetTask.acceptedAttemptN === null) {
    logResolveFailure('target has no accepted attempt', {
      assessTaskId,
      targetTaskId,
      targetStatus: targetTask.status,
    });
    return undefined;
  }

  let targetAttempt;
  try {
    const attempts = await agent.tasks.listAttempts(targetTaskId);
    targetAttempt = attempts.find(
      (a: { attemptN: number }) => a.attemptN === targetTask.acceptedAttemptN,
    );
  } catch (err) {
    logResolveFailure('target attempts list failed', {
      assessTaskId,
      targetTaskId,
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }

  if (!targetAttempt) {
    logResolveFailure('accepted attempt not found in list', {
      assessTaskId,
      targetTaskId,
      acceptedAttemptN: targetTask.acceptedAttemptN,
    });
    return undefined;
  }
  if (!targetAttempt.output) {
    logResolveFailure('accepted attempt has null output', {
      assessTaskId,
      targetTaskId,
      attemptN: targetAttempt.attemptN,
    });
    return undefined;
  }

  // FulfillBriefOutput shape: { branch, commits[{sha,message,diaryEntryId}],
  // pullRequestUrl, diaryEntryIds, summary }. Project into the judge's
  // target. If the target task wasn't actually a fulfill_brief, the
  // shape may be partially absent — emit nulls / empty arrays rather
  // than throwing, so the judge can still reason from rubricPreamble.
  const out = targetAttempt.output as Partial<FulfillBriefOutput>;

  const target: AssessBriefTarget = {
    taskId: targetTaskId,
    branch: typeof out.branch === 'string' ? out.branch : null,
    pullRequestUrl:
      typeof out.pullRequestUrl === 'string' ? out.pullRequestUrl : null,
    summary: typeof out.summary === 'string' ? out.summary : null,
    commitShas: Array.isArray(out.commits)
      ? out.commits.map((c) => c.sha).filter((s) => typeof s === 'string')
      : [],
    diaryEntryIds: Array.isArray(out.diaryEntryIds)
      ? out.diaryEntryIds.filter((s) => typeof s === 'string')
      : [],
  };

  return { [ASSESS_BRIEF_TARGET_EXTRA_KEY]: target };
}
