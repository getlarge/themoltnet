import {
  type TaskOutcome as OrchTaskOutcome,
  waitForAcceptedTask as waitForAcceptedTaskGeneric,
  waitForSignalOrSleep,
  waitForTaskOutcome as waitForTaskOutcomeGeneric,
} from '@themoltnet/tasks-orchestrator';

import { parseLifecycleStateArtifact } from './artifact.js';
import {
  approvalPromptBody,
  approvalPromptMarker,
  type LifecycleStatusLine,
  lifecycleStatusMarker,
  readyForReviewCommentBody,
  readyForReviewMarker,
  statusCommentBody,
} from './status-comment.js';
import type { normalizeLifecycleInput } from './task-factory.js';
import type {
  AcceptedTaskResult,
  IssueLifecycleDeps,
  LifecycleStateArtifact,
  TaskClient,
  WorkflowContext,
} from './types.js';

type NormalizedLifecycleInput = ReturnType<typeof normalizeLifecycleInput>;

/** Structured-log prefix preserved across the lib extraction (#1671). */
const LOG_PREFIX = 'issue_lifecycle';

export type TaskOutcome = OrchTaskOutcome<LifecycleStateArtifact>;

/**
 * Lifecycle-specialized wrappers over the generic orchestration await engine:
 * they inject the lifecycle artifact parser and preserve the `issue_lifecycle.*`
 * log event names.
 */
export function waitForTaskOutcome(
  taskId: string,
  tasks: TaskClient,
  ctx: WorkflowContext,
  pollIntervalSec: number,
  logger: IssueLifecycleDeps['logger'],
  description: string,
): Promise<TaskOutcome> {
  return waitForTaskOutcomeGeneric(taskId, {
    tasks,
    ctx,
    pollIntervalSec,
    parse: parseLifecycleStateArtifact,
    logger,
    description,
    logPrefix: LOG_PREFIX,
  });
}

export function waitForAcceptedTask(
  taskId: string,
  tasks: TaskClient,
  ctx: WorkflowContext,
  pollIntervalSec: number,
  logger: IssueLifecycleDeps['logger'],
  description: string,
): Promise<AcceptedTaskResult> {
  return waitForAcceptedTaskGeneric(taskId, {
    tasks,
    ctx,
    pollIntervalSec,
    parse: parseLifecycleStateArtifact,
    logger,
    description,
    logPrefix: LOG_PREFIX,
  });
}

export function logCreatedTask(
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

export async function waitForApprovalLabel(
  input: NormalizedLifecycleInput,
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
      await ctx.sleepFor('wait-plan-approval-label', input.pollIntervalSec);
      continue;
    } else {
      observedLabelAbsent = true;
      deps.logger?.info(
        `approval label "${input.approvalLabel}" not present on ${input.repo}#${input.issueNumber}; sleeping ${input.pollIntervalSec}s`,
      );
    }
    await waitForSignalOrSleep({
      ctx,
      eventName: `github.issue.label:${input.repo}:${input.issueNumber}:${input.approvalLabel}`,
      stepName: 'wait-plan-approval-label',
      seconds: input.pollIntervalSec,
      logger: deps.logger,
      logPrefix: LOG_PREFIX,
      description: 'plan approval label',
    });
  }
}

export async function updateLifecycleStatusComment(args: {
  input: NormalizedLifecycleInput;
  issueNumber: number;
  lines: LifecycleStatusLine[];
  deps: IssueLifecycleDeps;
  ctx: WorkflowContext;
}): Promise<void> {
  const marker = lifecycleStatusMarker(args.input.correlationId);
  const body = statusCommentBody(args);
  const comments = await args.ctx.step('github.status_comment.list', async () =>
    args.deps.github.listIssueComments(args.input.repo, args.input.issueNumber),
  );
  const existing = comments.find((comment) => comment.body.includes(marker));
  if (!existing) {
    await args.ctx.step('github.status_comment.create', async () =>
      args.deps.github.createIssueComment(
        args.input.repo,
        args.input.issueNumber,
        body,
      ),
    );
    return;
  }
  if (existing.body === body) return;
  await args.ctx.step('github.status_comment.update', async () =>
    args.deps.github.updateIssueComment(args.input.repo, existing.id, body),
  );
}

export async function ensureApprovalPromptComment(
  input: NormalizedLifecycleInput,
  issueNumber: number,
  latestPlan: AcceptedTaskResult,
  review: AcceptedTaskResult,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
): Promise<void> {
  const marker = approvalPromptMarker(input.correlationId);
  const comments = await ctx.step('github.approval_prompt.list', async () =>
    deps.github.listIssueComments(input.repo, input.issueNumber),
  );
  if (comments.some((comment) => comment.body.includes(marker))) {
    deps.logger?.info(
      `approval prompt already exists for ${input.repo}#${input.issueNumber} correlation ${input.correlationId}`,
    );
    return;
  }

  await ctx.step('github.approval_prompt.create', async () =>
    deps.github.createIssueComment(
      input.repo,
      input.issueNumber,
      approvalPromptBody(input, issueNumber, latestPlan, review),
    ),
  );
  deps.logger?.info(
    `posted approval prompt on ${input.repo}#${input.issueNumber} for label "${input.approvalLabel}"`,
  );
}

export async function ensureReadyForReviewComment(
  input: NormalizedLifecycleInput,
  prNumber: number,
  reviewResults: AcceptedTaskResult[],
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
): Promise<void> {
  const marker = readyForReviewMarker(input.correlationId);
  const body = readyForReviewCommentBody(input, prNumber, reviewResults);
  const comments = await ctx.step(
    'github.ready_for_review_comment.list',
    async () => deps.github.listIssueComments(input.repo, prNumber),
  );
  const existing = comments.find((comment) => comment.body.includes(marker));
  if (existing) {
    await ctx.step('github.ready_for_review_comment.update', async () =>
      deps.github.updateIssueComment(input.repo, existing.id, body),
    );
    return;
  }
  await ctx.step('github.ready_for_review_comment.create', async () =>
    deps.github.createIssueComment(input.repo, prNumber, body),
  );
}

export async function waitForGreenPrChecks(
  input: NormalizedLifecycleInput,
  prNumber: number,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
  attempt: number,
): Promise<'green' | 'merged' | 'failure'> {
  let pendingPolls = 0;
  for (;;) {
    const pr = await deps.github.getPullRequest(input.repo, prNumber);
    deps.logger?.info(
      {
        prNumber,
        merged: pr.merged,
        checks: pr.checks,
        attempt,
        pendingPolls,
        maxPrPendingPolls: input.maxPrPendingPolls,
      },
      'issue_lifecycle.pr.poll',
    );
    if (pr.merged) return 'merged';
    if (pr.checks === 'success') return 'green';
    if (pr.checks === 'failure') return 'failure';
    pendingPolls += 1;
    if (pendingPolls >= input.maxPrPendingPolls) {
      throw new Error(
        `PR #${prNumber} checks stayed pending for ${pendingPolls} polls`,
      );
    }
    await waitForSignalOrSleep({
      ctx,
      eventName: `github.pr.updated:${input.repo}:${prNumber}`,
      stepName: `wait-pr:${prNumber}`,
      seconds: input.pollIntervalSec,
      logger: deps.logger,
      logPrefix: LOG_PREFIX,
      description: `PR #${prNumber} checks`,
    });
  }
}

export async function waitForPrMergeOrFailure(args: {
  input: NormalizedLifecycleInput;
  prNumber: number;
  deps: IssueLifecycleDeps;
  ctx: WorkflowContext;
  attempt: number;
}): Promise<
  | { status: 'merged'; url: string }
  | { status: 'checks_failed'; url: string | undefined }
> {
  let pendingPolls = 0;
  for (;;) {
    const pr = await args.ctx.step(
      `github.pr.human_review.${args.prNumber}.get`,
      async () =>
        args.deps.github.getPullRequest(args.input.repo, args.prNumber),
    );
    args.deps.logger?.info(
      {
        prNumber: args.prNumber,
        merged: pr.merged,
        checks: pr.checks,
        attempt: args.attempt,
        pendingPolls,
        maxPrPendingPolls: args.input.maxPrPendingPolls,
      },
      'issue_lifecycle.pr.human_review_poll',
    );
    if (pr.merged) {
      args.deps.logger?.info(
        { prNumber: args.prNumber },
        'issue_lifecycle.pr.merged',
      );
      return { status: 'merged', url: pr.url };
    }
    if (pr.checks === 'failure') {
      return { status: 'checks_failed', url: pr.url };
    }
    pendingPolls += 1;
    if (pendingPolls >= args.input.maxPrPendingPolls) {
      throw new Error(
        `PR #${args.prNumber} merge wait stayed pending for ${pendingPolls} polls`,
      );
    }
    await waitForSignalOrSleep({
      ctx: args.ctx,
      eventName: `github.pr.updated:${args.input.repo}:${args.prNumber}`,
      stepName: `wait-pr-merge:${args.prNumber}`,
      seconds: args.input.pollIntervalSec,
      logger: args.deps.logger,
      logPrefix: LOG_PREFIX,
      description: `PR #${args.prNumber} merge`,
    });
  }
}

export function reviewFindingsForRevision(
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
