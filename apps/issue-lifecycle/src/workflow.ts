import { isReviewPassed } from './artifact.js';
import {
  acceptedStatusLine,
  type LifecycleStatusLine,
  setStatusLine,
  taskStatusLine,
} from './status-comment.js';
import {
  buildContinuationTask,
  buildFreshImplementationTask,
  buildPrReviewResolutionTask,
  buildPrReviewTask,
  buildTriageTask,
  implementationBrief,
  implementationRetryBrief,
  lifecycleCriteria,
  normalizeLifecycleInput,
  notifyBrief,
  planBrief,
  reviewBrief,
  revisePlanBrief,
} from './task-factory.js';
import type {
  AcceptedTaskResult,
  IssueLifecycleDeps,
  IssueLifecycleInput,
  WorkflowContext,
} from './types.js';
import {
  ensureApprovalPromptComment,
  ensureReadyForReviewComment,
  logCreatedTask,
  reviewFindingsForRevision,
  updateLifecycleStatusComment,
  waitForApprovalLabel,
  waitForGreenPrChecks,
  waitForPrMergeOrFailure,
} from './workflow-steps.js';
import { waitForLifecycleTask } from './workflow-supervisor.js';

const inlineContext: WorkflowContext = {
  step(_name, fn) {
    return fn();
  },
  sleepFor() {
    return Promise.resolve();
  },
};

export async function runGithubIssueLifecycle(
  rawInput: IssueLifecycleInput,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext = inlineContext,
): Promise<{ status: 'done'; correlationId: string; prNumber: number }> {
  const input = normalizeLifecycleInput(rawInput);
  deps.logger?.info(
    {
      repo: input.repo,
      issueNumber: input.issueNumber,
      correlationId: input.correlationId,
      consoleUrl: input.consoleUrl,
      approvalLabel: input.approvalLabel,
      skipNotifyLabel: input.skipNotifyLabel,
      pollIntervalSec: input.pollIntervalSec,
      maxReviewRounds: input.maxReviewRounds,
      maxImplementationRetries: input.maxImplementationRetries,
    },
    'issue_lifecycle.start',
  );
  const issue = await ctx.step('github.issue.get', () =>
    deps.github.getIssue(input.repo, input.issueNumber),
  );
  deps.logger?.info(
    {
      repo: input.repo,
      issueNumber: issue.number,
      title: issue.title,
      labels: issue.labels,
    },
    'issue_lifecycle.issue.loaded',
  );
  const statusLines: LifecycleStatusLine[] = [];
  const updateStatus = () =>
    updateLifecycleStatusComment({
      input,
      issueNumber: issue.number,
      lines: statusLines,
      deps,
      ctx,
    });

  const triageTask = await ctx.step('task.triage.create', async () => {
    const body = await buildTriageTask(input, issue);
    const task = await deps.tasks.createTask(body);
    logCreatedTask(deps.logger, 'triage', task);
    return task;
  });
  setStatusLine(
    statusLines,
    taskStatusLine('triage', 'Triage', 'running', triageTask, 'Task created'),
  );
  await updateStatus();
  const triage = await waitForLifecycleTask({
    taskId: triageTask.id,
    step: 'triage',
    description: 'triage',
    input,
    issue,
    deps,
    ctx,
  });
  deps.logger?.info(
    {
      taskId: triage.task.id,
      phase: triage.state.phase,
      decision: triage.state.decision,
      summary: triage.state.summary,
    },
    'issue_lifecycle.triage.accepted',
  );
  setStatusLine(statusLines, acceptedStatusLine('triage', 'Triage', triage));
  await updateStatus();
  if (triage.state.phase !== 'classified') {
    setStatusLine(statusLines, {
      key: 'triage',
      label: 'Triage',
      status: 'failed',
      taskId: triage.task.id,
      attemptN: triage.attempt.attemptN,
      summary: `Unexpected phase ${triage.state.phase}`,
    });
    await updateStatus();
    throw new Error(`triage produced unexpected phase ${triage.state.phase}`);
  }
  if (triage.state.decision !== 'plan') {
    deps.logger?.warn(
      { decision: triage.state.decision, summary: triage.state.summary },
      'issue_lifecycle.triage.not_planning_ready',
    );
    setStatusLine(statusLines, {
      key: 'triage',
      label: 'Triage',
      status: 'failed',
      taskId: triage.task.id,
      attemptN: triage.attempt.attemptN,
      summary: `Not planning-ready: ${triage.state.decision}`,
    });
    await updateStatus();
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
    const task = await deps.tasks.createTask(body);
    logCreatedTask(deps.logger, 'plan', task);
    return task;
  });
  setStatusLine(
    statusLines,
    taskStatusLine('plan', 'Plan', 'running', planTask, 'Task created'),
  );
  await updateStatus();
  let latestPlan = await waitForLifecycleTask({
    taskId: planTask.id,
    step: 'plan',
    description: 'plan',
    input,
    issue,
    deps,
    ctx,
  });
  deps.logger?.info(
    {
      taskId: latestPlan.task.id,
      phase: latestPlan.state.phase,
      decision: latestPlan.state.decision,
      summary: latestPlan.state.summary,
    },
    'issue_lifecycle.plan.accepted',
  );
  setStatusLine(statusLines, acceptedStatusLine('plan', 'Plan', latestPlan));
  await updateStatus();

  let reviewPassed = false;
  let approvedReview: AcceptedTaskResult | null = null;
  for (let round = 1; round <= input.maxReviewRounds; round += 1) {
    deps.logger?.info(
      { round, maxReviewRounds: input.maxReviewRounds },
      'issue_lifecycle.review.round.start',
    );
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
        const task = await deps.tasks.createTask(body);
        logCreatedTask(deps.logger, `plan-review.${round}`, task);
        return task;
      },
    );
    setStatusLine(
      statusLines,
      taskStatusLine(
        'plan-review',
        `Plan review round ${round}`,
        'running',
        reviewTask,
        'Task created',
      ),
    );
    await updateStatus();
    const review = await waitForLifecycleTask({
      taskId: reviewTask.id,
      step: `plan-review.${round}`,
      description: `plan-review.${round}`,
      input,
      issue,
      deps,
      ctx,
    });
    deps.logger?.info(
      {
        round,
        taskId: review.task.id,
        decision: review.state.decision,
        findingsCount: review.state.findings?.length ?? 0,
        summary: review.state.summary,
      },
      'issue_lifecycle.review.accepted',
    );
    setStatusLine(
      statusLines,
      acceptedStatusLine('plan-review', `Plan review round ${round}`, review),
    );
    await updateStatus();
    if (isReviewPassed(review.state)) {
      reviewPassed = true;
      approvedReview = review;
      deps.logger?.info(
        { round, taskId: review.task.id },
        'issue_lifecycle.review.passed',
      );
      break;
    }

    const findings = reviewFindingsForRevision(review.state);
    deps.logger?.info(
      { round, findings },
      'issue_lifecycle.review.revision_required',
    );
    setStatusLine(statusLines, {
      key: 'plan-review',
      label: `Plan review round ${round}`,
      status: 'failed',
      taskId: review.task.id,
      attemptN: review.attempt.attemptN,
      summary: `Findings: ${findings.join('; ')}`,
    });
    await updateStatus();
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
        const task = await deps.tasks.createTask(body);
        logCreatedTask(deps.logger, `plan-revision.${round}`, task);
        return task;
      },
    );
    setStatusLine(
      statusLines,
      taskStatusLine(
        'plan',
        `Plan revision round ${round}`,
        'running',
        revisionTask,
        'Task created',
      ),
    );
    await updateStatus();
    latestPlan = await waitForLifecycleTask({
      taskId: revisionTask.id,
      step: `plan-revision.${round}`,
      description: `plan-revision.${round}`,
      input,
      issue,
      deps,
      ctx,
    });
    deps.logger?.info(
      {
        round,
        taskId: latestPlan.task.id,
        decision: latestPlan.state.decision,
        summary: latestPlan.state.summary,
      },
      'issue_lifecycle.plan.revised',
    );
    setStatusLine(
      statusLines,
      acceptedStatusLine('plan', `Plan revision round ${round}`, latestPlan),
    );
    await updateStatus();
  }
  if (!reviewPassed) {
    setStatusLine(statusLines, {
      key: 'plan-review',
      label: 'Plan review',
      status: 'failed',
      summary: `Did not pass within ${input.maxReviewRounds} rounds`,
    });
    await updateStatus();
    throw new Error(
      `plan review did not pass within ${input.maxReviewRounds} rounds`,
    );
  }
  if (!approvedReview) {
    throw new Error('plan review passed without an accepted review result');
  }

  await ensureApprovalPromptComment(
    input,
    issue.number,
    latestPlan,
    approvedReview,
    deps,
    ctx,
  );
  setStatusLine(statusLines, {
    key: 'approval',
    label: 'Human approval',
    status: 'waiting',
    summary: `Waiting for ${input.approvalLabel}`,
  });
  await updateStatus();

  await waitForApprovalLabel(input, deps, ctx);
  deps.logger?.info(
    { issueNumber: issue.number, correlationId: input.correlationId },
    'issue_lifecycle.approval.complete',
  );
  setStatusLine(statusLines, {
    key: 'approval',
    label: 'Human approval',
    status: 'completed',
    summary: `${input.approvalLabel} observed after prompt`,
  });
  await updateStatus();

  let implementationParent = approvedReview;
  let prNumber: number | null = null;
  let reviewResults: AcceptedTaskResult[] = [];
  for (
    let attempt = 0;
    attempt <= input.maxImplementationRetries;
    attempt += 1
  ) {
    deps.logger?.info(
      { attempt, maxImplementationRetries: input.maxImplementationRetries },
      'issue_lifecycle.implementation.attempt.start',
    );
    const implTask = await ctx.step(
      `task.implement.${attempt}.create`,
      async () => {
        const body =
          attempt === 0
            ? await buildFreshImplementationTask({
                input,
                issue,
                planTaskId: latestPlan.task.id,
                planAttempt: latestPlan.attempt,
                reviewTaskId: approvedReview.task.id,
                reviewAttempt: approvedReview.attempt,
                brief: implementationBrief(issue),
                successCriteria: lifecycleCriteria.implement(),
              })
            : await buildContinuationTask({
                input,
                issue,
                parentTaskId: implementationParent.task.id,
                parentAttempt: implementationParent.attempt,
                title: `Implement issue #${issue.number}`,
                brief: implementationRetryBrief(),
                successCriteria: lifecycleCriteria.implement(),
              });
        const task = await deps.tasks.createTask(body);
        logCreatedTask(deps.logger, `implement.${attempt}`, task);
        return task;
      },
    );
    setStatusLine(
      statusLines,
      taskStatusLine(
        'implementation',
        attempt === 0 ? 'Implementation' : `Implementation retry ${attempt}`,
        'running',
        implTask,
        'Task created',
      ),
    );
    await updateStatus();
    const impl = await waitForLifecycleTask({
      taskId: implTask.id,
      step: `implement.${attempt}`,
      description: `implement.${attempt}`,
      input,
      issue,
      deps,
      ctx,
    });
    deps.logger?.info(
      {
        attempt,
        taskId: impl.task.id,
        phase: impl.state.phase,
        decision: impl.state.decision,
        prNumber: impl.state.prNumber,
        prUrl: impl.state.prUrl,
      },
      'issue_lifecycle.implementation.accepted',
    );
    setStatusLine(
      statusLines,
      acceptedStatusLine(
        'implementation',
        attempt === 0 ? 'Implementation' : `Implementation retry ${attempt}`,
        impl,
      ),
    );
    await updateStatus();
    if (impl.state.phase !== 'pr_open' || !impl.state.prNumber) {
      setStatusLine(statusLines, {
        key: 'implementation',
        label: 'Implementation',
        status: 'failed',
        taskId: impl.task.id,
        attemptN: impl.attempt.attemptN,
        summary: 'Implementation did not produce a linked PR',
      });
      await updateStatus();
      throw new Error('implementation did not produce a linked PR');
    }
    prNumber = impl.state.prNumber;
    const linkedPrNumber = prNumber;
    implementationParent = impl;
    setStatusLine(statusLines, {
      key: 'pr',
      label: 'Pull request',
      status: 'waiting',
      prNumber: linkedPrNumber,
      prUrl: impl.state.prUrl,
      summary: 'Waiting for green CI before agent reviews',
    });
    await updateStatus();

    const initialGate = await waitForGreenPrChecks(
      input,
      linkedPrNumber,
      deps,
      ctx,
      attempt,
    );
    if (initialGate === 'merged') break;
    if (initialGate === 'failure') {
      if (attempt === input.maxImplementationRetries) {
        throw new Error(`PR #${linkedPrNumber} failed after retry budget`);
      }
      deps.logger?.warn(
        { prNumber: linkedPrNumber, attempt },
        'issue_lifecycle.pr.checks_failed_retrying',
      );
      setStatusLine(statusLines, {
        key: 'pr',
        label: 'Pull request',
        status: 'failed',
        prNumber: linkedPrNumber,
        prUrl: impl.state.prUrl,
        summary: 'Checks failed; creating implementation retry',
      });
      await updateStatus();
      continue;
    }

    setStatusLine(statusLines, {
      key: 'pr',
      label: 'Pull request',
      status: 'completed',
      prNumber: linkedPrNumber,
      prUrl: impl.state.prUrl,
      summary: 'CI green; starting agent PR reviews',
    });
    await updateStatus();

    const reviewKinds = ['complexity', 'functional', 'security'] as const;
    const reviewTasks = await Promise.all(
      reviewKinds.map((kind) =>
        ctx.step(`task.pr-review.${kind}.${attempt}.create`, async () => {
          const body = await buildPrReviewTask({
            input,
            issue,
            implementationTaskId: impl.task.id,
            implementationAttempt: impl.attempt,
            prNumber: linkedPrNumber,
            kind,
          });
          const task = await deps.tasks.createTask(body);
          logCreatedTask(deps.logger, `pr-review.${kind}.${attempt}`, task);
          return { kind, task };
        }),
      ),
    );
    setStatusLine(statusLines, {
      key: 'pr-review',
      label: 'Agent PR reviews',
      status: 'running',
      summary: 'Complexity, functional, and security reviews created',
    });
    await updateStatus();
    reviewResults = await Promise.all(
      reviewTasks.map(async ({ kind, task }) => {
        const result = await waitForLifecycleTask({
          taskId: task.id,
          step: `pr-review.${kind}.${attempt}`,
          description: `pr-review.${kind}.${attempt}`,
          input,
          issue,
          deps,
          ctx,
        });
        deps.logger?.info(
          {
            kind,
            taskId: result.task.id,
            decision: result.state.decision,
            summary: result.state.summary,
            prReviewCommentUrl: result.state.prReviewCommentUrl,
          },
          'issue_lifecycle.pr_review.accepted',
        );
        return result;
      }),
    );
    setStatusLine(statusLines, {
      key: 'pr-review',
      label: 'Agent PR reviews',
      status: 'completed',
      summary: `${reviewResults.length} reviews accepted`,
    });
    await updateStatus();

    const resolutionTask = await ctx.step(
      `task.pr-review-resolution.${attempt}.create`,
      async () => {
        const body = await buildPrReviewResolutionTask({
          input,
          issue,
          implementationTaskId: impl.task.id,
          implementationAttempt: impl.attempt,
          prNumber: linkedPrNumber,
          reviewResults: reviewResults.map((review) => ({
            taskId: review.task.id,
            attempt: review.attempt,
            kind: review.state.prReviewKind ?? 'review',
            summary: review.state.summary,
            decision: review.state.decision,
          })),
        });
        const task = await deps.tasks.createTask(body);
        logCreatedTask(deps.logger, `pr-review-resolution.${attempt}`, task);
        return task;
      },
    );
    setStatusLine(
      statusLines,
      taskStatusLine(
        'review-resolution',
        'Review resolution',
        'running',
        resolutionTask,
        'Task created',
      ),
    );
    await updateStatus();
    const resolution = await waitForLifecycleTask({
      taskId: resolutionTask.id,
      step: `pr-review-resolution.${attempt}`,
      description: `pr-review-resolution.${attempt}`,
      input,
      issue,
      deps,
      ctx,
    });
    if (resolution.state.phase !== 'pr_open' || !resolution.state.prNumber) {
      throw new Error('review resolution did not preserve a linked PR');
    }
    implementationParent = resolution;
    prNumber = resolution.state.prNumber;
    const reviewedPrNumber = prNumber;
    setStatusLine(
      statusLines,
      acceptedStatusLine('review-resolution', 'Review resolution', resolution),
    );
    await updateStatus();

    const postReviewGate = await waitForGreenPrChecks(
      input,
      reviewedPrNumber,
      deps,
      ctx,
      attempt,
    );
    if (postReviewGate === 'merged') break;
    if (postReviewGate === 'failure') {
      if (attempt === input.maxImplementationRetries) {
        throw new Error(`PR #${reviewedPrNumber} failed after retry budget`);
      }
      setStatusLine(statusLines, {
        key: 'pr',
        label: 'Pull request',
        status: 'failed',
        prNumber: reviewedPrNumber,
        prUrl: resolution.state.prUrl,
        summary:
          'Checks failed after review fixes; creating implementation retry',
      });
      await updateStatus();
      continue;
    }

    await ctx.step(`github.ready_for_review_label.${attempt}.add`, async () =>
      deps.github.addIssueLabel(
        input.repo,
        reviewedPrNumber,
        input.readyForReviewLabel,
      ),
    );
    await ensureReadyForReviewComment(
      input,
      reviewedPrNumber,
      reviewResults,
      deps,
      ctx,
    );
    setStatusLine(statusLines, {
      key: 'human-review',
      label: 'Human PR review',
      status: 'waiting',
      prNumber: reviewedPrNumber,
      prUrl: resolution.state.prUrl,
      summary: `${input.readyForReviewLabel} applied; waiting for merge`,
    });
    await updateStatus();

    const humanReview = await waitForPrMergeOrFailure({
      input,
      prNumber: reviewedPrNumber,
      deps,
      ctx,
      attempt,
    });
    if (humanReview.status === 'merged') {
      setStatusLine(statusLines, {
        key: 'human-review',
        label: 'Human PR review',
        status: 'completed',
        prNumber: reviewedPrNumber,
        prUrl: humanReview.url,
        summary: 'Merged',
      });
      await updateStatus();
      break;
    }
  }

  if (prNumber === null) throw new Error('implementation did not open a PR');

  const skipNotify = await ctx.step('github.skip_notify_label.get', async () =>
    deps.github.hasIssueLabel(
      input.repo,
      input.issueNumber,
      input.skipNotifyLabel,
    ),
  );
  deps.logger?.info(
    { skipNotify, skipNotifyLabel: input.skipNotifyLabel },
    'issue_lifecycle.notify.skip_label_checked',
  );
  const notifyTask = await ctx.step('task.notify.create', async () => {
    const body = await buildContinuationTask({
      input,
      issue,
      parentTaskId: implementationParent.task.id,
      parentAttempt: implementationParent.attempt,
      title: `Notify issue #${issue.number}`,
      brief: notifyBrief(issue, prNumber, skipNotify),
      successCriteria: lifecycleCriteria.notify(),
    });
    const task = await deps.tasks.createTask(body);
    logCreatedTask(deps.logger, 'notify', task);
    return task;
  });
  setStatusLine(
    statusLines,
    taskStatusLine(
      'notify',
      'Notify/reflection',
      'running',
      notifyTask,
      'Task created',
    ),
  );
  await updateStatus();
  const notify = await waitForLifecycleTask({
    taskId: notifyTask.id,
    step: 'notify',
    description: 'notify',
    input,
    issue,
    deps,
    ctx,
  });
  setStatusLine(
    statusLines,
    acceptedStatusLine('notify', 'Notify/reflection', notify),
  );
  await updateStatus();
  setStatusLine(statusLines, {
    key: 'done',
    label: 'Lifecycle',
    status: 'completed',
    summary: `Done for PR #${prNumber}`,
  });
  await updateStatus();
  deps.logger?.info(
    { correlationId: input.correlationId, prNumber },
    'issue_lifecycle.done',
  );

  return { status: 'done', correlationId: input.correlationId, prNumber };
}
