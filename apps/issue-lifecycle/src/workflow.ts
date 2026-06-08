import { isReviewPassed, parseLifecycleStateArtifact } from './artifact.js';
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
  SdkTask,
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
  logger: IssueLifecycleDeps['logger'],
  description: string,
): Promise<AcceptedTaskResult> {
  logger?.info(
    { taskId, description, pollIntervalSec },
    'issue_lifecycle.task.wait.start',
  );
  for (;;) {
    const task = await tasks.getTask(taskId);
    logger?.info(
      {
        taskId,
        description,
        status: task.status,
        acceptedAttemptN: task.acceptedAttemptN,
      },
      'issue_lifecycle.task.wait.poll',
    );
    if (task.status === 'failed' || task.status === 'cancelled') {
      logger?.error(
        { taskId, description, status: task.status },
        'issue_lifecycle.task.wait.terminal_failure',
      );
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
      logger?.info(
        {
          taskId,
          description,
          acceptedAttemptN: task.acceptedAttemptN,
          outputCid: attempt.outputCid,
        },
        'issue_lifecycle.task.wait.accepted',
      );
      return {
        task,
        attempt,
        state: parseLifecycleStateArtifact(attempt.output),
      };
    }
    await ctx.sleepFor(`wait-task:${taskId}`, pollIntervalSec);
  }
}

function logCreatedTask(
  logger: IssueLifecycleDeps['logger'],
  stage: string,
  task: Awaited<ReturnType<TaskClient['createTask']>>,
): void {
  logger?.info(
    {
      stage,
      taskId: task.id,
      status: task.status,
      correlationId: task.correlationId,
      claimCondition: task.claimCondition,
    },
    'issue_lifecycle.task.created',
  );
}

async function waitForApprovalLabel(
  input: ReturnType<typeof normalizeLifecycleInput>,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
): Promise<void> {
  let observedLabelAbsent = false;
  deps.logger?.info(
    `waiting for issue ${input.repo}#${input.issueNumber} approval label "${input.approvalLabel}"`,
  );
  for (;;) {
    const approved = await deps.github.hasIssueLabel(
      input.repo,
      input.issueNumber,
      input.approvalLabel,
    );
    if (approved && observedLabelAbsent) {
      deps.logger?.info(
        `approval label "${input.approvalLabel}" detected on ${input.repo}#${input.issueNumber}`,
      );
      return;
    }
    if (approved) {
      deps.logger?.warn(
        `approval label "${input.approvalLabel}" was already present on ${input.repo}#${input.issueNumber}; remove it and add it again after reviewing the current approval prompt`,
      );
    } else {
      observedLabelAbsent = true;
      deps.logger?.info(
        `approval label "${input.approvalLabel}" not present on ${input.repo}#${input.issueNumber}; sleeping ${input.pollIntervalSec}s`,
      );
    }
    await ctx.sleepFor('wait-plan-approval-label', input.pollIntervalSec);
  }
}

function approvalPromptMarker(correlationId: string): string {
  return `<!-- moltnet-issue-lifecycle:plan-approval:${correlationId} -->`;
}

function lifecycleStatusMarker(correlationId: string): string {
  return `<!-- moltnet-issue-lifecycle:status:${correlationId} -->`;
}

function readyForReviewMarker(correlationId: string): string {
  return `<!-- moltnet-issue-lifecycle:ready-for-review:${correlationId} -->`;
}

function consoleCorrelationUrl(
  input: ReturnType<typeof normalizeLifecycleInput>,
): string {
  const params = new URLSearchParams({ correlationId: input.correlationId });
  return `${input.consoleUrl}/tasks?${params}`;
}

function consoleTaskUrl(
  input: ReturnType<typeof normalizeLifecycleInput>,
  taskId: string,
): string {
  return `${input.consoleUrl}/tasks/${taskId}`;
}

function consoleAttemptUrl(
  input: ReturnType<typeof normalizeLifecycleInput>,
  task: AcceptedTaskResult,
): string {
  return `${input.consoleUrl}/tasks/${task.task.id}/attempts/${task.attempt.attemptN}`;
}

type LifecycleStatusValue =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed';

interface LifecycleStatusLine {
  key: string;
  label: string;
  status: LifecycleStatusValue;
  taskId?: string;
  attemptN?: number;
  summary?: string;
  prNumber?: number;
  prUrl?: string;
}

function escapeTableCell(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function statusLabel(status: LifecycleStatusValue): string {
  switch (status) {
    case 'pending':
      return 'pending';
    case 'running':
      return 'running';
    case 'waiting':
      return 'waiting';
    case 'completed':
      return 'completed';
    case 'failed':
      return 'failed';
  }
}

function statusTaskLink(
  input: ReturnType<typeof normalizeLifecycleInput>,
  line: LifecycleStatusLine,
): string {
  if (!line.taskId) return '';
  const label = line.attemptN
    ? `${line.taskId} attempt ${line.attemptN}`
    : line.taskId;
  const url = line.attemptN
    ? `${input.consoleUrl}/tasks/${line.taskId}/attempts/${line.attemptN}`
    : consoleTaskUrl(input, line.taskId);
  return `[${label}](${url})`;
}

function statusCommentBody(args: {
  input: ReturnType<typeof normalizeLifecycleInput>;
  issueNumber: number;
  lines: LifecycleStatusLine[];
}): string {
  const rows = args.lines.map((line) => {
    const detail =
      line.prUrl && line.prNumber
        ? `[PR #${line.prNumber}](${line.prUrl})`
        : statusTaskLink(args.input, line);
    return [
      escapeTableCell(line.label),
      statusLabel(line.status),
      escapeTableCell(detail),
      escapeTableCell(line.summary ?? ''),
    ].join(' | ');
  });
  return [
    lifecycleStatusMarker(args.input.correlationId),
    '## MoltNet Issue Lifecycle: Status',
    '',
    `Issue: #${args.issueNumber}`,
    `Correlation: \`${args.input.correlationId}\``,
    `Console task chain: [open related tasks](${consoleCorrelationUrl(args.input)})`,
    '',
    '| Step | Status | Link | Note |',
    '| --- | --- | --- | --- |',
    ...rows,
  ].join('\n');
}

function setStatusLine(
  lines: LifecycleStatusLine[],
  line: LifecycleStatusLine,
): void {
  const index = lines.findIndex((candidate) => candidate.key === line.key);
  if (index === -1) {
    lines.push(line);
    return;
  }
  lines[index] = { ...lines[index], ...line };
}

function taskStatusLine(
  key: string,
  label: string,
  status: LifecycleStatusValue,
  task: SdkTask,
  summary?: string,
): LifecycleStatusLine {
  return {
    key,
    label,
    status,
    taskId: task.id,
    attemptN:
      task.acceptedAttemptN === null ? undefined : task.acceptedAttemptN,
    summary,
  };
}

function acceptedStatusLine(
  key: string,
  label: string,
  result: AcceptedTaskResult,
): LifecycleStatusLine {
  return {
    key,
    label,
    status: 'completed',
    taskId: result.task.id,
    attemptN: result.attempt.attemptN,
    summary: result.state.summary,
  };
}

async function updateLifecycleStatusComment(args: {
  input: ReturnType<typeof normalizeLifecycleInput>;
  issueNumber: number;
  lines: LifecycleStatusLine[];
  deps: IssueLifecycleDeps;
}): Promise<void> {
  const marker = lifecycleStatusMarker(args.input.correlationId);
  const body = statusCommentBody(args);
  const comments = await args.deps.github.listIssueComments(
    args.input.repo,
    args.input.issueNumber,
  );
  const existing = comments.find((comment) => comment.body.includes(marker));
  if (!existing) {
    await args.deps.github.createIssueComment(
      args.input.repo,
      args.input.issueNumber,
      body,
    );
    return;
  }
  if (existing.body === body) return;
  await args.deps.github.updateIssueComment(args.input.repo, existing.id, body);
}

function approvalPromptBody(
  input: ReturnType<typeof normalizeLifecycleInput>,
  issueNumber: number,
  latestPlan: AcceptedTaskResult,
  review: AcceptedTaskResult,
): string {
  const plan = latestPlan.state.plan ?? latestPlan.state.summary;
  const reviewedSummary =
    review.state.reviewedPlanSummary ?? review.state.summary;
  return [
    approvalPromptMarker(input.correlationId),
    `## MoltNet Issue Lifecycle: Plan Ready`,
    '',
    `The generated plan for issue #${issueNumber} passed review and is waiting for human approval.`,
    '',
    `Add the \`${input.approvalLabel}\` label to this issue to let the lifecycle create the implementation task.`,
    '',
    `Correlation: \`${input.correlationId}\``,
    `Console task chain: [open related tasks](${consoleCorrelationUrl(input)})`,
    `Plan task: [\`${latestPlan.task.id}\` attempt ${latestPlan.attempt.attemptN}](${consoleAttemptUrl(input, latestPlan)})`,
    `Review task: [\`${review.task.id}\` attempt ${review.attempt.attemptN}](${consoleAttemptUrl(input, review)})`,
    '',
    `Approved plan:`,
    '',
    plan,
    '',
    `Reviewed plan summary:`,
    '',
    reviewedSummary,
  ].join('\n');
}

async function ensureApprovalPromptComment(
  input: ReturnType<typeof normalizeLifecycleInput>,
  issueNumber: number,
  latestPlan: AcceptedTaskResult,
  review: AcceptedTaskResult,
  deps: IssueLifecycleDeps,
): Promise<void> {
  const marker = approvalPromptMarker(input.correlationId);
  const comments = await deps.github.listIssueComments(
    input.repo,
    input.issueNumber,
  );
  if (comments.some((comment) => comment.body.includes(marker))) {
    deps.logger?.info(
      `approval prompt already exists for ${input.repo}#${input.issueNumber} correlation ${input.correlationId}`,
    );
    return;
  }

  await deps.github.createIssueComment(
    input.repo,
    input.issueNumber,
    approvalPromptBody(input, issueNumber, latestPlan, review),
  );
  deps.logger?.info(
    `posted approval prompt on ${input.repo}#${input.issueNumber} for label "${input.approvalLabel}"`,
  );
}

async function ensureReadyForReviewComment(
  input: ReturnType<typeof normalizeLifecycleInput>,
  prNumber: number,
  reviewResults: AcceptedTaskResult[],
  deps: IssueLifecycleDeps,
): Promise<void> {
  const marker = readyForReviewMarker(input.correlationId);
  const body = [
    marker,
    '## MoltNet Issue Lifecycle: Ready For Human Review',
    '',
    `PR: #${prNumber}`,
    `Correlation: \`${input.correlationId}\``,
    `Console task chain: [open related tasks](${consoleCorrelationUrl(input)})`,
    '',
    'CI is green and the agent PR reviews plus review-resolution pass are complete.',
    `The runner added the \`${input.readyForReviewLabel}\` label to mark the PR as ready for human review.`,
    '',
    '| Review | Task | Decision | Summary |',
    '| --- | --- | --- | --- |',
    ...reviewResults.map((review) =>
      [
        escapeTableCell(review.state.prReviewKind ?? 'review'),
        statusTaskLink(input, {
          key: review.task.id,
          label: review.task.id,
          status: 'completed',
          taskId: review.task.id,
          attemptN: review.attempt.attemptN,
        }),
        escapeTableCell(review.state.decision),
        escapeTableCell(review.state.summary),
      ].join(' | '),
    ),
  ].join('\n');
  const comments = await deps.github.listIssueComments(input.repo, prNumber);
  const existing = comments.find((comment) => comment.body.includes(marker));
  if (existing) {
    await deps.github.updateIssueComment(input.repo, existing.id, body);
    return;
  }
  await deps.github.createIssueComment(input.repo, prNumber, body);
}

async function waitForGreenPrChecks(
  input: ReturnType<typeof normalizeLifecycleInput>,
  prNumber: number,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
  attempt: number,
): Promise<'green' | 'merged' | 'failure'> {
  for (;;) {
    const pr = await deps.github.getPullRequest(input.repo, prNumber);
    deps.logger?.info(
      {
        prNumber,
        merged: pr.merged,
        checks: pr.checks,
        attempt,
      },
      'issue_lifecycle.pr.poll',
    );
    if (pr.merged) return 'merged';
    if (pr.checks === 'success') return 'green';
    if (pr.checks === 'failure') return 'failure';
    await ctx.sleepFor(`wait-pr:${prNumber}`, input.pollIntervalSec);
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
  const triage = await waitForAcceptedTask(
    triageTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
    deps.logger,
    'triage',
  );
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
  let latestPlan = await waitForAcceptedTask(
    planTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
    deps.logger,
    'plan',
  );
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
    const review = await waitForAcceptedTask(
      reviewTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
      deps.logger,
      `plan-review.${round}`,
    );
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
    latestPlan = await waitForAcceptedTask(
      revisionTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
      deps.logger,
      `plan-revision.${round}`,
    );
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

  await ctx.step('approval.prompt.ensure', () =>
    ensureApprovalPromptComment(
      input,
      issue.number,
      latestPlan,
      approvedReview,
      deps,
    ),
  );
  setStatusLine(statusLines, {
    key: 'approval',
    label: 'Human approval',
    status: 'waiting',
    summary: `Waiting for ${input.approvalLabel}`,
  });
  await updateStatus();

  await ctx.step('approval.label.wait', () =>
    waitForApprovalLabel(input, deps, ctx),
  );
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
    const impl = await waitForAcceptedTask(
      implTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
      deps.logger,
      `implement.${attempt}`,
    );
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
        const result = await waitForAcceptedTask(
          task.id,
          deps.tasks,
          ctx,
          input.pollIntervalSec,
          deps.logger,
          `pr-review.${kind}.${attempt}`,
        );
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
    const resolution = await waitForAcceptedTask(
      resolutionTask.id,
      deps.tasks,
      ctx,
      input.pollIntervalSec,
      deps.logger,
      `pr-review-resolution.${attempt}`,
    );
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

    await ctx.step(`ready-for-review.${attempt}.ensure`, async () => {
      await deps.github.addIssueLabel(
        input.repo,
        reviewedPrNumber,
        input.readyForReviewLabel,
      );
      await ensureReadyForReviewComment(
        input,
        reviewedPrNumber,
        reviewResults,
        deps,
      );
    });
    setStatusLine(statusLines, {
      key: 'human-review',
      label: 'Human PR review',
      status: 'waiting',
      prNumber: reviewedPrNumber,
      prUrl: resolution.state.prUrl,
      summary: `${input.readyForReviewLabel} applied; waiting for merge`,
    });
    await updateStatus();

    let humanReviewMerged = false;
    for (;;) {
      const pr = await deps.github.getPullRequest(input.repo, reviewedPrNumber);
      deps.logger?.info(
        {
          prNumber: linkedPrNumber,
          merged: pr.merged,
          checks: pr.checks,
          attempt,
        },
        'issue_lifecycle.pr.human_review_poll',
      );
      if (pr.merged) {
        deps.logger?.info(
          { prNumber: reviewedPrNumber },
          'issue_lifecycle.pr.merged',
        );
        setStatusLine(statusLines, {
          key: 'human-review',
          label: 'Human PR review',
          status: 'completed',
          prNumber: reviewedPrNumber,
          prUrl: pr.url,
          summary: 'Merged',
        });
        await updateStatus();
        humanReviewMerged = true;
        break;
      }
      if (pr.checks === 'failure') break;
      await ctx.sleepFor(
        `wait-pr-merge:${reviewedPrNumber}`,
        input.pollIntervalSec,
      );
    }

    if (humanReviewMerged) break;
  }

  if (prNumber === null) throw new Error('implementation did not open a PR');

  const skipNotify = await deps.github.hasIssueLabel(
    input.repo,
    input.issueNumber,
    input.skipNotifyLabel,
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
  const notify = await waitForAcceptedTask(
    notifyTask.id,
    deps.tasks,
    ctx,
    input.pollIntervalSec,
    deps.logger,
    'notify',
  );
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
