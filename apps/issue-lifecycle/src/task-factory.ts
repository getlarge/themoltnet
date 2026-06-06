import { randomUUID } from 'node:crypto';

import type {
  GithubIssue,
  IssueLifecycleInput,
  SdkTaskAttempt,
  TaskClient,
} from './types.js';

const DEFAULT_APPROVAL_LABEL = 'moltnet:plan-approved';
const DEFAULT_SKIP_NOTIFY_LABEL = 'moltnet:skip-notify';

export interface LifecycleDefaults {
  correlationId: string;
  approvalLabel: string;
  skipNotifyLabel: string;
  pollIntervalSec: number;
  maxReviewRounds: number;
  maxImplementationRetries: number;
}

export function normalizeLifecycleInput(
  input: IssueLifecycleInput,
): IssueLifecycleInput & LifecycleDefaults {
  return {
    ...input,
    correlationId: input.correlationId ?? randomUUID(),
    approvalLabel: input.approvalLabel ?? DEFAULT_APPROVAL_LABEL,
    skipNotifyLabel: input.skipNotifyLabel ?? DEFAULT_SKIP_NOTIFY_LABEL,
    pollIntervalSec: input.pollIntervalSec ?? 30,
    maxReviewRounds: input.maxReviewRounds ?? 5,
    maxImplementationRetries: input.maxImplementationRetries ?? 3,
  };
}

function issueReference(issue: GithubIssue) {
  return {
    taskId: null,
    outputCid: `gh:issue:${issue.number}`,
    role: 'context' as const,
    external: {
      kind: 'github_issue' as const,
      issue: issue.number,
    },
  };
}

function taskReference(taskId: string, attempt: SdkTaskAttempt) {
  return {
    taskId,
    outputCid:
      attempt.outputCid ?? `task:${taskId}:attempt:${attempt.attemptN}`,
    role: 'context' as const,
  };
}

function baseBody(
  input: IssueLifecycleInput & LifecycleDefaults,
  title: string,
  brief: string,
  issue: GithubIssue,
) {
  return {
    taskType: 'freeform',
    title,
    teamId: input.teamId,
    diaryId: input.diaryId,
    correlationId: input.correlationId,
    input: {
      brief,
      expectedOutput:
        'Return normal freeform output plus an artifact with kind issue_lifecycle_state and a JSON body.',
      suggestedTaskType: 'github_issue_lifecycle',
      successCriteria: { version: 1 },
    },
    references: [issueReference(issue)],
    ...(input.allowedExecutors
      ? { allowedExecutors: input.allowedExecutors }
      : {}),
    ...(input.requiredExecutorTrustLevel
      ? { requiredExecutorTrustLevel: input.requiredExecutorTrustLevel }
      : {}),
  } satisfies Parameters<TaskClient['createTask']>[0];
}

export function buildTriageTask(
  input: IssueLifecycleInput & LifecycleDefaults,
  issue: GithubIssue,
): Parameters<TaskClient['createTask']>[0] {
  const brief = [
    `Triage GitHub issue ${input.repo}#${issue.number}: ${issue.title}`,
    '',
    issue.body || '_No issue body provided._',
    '',
    'Read repository instructions, design docs, and relevant skills before classifying.',
    'Classify the issue with useful tags such as feature, security, docs, or bug.',
    'If the issue is planning-ready, emit phase "classified" and decision "plan".',
    'If it needs clarification, emit phase "classified" and decision "needs_triage" with a concise summary.',
    '',
    'Required artifact body shape:',
    '{"phase":"classified","decision":"plan","summary":"..."}',
  ].join('\n');

  return {
    ...baseBody(input, `Triage issue #${issue.number}`, brief, issue),
    input: {
      ...baseBody(input, `Triage issue #${issue.number}`, brief, issue).input,
      execution: { workspace: 'dedicated_worktree' },
    },
  };
}

export function buildContinuationTask(args: {
  input: IssueLifecycleInput & LifecycleDefaults;
  issue: GithubIssue;
  parentTaskId: string;
  parentAttempt: SdkTaskAttempt;
  title: string;
  brief: string;
}): Parameters<TaskClient['createTask']>[0] {
  return {
    ...baseBody(args.input, args.title, args.brief, args.issue),
    input: {
      ...baseBody(args.input, args.title, args.brief, args.issue).input,
      continueFrom: {
        taskId: args.parentTaskId,
        attemptN: args.parentAttempt.attemptN,
        mode: 'extend',
      },
    },
    references: [
      issueReference(args.issue),
      taskReference(args.parentTaskId, args.parentAttempt),
    ],
    claimCondition: {
      op: 'task_status',
      taskId: args.parentTaskId,
      statuses: ['completed'],
    },
  };
}

export function planBrief(issue: GithubIssue): string {
  return [
    `Generate an implementation plan for issue #${issue.number}: ${issue.title}.`,
    'Use the current session and worktree context from triage.',
    'Do not implement yet.',
    'Produce a concrete plan with risks, tests, and acceptance criteria.',
    'Required artifact body shape:',
    '{"phase":"plan_generated","decision":"ready_for_review","summary":"...","plan":"..."}',
  ].join('\n');
}

export function reviewBrief(): string {
  return [
    'Review the current plan critically.',
    'If it is ready for human approval, emit decision "review_passed" and no findings.',
    'If it needs work, emit decision "findings" and include findings[].',
    'Do not implement code.',
    'Required artifact body shape:',
    '{"phase":"plan_generated","decision":"review_passed","summary":"...","findings":[]}',
  ].join('\n');
}

export function revisePlanBrief(findings: string[]): string {
  return [
    'Revise the implementation plan to resolve the review findings below.',
    '',
    ...findings.map((finding) => `- ${finding}`),
    '',
    'Do not implement yet.',
    'Required artifact body shape:',
    '{"phase":"plan_generated","decision":"ready_for_review","summary":"...","plan":"..."}',
  ].join('\n');
}

export function implementationBrief(issue: GithubIssue): string {
  return [
    `Implement the approved plan for issue #${issue.number}: ${issue.title}.`,
    'Stay within repository instructions and LeGreffier accountable commit workflow.',
    'Open or link the PR when done.',
    'Required artifact body shape:',
    '{"phase":"pr_open","decision":"link_pr","summary":"...","prNumber":123,"prUrl":"https://github.com/..."}',
  ].join('\n');
}

export function implementationRetryBrief(): string {
  return [
    'The linked PR failed CI or merge gates.',
    'Inspect the PR/check failures, fix them, and update the same PR.',
    'Required artifact body shape:',
    '{"phase":"pr_open","decision":"link_pr","summary":"...","prNumber":123,"prUrl":"https://github.com/..."}',
  ].join('\n');
}

export function releaseBrief(prNumber: number): string {
  return [
    `The PR #${prNumber} merged. Perform any release bookkeeping that applies.`,
    'If no release action is needed, state that clearly.',
    'Required artifact body shape:',
    '{"phase":"releasing","decision":"ship","summary":"..."}',
  ].join('\n');
}

export function notifyBrief(issue: GithubIssue): string {
  return [
    `Notify participants that issue #${issue.number} is done.`,
    'Thank the contributor if applicable.',
    'Required artifact body shape:',
    '{"phase":"done","decision":"notify","summary":"...","notifySkipped":false}',
  ].join('\n');
}
