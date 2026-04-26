/**
 * Per-task resolvers for `pi-extension`'s `resolvePromptExtras` hook.
 *
 * The pi-extension's prompt builders for some task types (notably
 * `assess_brief`) need data the task input doesn't carry — e.g. the
 * judge's `target` bundle is built from the *target* fulfill_brief
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
} from '@moltnet/tasks';
import type { ClaimedTask } from '@themoltnet/agent-runtime';
import type { Agent } from '@themoltnet/sdk';

interface AssessBriefTargetBundle {
  taskId: string;
  branch: string | null;
  pullRequestUrl: string | null;
  summary: string | null;
  commitShas: string[];
  diaryEntryIds: string[];
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
      return resolveAssessBriefExtras(agent, task.input as AssessBriefInput);
    }

    return undefined;
  };
}

/**
 * For assess_brief: fetch the target fulfill_brief task and project
 * its accepted attempt output into the `target` bundle the judge
 * prompt expects.
 *
 * Failure mode: if the target can't be resolved (not found, no
 * accepted attempt yet, output shape mismatch), return undefined and
 * let the prompt builder throw with its existing error. That gives a
 * clear `prompt_build_failed` reason rather than a misleading "I
 * judged something but the data was wrong."
 */
async function resolveAssessBriefExtras(
  agent: Agent,
  input: AssessBriefInput,
): Promise<Record<string, unknown> | undefined> {
  const targetTaskId = input.targetTaskId;
  let targetTask;
  try {
    targetTask = await agent.tasks.get(targetTaskId);
  } catch {
    return undefined;
  }

  if (targetTask.acceptedAttemptN === null) {
    // Target hasn't completed yet. The judge has nothing to score
    // against — let the prompt builder fail explicitly.
    return undefined;
  }

  let targetAttempt;
  try {
    const attempts = await agent.tasks.listAttempts(targetTaskId);
    targetAttempt = attempts.find(
      (a: { attemptN: number }) => a.attemptN === targetTask.acceptedAttemptN,
    );
  } catch {
    return undefined;
  }

  if (!targetAttempt || !targetAttempt.output) return undefined;

  // FulfillBriefOutput shape: { branch, commits[{sha,message,diaryEntryId}],
  // pullRequestUrl, diaryEntryIds, summary }. Project into the judge's
  // target bundle. If the target task wasn't a fulfill_brief, the cast
  // is unsafe — but the judge prompt expects this shape regardless, so
  // surfacing missing fields as `null` is more helpful than failing.
  const out = targetAttempt.output as Partial<FulfillBriefOutput>;

  const target: AssessBriefTargetBundle = {
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

  return { target };
}
