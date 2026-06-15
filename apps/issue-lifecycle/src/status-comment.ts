import type { normalizeLifecycleInput } from './task-factory.js';
import type { AcceptedTaskResult, SdkTask } from './types.js';

type NormalizedLifecycleInput = ReturnType<typeof normalizeLifecycleInput>;

export type LifecycleStatusValue =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed';

export interface LifecycleStatusLine {
  key: string;
  label: string;
  status: LifecycleStatusValue;
  taskId?: string;
  attemptN?: number;
  summary?: string;
  prNumber?: number;
  prUrl?: string;
}

export function approvalPromptMarker(correlationId: string): string {
  return `<!-- moltnet-issue-lifecycle:plan-approval:${correlationId} -->`;
}

export function lifecycleStatusMarker(correlationId: string): string {
  return `<!-- moltnet-issue-lifecycle:status:${correlationId} -->`;
}

export function readyForReviewMarker(correlationId: string): string {
  return `<!-- moltnet-issue-lifecycle:ready-for-review:${correlationId} -->`;
}

export function consoleCorrelationUrl(input: NormalizedLifecycleInput): string {
  const params = new URLSearchParams({ correlationId: input.correlationId });
  return `${input.consoleUrl}/tasks?${params}`;
}

function consoleTaskUrl(
  input: NormalizedLifecycleInput,
  taskId: string,
): string {
  return `${input.consoleUrl}/tasks/${taskId}`;
}

export function consoleAttemptUrl(
  input: NormalizedLifecycleInput,
  task: AcceptedTaskResult,
): string {
  return `${input.consoleUrl}/tasks/${task.task.id}/attempts/${task.attempt.attemptN}`;
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
  input: NormalizedLifecycleInput,
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

export function statusCommentBody(args: {
  input: NormalizedLifecycleInput;
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

export function setStatusLine(
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

export function taskStatusLine(
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

export function acceptedStatusLine(
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

export function approvalPromptBody(
  input: NormalizedLifecycleInput,
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

export function readyForReviewCommentBody(
  input: NormalizedLifecycleInput,
  prNumber: number,
  reviewResults: AcceptedTaskResult[],
): string {
  return [
    readyForReviewMarker(input.correlationId),
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
}
