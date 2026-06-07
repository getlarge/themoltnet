import { randomUUID } from 'node:crypto';

import { computeJsonCid } from '@moltnet/crypto-service';
import type { SuccessCriteria } from '@moltnet/tasks';

import type {
  GithubIssue,
  IssueLifecycleInput,
  SdkTaskAttempt,
  TaskClient,
} from './types.js';

const DEFAULT_APPROVAL_LABEL = 'moltnet:plan-approved';
const DEFAULT_SKIP_NOTIFY_LABEL = 'moltnet:skip-notify';
const ARTIFACT_BODY_PATH = 'artifacts.0.body';

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

async function issueReference(
  input: IssueLifecycleInput & LifecycleDefaults,
  issue: GithubIssue,
) {
  return {
    taskId: null,
    outputCid: await computeJsonCid({
      kind: 'github_issue',
      repo: input.repo,
      number: issue.number,
      title: issue.title,
      body: issue.body,
      labels: issue.labels,
    }),
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

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function withParentDependency(
  successCriteria: SuccessCriteria,
  parentTaskId: string,
  parentAttempt: SdkTaskAttempt,
): SuccessCriteria {
  return {
    ...successCriteria,
    gates: [
      ...(successCriteria.gates ?? []),
      {
        id: 'continue-from-parent-attempt',
        kind: 'submit-tool-call',
        description:
          `This task must continue from parent task ${parentTaskId} ` +
          `attempt ${parentAttempt.attemptN}; the lifecycle artifact body ` +
          'must include sourceTaskId and sourceAttemptN for that parent.',
        required: true,
      },
    ],
    assertions: [
      ...(successCriteria.assertions ?? []),
      {
        id: 'source-task-id',
        path: ARTIFACT_BODY_PATH,
        op: 'matches',
        value: `"sourceTaskId"\\s*:\\s*"${escapeRegex(parentTaskId)}"`,
      },
      {
        id: 'source-attempt-n',
        path: ARTIFACT_BODY_PATH,
        op: 'matches',
        value: `"sourceAttemptN"\\s*:\\s*${parentAttempt.attemptN}`,
      },
    ],
  };
}

async function baseBody(
  input: IssueLifecycleInput & LifecycleDefaults,
  title: string,
  brief: string,
  issue: GithubIssue,
  successCriteria: SuccessCriteria,
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
      successCriteria,
    },
    references: [await issueReference(input, issue)],
    ...(input.allowedExecutors
      ? { allowedExecutors: input.allowedExecutors }
      : {}),
    ...(input.requiredExecutorTrustLevel
      ? { requiredExecutorTrustLevel: input.requiredExecutorTrustLevel }
      : {}),
  } satisfies Parameters<TaskClient['createTask']>[0];
}

export async function buildTriageTask(
  input: IssueLifecycleInput & LifecycleDefaults,
  issue: GithubIssue,
): Promise<Parameters<TaskClient['createTask']>[0]> {
  const brief = [
    `Triage GitHub issue ${input.repo}#${issue.number}: ${issue.title}`,
    '',
    issue.body || '_No issue body provided._',
    '',
    'Read repository instructions, design docs, and relevant skills before classifying.',
    'Classify the issue with useful tags such as feature, security, docs, or bug.',
    'If the issue is planning-ready, emit phase "classified" and decision "plan".',
    'If it needs clarification, emit phase "classified" and decision "needs_triage" with a concise summary.',
    'Include classification, labels, planningReady, actionability, and missingInformation so the next step can understand the triage decision.',
    '',
    'Required artifact body shape:',
    '{"phase":"classified","decision":"plan","summary":"...","classification":"feature|bug|docs|security|...","labels":["..."],"planningReady":true,"actionability":"...","missingInformation":[]}',
  ].join('\n');
  const body = await baseBody(
    input,
    `Triage issue #${issue.number}`,
    brief,
    issue,
    lifecycleSuccessCriteria({
      step: 'triage',
      expectedPhase: 'classified',
      expectedDecisionPattern: 'plan|needs_triage',
      requiredFields: [
        'summary',
        'classification',
        'labels',
        'planningReady',
        'actionability',
        'missingInformation',
      ],
      dependency: 'Initial task. Classify the issue before any planning work.',
    }),
  );

  return {
    ...body,
    input: {
      ...body.input,
      execution: { workspace: 'dedicated_worktree' },
    },
  };
}

export async function buildContinuationTask(args: {
  input: IssueLifecycleInput & LifecycleDefaults;
  issue: GithubIssue;
  parentTaskId: string;
  parentAttempt: SdkTaskAttempt;
  title: string;
  brief: string;
  successCriteria: SuccessCriteria;
}): Promise<Parameters<TaskClient['createTask']>[0]> {
  const successCriteria = withParentDependency(
    args.successCriteria,
    args.parentTaskId,
    args.parentAttempt,
  );
  const continuationBrief = [
    args.brief,
    '',
    `This task continues from task ${args.parentTaskId} attempt ${args.parentAttempt.attemptN}.`,
    'Include sourceTaskId and sourceAttemptN in the issue_lifecycle_state artifact body.',
  ].join('\n');
  const body = await baseBody(
    args.input,
    args.title,
    continuationBrief,
    args.issue,
    successCriteria,
  );
  return {
    ...body,
    input: {
      ...body.input,
      continueFrom: {
        taskId: args.parentTaskId,
        attemptN: args.parentAttempt.attemptN,
        mode: 'extend',
      },
    },
    references: [
      await issueReference(args.input, args.issue),
      taskReference(args.parentTaskId, args.parentAttempt),
    ],
    claimCondition: {
      op: 'task_status',
      taskId: args.parentTaskId,
      statuses: ['completed'],
    },
  };
}

function lifecycleSuccessCriteria(args: {
  step: string;
  expectedPhase: string;
  expectedDecisionPattern: string;
  requiredFields?: string[];
  dependency: string;
  sideEffects?: SuccessCriteria['sideEffects'];
}): SuccessCriteria {
  return {
    version: 1,
    gates: [
      {
        id: `${args.step}-lifecycle-artifact`,
        kind: 'submit-tool-call',
        description:
          'Output must include artifacts[0] with kind "issue_lifecycle_state" and a JSON string body.',
        required: true,
      },
      {
        id: `${args.step}-depends-on-previous-output`,
        kind: 'submit-tool-call',
        description: args.dependency,
        required: true,
      },
    ],
    assertions: [
      {
        id: `${args.step}-artifact-kind`,
        path: 'artifacts.0.kind',
        op: 'equals',
        value: 'issue_lifecycle_state',
      },
      {
        id: `${args.step}-phase`,
        path: ARTIFACT_BODY_PATH,
        op: 'matches',
        value: `"phase"\\s*:\\s*"${args.expectedPhase}"`,
      },
      {
        id: `${args.step}-decision`,
        path: ARTIFACT_BODY_PATH,
        op: 'matches',
        value: `"decision"\\s*:\\s*"(${args.expectedDecisionPattern})"`,
      },
      ...(args.requiredFields ?? []).map((field) => ({
        id: `${args.step}-${field}`,
        path: ARTIFACT_BODY_PATH,
        op: 'matches' as const,
        value: `"${field}"\\s*:`,
      })),
    ],
    ...(args.sideEffects ? { sideEffects: args.sideEffects } : {}),
  };
}

export const lifecycleCriteria = {
  plan(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'plan',
      expectedPhase: 'plan_generated',
      expectedDecisionPattern: 'ready_for_review',
      requiredFields: [
        'summary',
        'plan',
        'risks',
        'testStrategy',
        'acceptanceCriteria',
        'touchedAreas',
        'estimatedDiffRisk',
        'noImplementationPerformed',
      ],
      dependency:
        'Continue from the accepted triage attempt. Use the classified issue context and do not implement.',
    });
  },
  review(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'plan-review',
      expectedPhase: 'plan_generated',
      expectedDecisionPattern: 'review_passed|findings',
      requiredFields: [
        'summary',
        'findings',
        'reviewedPlanSummary',
        'noImplementationPerformed',
      ],
      dependency:
        'Continue from the accepted plan attempt. Review the current plan only; do not implement.',
    });
  },
  revisePlan(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'plan-revision',
      expectedPhase: 'plan_generated',
      expectedDecisionPattern: 'ready_for_review',
      requiredFields: [
        'summary',
        'plan',
        'resolvedFindings',
        'remainingRisks',
        'testStrategy',
        'acceptanceCriteria',
        'noImplementationPerformed',
      ],
      dependency:
        'Continue from the accepted review attempt and resolve every reported finding.',
    });
  },
  implement(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'implementation',
      expectedPhase: 'pr_open',
      expectedDecisionPattern: 'link_pr',
      requiredFields: [
        'summary',
        'prNumber',
        'prUrl',
        'changedFiles',
        'testsRun',
        'diaryEntryIds',
        'planDeviations',
        'remainingRisks',
        'diffStats',
      ],
      dependency:
        'Continue from the approved plan or failed-check retry context. Implement under repository instructions and link the PR.',
      sideEffects: {
        diaryEntryRequired: true,
        diaryEntryTags: ['accountable-commit'],
      },
    });
  },
  release(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'release',
      expectedPhase: 'releasing',
      expectedDecisionPattern: 'ship',
      requiredFields: [
        'summary',
        'releaseRequired',
        'releaseActions',
        'evidence',
      ],
      dependency:
        'Continue only after the linked PR is merged. Perform release bookkeeping or state that none is required.',
    });
  },
  notify(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'notify',
      expectedPhase: 'done',
      expectedDecisionPattern: 'notify|skip_notify',
      requiredFields: [
        'summary',
        'notifySkipped',
        'reflectionEntryId',
        'linkedEntryIds',
        'prReflectionUrl',
        'followUps',
      ],
      dependency:
        'Continue from the release task. Create the final reflection entry and publish its link in the PR body or a PR comment.',
      sideEffects: {
        diaryEntryRequired: true,
        diaryEntryTags: ['reflection', 'issue-lifecycle'],
      },
    });
  },
};

export function planBrief(issue: GithubIssue): string {
  return [
    `Generate an implementation plan for issue #${issue.number}: ${issue.title}.`,
    'Use the current session and worktree context from triage.',
    'Do not implement yet.',
    'Produce a concrete plan with risks, tests, and acceptance criteria.',
    'Include touchedAreas and estimatedDiffRisk so reviewers can assess blast radius.',
    'Set noImplementationPerformed to true.',
    'Required artifact body shape:',
    '{"phase":"plan_generated","decision":"ready_for_review","summary":"...","plan":"...","risks":["..."],"testStrategy":["..."],"acceptanceCriteria":["..."],"touchedAreas":["..."],"estimatedDiffRisk":"low|medium|high","noImplementationPerformed":true}',
  ].join('\n');
}

export function reviewBrief(): string {
  return [
    'Review the current plan critically.',
    'If it is ready for human approval, emit decision "review_passed" and no findings.',
    'If it needs work, emit decision "findings" and include findings[].',
    'Each finding should include enough detail to resolve it, either as a string or structured object.',
    'Do not implement code.',
    'Set noImplementationPerformed to true.',
    'Required artifact body shape:',
    '{"phase":"plan_generated","decision":"review_passed","summary":"...","findings":[],"reviewedPlanSummary":"...","noImplementationPerformed":true}',
  ].join('\n');
}

export function revisePlanBrief(findings: string[]): string {
  return [
    'Revise the implementation plan to resolve the review findings below.',
    '',
    ...findings.map((finding) => `- ${finding}`),
    '',
    'Do not implement yet.',
    'Include resolvedFindings and remainingRisks so review can verify every finding was handled.',
    'Set noImplementationPerformed to true.',
    'Required artifact body shape:',
    '{"phase":"plan_generated","decision":"ready_for_review","summary":"...","plan":"...","resolvedFindings":["..."],"remainingRisks":["..."],"testStrategy":["..."],"acceptanceCriteria":["..."],"noImplementationPerformed":true}',
  ].join('\n');
}

export function implementationBrief(issue: GithubIssue): string {
  return [
    `Implement the approved plan for issue #${issue.number}: ${issue.title}.`,
    'Stay within repository instructions and LeGreffier accountable commit workflow.',
    'Open or link the PR when done.',
    'Report changedFiles, testsRun, diaryEntryIds, planDeviations, remainingRisks, and diffStats.',
    'If the non-generated diff exceeds 500 changed lines or 15 files, include largeDiffJustification.',
    'Required artifact body shape:',
    '{"phase":"pr_open","decision":"link_pr","summary":"...","prNumber":123,"prUrl":"https://github.com/...","changedFiles":["..."],"testsRun":["..."],"diaryEntryIds":["..."],"planDeviations":[],"remainingRisks":[],"diffStats":{"files":1,"insertions":1,"deletions":0,"generatedFiles":[]}}',
  ].join('\n');
}

export function implementationRetryBrief(): string {
  return [
    'The linked PR failed CI or merge gates.',
    'Inspect the PR/check failures, fix them, and update the same PR.',
    'Report changedFiles, testsRun, diaryEntryIds, planDeviations, remainingRisks, and diffStats for the retry.',
    'Required artifact body shape:',
    '{"phase":"pr_open","decision":"link_pr","summary":"...","prNumber":123,"prUrl":"https://github.com/...","changedFiles":["..."],"testsRun":["..."],"diaryEntryIds":["..."],"planDeviations":[],"remainingRisks":[],"diffStats":{"files":1,"insertions":1,"deletions":0,"generatedFiles":[]}}',
  ].join('\n');
}

export function releaseBrief(prNumber: number): string {
  return [
    `The PR #${prNumber} merged. Perform any release bookkeeping that applies.`,
    'If no release action is needed, state that clearly.',
    'Report releaseRequired, releaseActions, and evidence.',
    'Required artifact body shape:',
    '{"phase":"releasing","decision":"ship","summary":"...","releaseRequired":false,"releaseActions":[],"evidence":["..."]}',
  ].join('\n');
}

export function notifyBrief(
  issue: GithubIssue,
  prNumber: number,
  skipNotify: boolean,
): string {
  return [
    `Finalize issue #${issue.number}: ${issue.title}.`,
    `Use PR #${prNumber} as the publication target for the final reflection link.`,
    skipNotify
      ? 'Do not notify issue participants because the skip-notify label is present.'
      : 'Notify participants that the issue is done and thank the contributor if applicable.',
    'Create a reflection diary entry that recaps this lifecycle session.',
    'The reflection must link or cite the diary entries created during the lifecycle, including implementation/accountable-commit entries.',
    'Add the reflection entry link to the PR body or to a PR comment.',
    'Include followUps for any residual work or an empty array if none.',
    'Required artifact body shape:',
    '{"phase":"done","decision":"notify","summary":"...","notifySkipped":false,"reflectionEntryId":"...","linkedEntryIds":["..."],"prReflectionUrl":"https://github.com/...","followUps":[]}',
  ].join('\n');
}
