import {
  type TaskOutcome as OrchTaskOutcome,
  waitForAcceptedTask as waitForAcceptedTaskGeneric,
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
  deps.logger?.info(
    `waiting for issue ${input.repo}#${input.issueNumber} approval label "${input.approvalLabel}"`,
  );

  const armed = await ctx.beginStep<true>('approval.label.removal-observed');
  if (!armed.done) {
    for (;;) {
      const approved = await deps.github.hasIssueLabel(
        input.repo,
        input.issueNumber,
        input.approvalLabel,
      );
      if (!approved) {
        await ctx.completeStep(armed, true);
        break;
      }
      deps.logger?.warn(
        `approval label "${input.approvalLabel}" was already present on ${input.repo}#${input.issueNumber}; remove it and add it again after reviewing the current approval prompt`,
      );
      await ctx.sleepFor(
        'wait-plan-approval-label-removal',
        input.pollIntervalSec,
      );
    }
  }

  const accepted = await ctx.beginStep<true>(
    'approval.label.addition-observed',
  );
  if (accepted.done) return;
  for (;;) {
    const approved = await deps.github.hasIssueLabel(
      input.repo,
      input.issueNumber,
      input.approvalLabel,
    );
    if (approved) {
      deps.logger?.info(
        `approval label "${input.approvalLabel}" detected on ${input.repo}#${input.issueNumber}`,
      );
      await ctx.completeStep(accepted, true);
      return;
    }
    deps.logger?.info(
      `approval label "${input.approvalLabel}" not present on ${input.repo}#${input.issueNumber}; sleeping ${input.pollIntervalSec}s`,
    );
    await ctx.sleepFor(
      'wait-plan-approval-label-addition',
      input.pollIntervalSec,
    );
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
  await args.ctx.step('github.status_comment.reconcile', async () => {
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
    } else if (existing.body !== body) {
      await args.deps.github.updateIssueComment(
        args.input.repo,
        existing.id,
        body,
      );
    }
  });
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
  await ctx.step('github.approval_prompt.reconcile', async () => {
    const comments = await deps.github.listIssueComments(
      input.repo,
      input.issueNumber,
    );
    if (comments.some((comment) => comment.body.includes(marker))) return;
    await deps.github.createIssueComment(
      input.repo,
      input.issueNumber,
      approvalPromptBody(input, issueNumber, latestPlan, review),
    );
  });
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
  await ctx.step('github.ready_for_review_comment.reconcile', async () => {
    const comments = await deps.github.listIssueComments(input.repo, prNumber);
    const existing = comments.find((comment) => comment.body.includes(marker));
    if (existing) {
      if (existing.body !== body) {
        await deps.github.updateIssueComment(input.repo, existing.id, body);
      }
      return;
    }
    await deps.github.createIssueComment(input.repo, prNumber, body);
  });
}

export async function waitForGreenPrChecks(
  input: NormalizedLifecycleInput,
  prNumber: number,
  deps: IssueLifecycleDeps,
  ctx: WorkflowContext,
  attempt: number,
): Promise<'green' | 'merged' | 'failure'> {
  const deadline = await ctx.step(
    `pr-gate.${prNumber}.${attempt}.deadline`,
    async () =>
      Date.now() + input.maxPrPendingPolls * input.pollIntervalSec * 1_000,
  );
  const terminal = await ctx.beginStep<'green' | 'merged' | 'failure'>(
    `pr-gate.${prNumber}.${attempt}.terminal`,
  );
  if (terminal.done) return terminal.state;
  for (;;) {
    const pr = await deps.github.getPullRequest(input.repo, prNumber);
    deps.logger?.info(
      {
        prNumber,
        merged: pr.merged,
        checks: pr.checks,
        attempt,
        deadline,
      },
      'issue_lifecycle.pr.poll',
    );
    if (pr.merged) return ctx.completeStep(terminal, 'merged');
    if (pr.checks === 'success') return ctx.completeStep(terminal, 'green');
    if (pr.checks === 'failure') return ctx.completeStep(terminal, 'failure');
    if (Date.now() >= deadline) {
      throw new Error(`PR #${prNumber} checks exceeded its durable deadline`);
    }
    await ctx.sleepFor(`wait-pr:${prNumber}`, input.pollIntervalSec);
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
  const deadline = await args.ctx.step(
    `pr-merge.${args.prNumber}.${args.attempt}.deadline`,
    async () =>
      Date.now() +
      args.input.maxPrPendingPolls * args.input.pollIntervalSec * 1_000,
  );
  type MergeTerminal =
    | { status: 'merged'; url: string }
    | { status: 'checks_failed'; url: string | undefined };
  const terminal = await args.ctx.beginStep<MergeTerminal>(
    `pr-merge.${args.prNumber}.${args.attempt}.terminal`,
  );
  if (terminal.done) return terminal.state;
  for (;;) {
    const pr = await args.deps.github.getPullRequest(
      args.input.repo,
      args.prNumber,
    );
    args.deps.logger?.info(
      {
        prNumber: args.prNumber,
        merged: pr.merged,
        checks: pr.checks,
        attempt: args.attempt,
        deadline,
      },
      'issue_lifecycle.pr.human_review_poll',
    );
    if (pr.merged) {
      args.deps.logger?.info(
        { prNumber: args.prNumber },
        'issue_lifecycle.pr.merged',
      );
      return args.ctx.completeStep(terminal, {
        status: 'merged',
        url: pr.url,
      });
    }
    if (pr.checks === 'failure') {
      return args.ctx.completeStep(terminal, {
        status: 'checks_failed',
        url: pr.url,
      });
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `PR #${args.prNumber} merge wait exceeded its durable deadline`,
      );
    }
    await args.ctx.sleepFor(
      `wait-pr-merge:${args.prNumber}`,
      args.input.pollIntervalSec,
    );
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
