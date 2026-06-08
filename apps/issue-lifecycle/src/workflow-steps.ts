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
  TaskClient,
  WorkflowContext,
} from './types.js';

type NormalizedLifecycleInput = ReturnType<typeof normalizeLifecycleInput>;

function isTimeoutError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.constructor.name === 'TimeoutError')
  );
}

async function waitForSignalOrSleep(args: {
  ctx: WorkflowContext;
  eventName: string;
  stepName: string;
  seconds: number;
  logger: IssueLifecycleDeps['logger'];
  description: string;
}): Promise<void> {
  if (!args.ctx.awaitEvent) {
    await args.ctx.sleepFor(args.stepName, args.seconds);
    return;
  }
  try {
    args.logger?.info(
      {
        eventName: args.eventName,
        stepName: args.stepName,
        timeoutSec: args.seconds,
        description: args.description,
      },
      'issue_lifecycle.wait.event.start',
    );
    await args.ctx.awaitEvent(args.eventName, {
      stepName: args.stepName,
      timeout: args.seconds,
    });
    args.logger?.info(
      { eventName: args.eventName, description: args.description },
      'issue_lifecycle.wait.event.received',
    );
  } catch (error) {
    if (isTimeoutError(error)) {
      args.logger?.info(
        { eventName: args.eventName, description: args.description },
        'issue_lifecycle.wait.event.timeout',
      );
      return;
    }
    throw error;
  }
}

export async function waitForAcceptedTask(
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
    await waitForSignalOrSleep({
      ctx,
      eventName: `moltnet.task.updated:${taskId}`,
      stepName: `wait-task:${taskId}`,
      seconds: pollIntervalSec,
      logger,
      description,
    });
  }
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
    await waitForSignalOrSleep({
      ctx,
      eventName: `github.pr.updated:${input.repo}:${prNumber}`,
      stepName: `wait-pr:${prNumber}`,
      seconds: input.pollIntervalSec,
      logger: deps.logger,
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
    await waitForSignalOrSleep({
      ctx: args.ctx,
      eventName: `github.pr.updated:${args.input.repo}:${args.prNumber}`,
      stepName: `wait-pr-merge:${args.prNumber}`,
      seconds: args.input.pollIntervalSec,
      logger: args.deps.logger,
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
