import {
  beginWorkflowStep,
  completeWorkflowStep,
  type TaskCreateStepMetadata,
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
type CommentReconcileResult = 'created' | 'updated' | 'noop';

/** Structured-log prefix preserved across the lib extraction (#1671). */
const LOG_PREFIX = 'issue_lifecycle';

export type TaskOutcome = OrchTaskOutcome<LifecycleStateArtifact>;

function isBotComment(comment: { author?: { type: string } }): boolean {
  return comment.author?.type === 'Bot';
}

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
  metadata?: TaskCreateStepMetadata,
): void {
  logger?.info(
    {
      stage,
      taskId: task.id,
      status: task.status,
      correlationId: task.correlationId,
      claimCondition: task.claimCondition,
      stepName: metadata?.stepName,
      idempotencyKey: metadata?.idempotencyKey,
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

  const armed = await beginWorkflowStep<true>(
    ctx,
    'approval.label.removal-observed',
  );
  if (!armed.done) {
    for (;;) {
      const approved = await deps.github.hasIssueLabel(
        input.repo,
        input.issueNumber,
        input.approvalLabel,
      );
      if (!approved) {
        await completeWorkflowStep(ctx, armed, true);
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

  const accepted = await beginWorkflowStep<true>(
    ctx,
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
      await completeWorkflowStep(ctx, accepted, true);
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
  const result = await args.ctx.step<CommentReconcileResult>(
    'github.status_comment.reconcile',
    async () => {
      const comments = await args.deps.github.listIssueComments(
        args.input.repo,
        args.input.issueNumber,
      );
      const existing = comments.find(
        (comment) => isBotComment(comment) && comment.body.includes(marker),
      );
      if (!existing) {
        await args.deps.github.createIssueComment(
          args.input.repo,
          args.input.issueNumber,
          body,
        );
        return 'created';
      } else if (existing.body !== body) {
        await args.deps.github.updateIssueComment(
          args.input.repo,
          existing.id,
          body,
        );
        return 'updated';
      }
      return 'noop';
    },
  );
  args.deps.logger?.info(
    { issueNumber: args.issueNumber, result },
    'issue_lifecycle.status_comment.reconciled',
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
  const result = await ctx.step<CommentReconcileResult>(
    'github.approval_prompt.reconcile',
    async () => {
      const comments = await deps.github.listIssueComments(
        input.repo,
        input.issueNumber,
      );
      if (
        comments.some(
          (comment) => isBotComment(comment) && comment.body.includes(marker),
        )
      ) {
        return 'noop';
      }
      await deps.github.createIssueComment(
        input.repo,
        input.issueNumber,
        approvalPromptBody(input, issueNumber, latestPlan, review),
      );
      return 'created';
    },
  );
  deps.logger?.info(
    {
      issueNumber: input.issueNumber,
      approvalLabel: input.approvalLabel,
      result,
    },
    'issue_lifecycle.approval_prompt.reconciled',
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
  const result = await ctx.step<CommentReconcileResult>(
    'github.ready_for_review_comment.reconcile',
    async () => {
      const comments = await deps.github.listIssueComments(
        input.repo,
        prNumber,
      );
      const existing = comments.find(
        (comment) => isBotComment(comment) && comment.body.includes(marker),
      );
      if (existing) {
        if (existing.body !== body) {
          await deps.github.updateIssueComment(input.repo, existing.id, body);
          return 'updated';
        }
        return 'noop';
      }
      await deps.github.createIssueComment(input.repo, prNumber, body);
      return 'created';
    },
  );
  deps.logger?.info(
    { prNumber, result },
    'issue_lifecycle.ready_for_review_comment.reconciled',
  );
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
    () =>
      Promise.resolve(
        Date.now() + input.maxPrPendingPolls * input.pollIntervalSec * 1_000,
      ),
  );
  const terminal = await beginWorkflowStep<'green' | 'merged' | 'failure'>(
    ctx,
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
    if (pr.merged) return completeWorkflowStep(ctx, terminal, 'merged');
    if (pr.checks === 'success')
      return completeWorkflowStep(ctx, terminal, 'green');
    if (pr.checks === 'failure')
      return completeWorkflowStep(ctx, terminal, 'failure');
    const now = Date.now();
    if (now >= deadline) {
      deps.logger?.warn(
        {
          prNumber,
          attempt,
          deadlineIso: new Date(deadline).toISOString(),
          nowIso: new Date(now).toISOString(),
          overdueSec: Math.floor((now - deadline) / 1_000),
          pollIntervalSec: input.pollIntervalSec,
        },
        'issue_lifecycle.pr.deadline_exceeded',
      );
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
    () =>
      Promise.resolve(
        Date.now() +
          args.input.maxPrPendingPolls * args.input.pollIntervalSec * 1_000,
      ),
  );
  type MergeTerminal =
    | { status: 'merged'; url: string }
    | { status: 'checks_failed'; url: string | undefined };
  const terminal = await beginWorkflowStep<MergeTerminal>(
    args.ctx,
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
      return completeWorkflowStep(args.ctx, terminal, {
        status: 'merged',
        url: pr.url,
      });
    }
    if (pr.checks === 'failure') {
      return completeWorkflowStep(args.ctx, terminal, {
        status: 'checks_failed',
        url: pr.url,
      });
    }
    const now = Date.now();
    if (now >= deadline) {
      args.deps.logger?.warn(
        {
          prNumber: args.prNumber,
          attempt: args.attempt,
          deadlineIso: new Date(deadline).toISOString(),
          nowIso: new Date(now).toISOString(),
          overdueSec: Math.floor((now - deadline) / 1_000),
          pollIntervalSec: args.input.pollIntervalSec,
        },
        'issue_lifecycle.pr.deadline_exceeded',
      );
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
