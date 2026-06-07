import { isReviewPassed, parseLifecycleStateArtifact } from './artifact.js';
import {
  buildContinuationTask,
  buildTriageTask,
  implementationBrief,
  implementationRetryBrief,
  lifecycleCriteria,
  normalizeLifecycleInput,
  notifyBrief,
  planBrief,
  releaseBrief,
  reviewBrief,
  revisePlanBrief,
} from './task-factory.js';
import type {
  AcceptedTaskResult,
  IssueLifecycleDeps,
  IssueLifecycleInput,
  TaskClient,
  WorkflowContext,
} from './types.js';

const inlineContext: WorkflowContext = {
  step(_name, fn) {
    return fn();
  },
  sleepFor() {
    return Promise.resolve();
  },
};

async function waitForAcceptedTask(
  taskId: string,
  tasks: TaskClient,
  ctx: WorkflowContext,
  pollIntervalSec: number,
): Promise<AcceptedTaskResult> {
  for (;;) {
    const task = await tasks.getTask(taskId);
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(`task ${taskId} ended with status ${task.status}`);
    }
    if (task.status === 'completed' && task.acceptedAttemptN !== null) {
      const attempts = await tasks.listAttempts(taskId);
      const attempt = attempts.find(
        (candidate) => candidate.attemptN === task.acceptedAttemptN,
      );
      if (!attempt || attempt.status !== 'completed') {
        throw new Error(`task ${taskId} accepted attempt is not completed`);
      }
      return {
        task,
        attempt,
        state: parseLifecycleStateArtifact(attempt.output),
      };
    }
    await ctx.sleepFor(`wait-task:${taskId}`, pollIntervalSec);
  }
}

async function waitForApprovalLabel(
  input: ReturnType<typeof normalizeLifecycleInput>,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
): Promise<void> {
  for (;;) {
    const approved = await deps.github.hasIssueLabel(
      input.repo,
      input.issueNumber,
      input.approvalLabel,
    );
    if (approved) return;
    await ctx.sleepFor('wait-plan-approval-label', input.pollIntervalSec);
  }
}

function reviewFindingsForRevision(
  state: AcceptedTaskResult['state'],
): string[] {
  if (state.findings && state.findings.length > 0) return state.findings;
  return [
    [
      `Review decision "${state.decision}" did not pass but produced no explicit findings.`,
      `Review summary: ${state.summary}`,
      'Revise the plan defensively, identify what the reviewer likely found insufficient, and make the next review artifact explicit.',
    ].join(' '),
  ];
}

export async function runGithubIssueLifecycle(
  rawInput: IssueLifecycleInput,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext = inlineContext,
): Promise<{ status: 'done'; correlationId: string; prNumber: number }> {
  const input = normalizeLifecycleInput(rawInput);
  const issue = await ctx.step('github.issue.get', () =>
    deps.github.getIssue(input.repo, input.issueNumber),
  );

  const triageTask = await ctx.step('task.triage.create', async () => {
    const body = await buildTriageTask(input, issue);
    return deps.tasks.createTask(body);
  });
  const triage = await waitForAcceptedTask(
    triageTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
  );
  if (triage.state.phase !== 'classified') {
    throw new Error(`triage produced unexpected phase ${triage.state.phase}`);
  }
  if (triage.state.decision !== 'plan') {
    throw new Error(
      `triage did not approve planning: ${triage.state.decision}`,
    );
  }

  const planTask = await ctx.step('task.plan.create', async () => {
    const body = await buildContinuationTask({
      input,
      issue,
      parentTaskId: triage.task.id,
      parentAttempt: triage.attempt,
      title: `Plan issue #${issue.number}`,
      brief: planBrief(issue),
      successCriteria: lifecycleCriteria.plan(),
    });
    return deps.tasks.createTask(body);
  });
  let latestPlan = await waitForAcceptedTask(
    planTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
  );

  let reviewPassed = false;
  for (let round = 1; round <= input.maxReviewRounds; round += 1) {
    const reviewTask = await ctx.step(
      `task.plan-review.${round}.create`,
      async () => {
        const body = await buildContinuationTask({
          input,
          issue,
          parentTaskId: latestPlan.task.id,
          parentAttempt: latestPlan.attempt,
          title: `Review plan for issue #${issue.number}`,
          brief: reviewBrief(),
          successCriteria: lifecycleCriteria.review(),
        });
        return deps.tasks.createTask(body);
      },
    );
    const review = await waitForAcceptedTask(
      reviewTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
    );
    if (isReviewPassed(review.state)) {
      reviewPassed = true;
      break;
    }

    const findings = reviewFindingsForRevision(review.state);
    const revisionTask = await ctx.step(
      `task.plan-revision.${round}.create`,
      async () => {
        const body = await buildContinuationTask({
          input,
          issue,
          parentTaskId: review.task.id,
          parentAttempt: review.attempt,
          title: `Revise plan for issue #${issue.number}`,
          brief: revisePlanBrief(findings),
          successCriteria: lifecycleCriteria.revisePlan(),
        });
        return deps.tasks.createTask(body);
      },
    );
    latestPlan = await waitForAcceptedTask(
      revisionTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
    );
  }
  if (!reviewPassed) {
    throw new Error(
      `plan review did not pass within ${input.maxReviewRounds} rounds`,
    );
  }

  await ctx.step('approval.label.wait', () =>
    waitForApprovalLabel(input, deps, ctx),
  );

  let implementationParent = latestPlan;
  let prNumber: number | null = null;
  for (
    let attempt = 0;
    attempt <= input.maxImplementationRetries;
    attempt += 1
  ) {
    const implTask = await ctx.step(
      `task.implement.${attempt}.create`,
      async () => {
        const body = await buildContinuationTask({
          input,
          issue,
          parentTaskId: implementationParent.task.id,
          parentAttempt: implementationParent.attempt,
          title: `Implement issue #${issue.number}`,
          brief:
            attempt === 0
              ? implementationBrief(issue)
              : implementationRetryBrief(),
          successCriteria: lifecycleCriteria.implement(),
        });
        return deps.tasks.createTask(body);
      },
    );
    const impl = await waitForAcceptedTask(
      implTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
    );
    if (impl.state.phase !== 'pr_open' || !impl.state.prNumber) {
      throw new Error('implementation did not produce a linked PR');
    }
    prNumber = impl.state.prNumber;
    implementationParent = impl;

    for (;;) {
      const pr = await deps.github.getPullRequest(input.repo, prNumber);
      if (pr.merged) break;
      if (pr.checks === 'failure') {
        if (attempt === input.maxImplementationRetries) {
          throw new Error(`PR #${prNumber} failed after retry budget`);
        }
        break;
      }
      await ctx.sleepFor(`wait-pr:${prNumber}`, input.pollIntervalSec);
    }

    const pr = await deps.github.getPullRequest(input.repo, prNumber);
    if (pr.merged) break;
  }

  if (prNumber === null) throw new Error('implementation did not open a PR');

  const releaseTask = await ctx.step('task.release.create', async () => {
    const body = await buildContinuationTask({
      input,
      issue,
      parentTaskId: implementationParent.task.id,
      parentAttempt: implementationParent.attempt,
      title: `Release issue #${issue.number}`,
      brief: releaseBrief(prNumber),
      successCriteria: lifecycleCriteria.release(),
    });
    return deps.tasks.createTask(body);
  });
  const release = await waitForAcceptedTask(
    releaseTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
  );

  const skipNotify = await deps.github.hasIssueLabel(
    input.repo,
    input.issueNumber,
    input.skipNotifyLabel,
  );
  const notifyTask = await ctx.step('task.notify.create', async () => {
    const body = await buildContinuationTask({
      input,
      issue,
      parentTaskId: release.task.id,
      parentAttempt: release.attempt,
      title: `Notify issue #${issue.number}`,
      brief: notifyBrief(issue, prNumber, skipNotify),
      successCriteria: lifecycleCriteria.notify(),
    });
    return deps.tasks.createTask(body);
  });
  await waitForAcceptedTask(
    notifyTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
  );

  return { status: 'done', correlationId: input.correlationId, prNumber };
}
