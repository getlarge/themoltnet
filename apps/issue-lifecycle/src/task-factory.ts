import { randomUUID } from 'node:crypto';

import { computeJsonCid } from '@moltnet/crypto-service';
import type { SuccessCriteria } from '@moltnet/tasks';

import type {
  GithubIssue,
  IssueLifecycleInput,
  SdkTaskAttempt,
  SupervisorAction,
  TaskClient,
} from './types.js';

const DEFAULT_APPROVAL_LABEL = 'moltnet:plan-approved';
const DEFAULT_READY_FOR_REVIEW_LABEL = 'moltnet:ready-for-review';
const DEFAULT_SKIP_NOTIFY_LABEL = 'moltnet:skip-notify';
const DEFAULT_CONSOLE_URL = 'https://console.themolt.net';
const ARTIFACT_BODY_PATH = 'artifacts.0.body';

export interface LifecycleDefaults {
  correlationId: string;
  consoleUrl: string;
  approvalLabel: string;
  readyForReviewLabel: string;
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
    consoleUrl: normalizeConsoleUrl(input.consoleUrl ?? DEFAULT_CONSOLE_URL),
    approvalLabel: input.approvalLabel ?? DEFAULT_APPROVAL_LABEL,
    readyForReviewLabel:
      input.readyForReviewLabel ?? DEFAULT_READY_FOR_REVIEW_LABEL,
    skipNotifyLabel: input.skipNotifyLabel ?? DEFAULT_SKIP_NOTIFY_LABEL,
    pollIntervalSec: input.pollIntervalSec ?? 30,
    maxReviewRounds: input.maxReviewRounds ?? 5,
    maxImplementationRetries: input.maxImplementationRetries ?? 3,
  };
}

function normalizeConsoleUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, '');
  return normalized || DEFAULT_CONSOLE_URL;
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

function withApprovedPlanDependency(
  successCriteria: SuccessCriteria,
  args: {
    planTaskId: string;
    planAttempt: SdkTaskAttempt;
    reviewTaskId: string;
    reviewAttempt: SdkTaskAttempt;
  },
): SuccessCriteria {
  return {
    ...successCriteria,
    gates: [
      ...(successCriteria.gates ?? []),
      {
        id: 'fresh-implementation-from-approved-plan',
        kind: 'submit-tool-call',
        description:
          'This implementation task must start from a fresh session/worktree ' +
          `and use approved plan task ${args.planTaskId} attempt ` +
          `${args.planAttempt.attemptN} plus review task ${args.reviewTaskId} ` +
          `attempt ${args.reviewAttempt.attemptN} as durable context.`,
        required: true,
      },
    ],
    assertions: [
      ...(successCriteria.assertions ?? []),
      {
        id: 'approved-plan-task-id',
        path: ARTIFACT_BODY_PATH,
        op: 'matches',
        value: `"approvedPlanTaskId"\\s*:\\s*"${escapeRegex(args.planTaskId)}"`,
      },
      {
        id: 'approved-review-task-id',
        path: ARTIFACT_BODY_PATH,
        op: 'matches',
        value: `"approvedReviewTaskId"\\s*:\\s*"${escapeRegex(args.reviewTaskId)}"`,
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

export async function buildFreshImplementationTask(args: {
  input: IssueLifecycleInput & LifecycleDefaults;
  issue: GithubIssue;
  planTaskId: string;
  planAttempt: SdkTaskAttempt;
  reviewTaskId: string;
  reviewAttempt: SdkTaskAttempt;
  brief: string;
  successCriteria: SuccessCriteria;
}): Promise<Parameters<TaskClient['createTask']>[0]> {
  const successCriteria = withApprovedPlanDependency(args.successCriteria, {
    planTaskId: args.planTaskId,
    planAttempt: args.planAttempt,
    reviewTaskId: args.reviewTaskId,
    reviewAttempt: args.reviewAttempt,
  });
  const freshBrief = [
    args.brief,
    '',
    'Start from a fresh implementation session/worktree. Do not depend on prior chat/session context.',
    `Use approved plan task ${args.planTaskId} attempt ${args.planAttempt.attemptN} and approved review task ${args.reviewTaskId} attempt ${args.reviewAttempt.attemptN} as durable context via task references.`,
    'Include approvedPlanTaskId and approvedReviewTaskId in the issue_lifecycle_state artifact body.',
  ].join('\n');
  const body = await baseBody(
    args.input,
    `Implement issue #${args.issue.number}`,
    freshBrief,
    args.issue,
    successCriteria,
  );
  return {
    ...body,
    input: {
      ...body.input,
      execution: { workspace: 'dedicated_worktree' },
    },
    references: [
      await issueReference(args.input, args.issue),
      taskReference(args.planTaskId, args.planAttempt),
      taskReference(args.reviewTaskId, args.reviewAttempt),
    ],
    claimCondition: {
      op: 'task_status',
      taskId: args.reviewTaskId,
      statuses: ['completed'],
    },
  };
}

export async function buildPrReviewTask(args: {
  input: IssueLifecycleInput & LifecycleDefaults;
  issue: GithubIssue;
  implementationTaskId: string;
  implementationAttempt: SdkTaskAttempt;
  prNumber: number;
  kind: 'complexity' | 'functional' | 'security';
}): Promise<Parameters<TaskClient['createTask']>[0]> {
  const body = await baseBody(
    args.input,
    `${reviewTitle(args.kind)} for PR #${args.prNumber}`,
    prReviewBrief(args.kind, args.prNumber),
    args.issue,
    lifecycleCriteria.prReview(args.kind),
  );
  return {
    ...body,
    input: {
      ...body.input,
      execution: { workspace: 'dedicated_worktree' },
    },
    references: [
      await issueReference(args.input, args.issue),
      taskReference(args.implementationTaskId, args.implementationAttempt),
    ],
    claimCondition: {
      op: 'task_status',
      taskId: args.implementationTaskId,
      statuses: ['completed'],
    },
  };
}

export async function buildPrReviewResolutionTask(args: {
  input: IssueLifecycleInput & LifecycleDefaults;
  issue: GithubIssue;
  implementationTaskId: string;
  implementationAttempt: SdkTaskAttempt;
  reviewResults: Array<{
    taskId: string;
    attempt: SdkTaskAttempt;
    kind: string;
    summary: string;
    decision: string;
  }>;
  prNumber: number;
}): Promise<Parameters<TaskClient['createTask']>[0]> {
  const brief = reviewResolutionBrief(args.prNumber, args.reviewResults);
  const body = await baseBody(
    args.input,
    `Apply PR review feedback for issue #${args.issue.number}`,
    brief,
    args.issue,
    lifecycleCriteria.reviewResolution(),
  );
  return {
    ...body,
    input: {
      ...body.input,
      continueFrom: {
        taskId: args.implementationTaskId,
        attemptN: args.implementationAttempt.attemptN,
        mode: 'extend',
      },
    },
    references: [
      await issueReference(args.input, args.issue),
      taskReference(args.implementationTaskId, args.implementationAttempt),
      ...args.reviewResults.map((review) =>
        taskReference(review.taskId, review.attempt),
      ),
    ],
    claimCondition: {
      op: 'task_status',
      taskId: args.implementationTaskId,
      statuses: ['completed'],
    },
  };
}

export async function buildSupervisorRecommendationTask(args: {
  input: IssueLifecycleInput & LifecycleDefaults;
  issue: GithubIssue;
  step: string;
  reason: string;
  snapshot: Record<string, unknown>;
  allowedActions: SupervisorAction[];
}): Promise<Parameters<TaskClient['createTask']>[0]> {
  const brief = [
    `Recommend the next issue-lifecycle action for ${args.input.repo}#${args.issue.number}.`,
    '',
    `Current lifecycle step: ${args.step}`,
    `Reason recommendation is needed: ${args.reason}`,
    '',
    'You are the lifecycle supervisor. Interpret the snapshot, classify the situation, and recommend exactly one allowed next action.',
    'Do not modify repository files, GitHub state, or MoltNet tasks. This is a decision-only task.',
    'Prefer stop_blocked for provider/auth/permission/config failures that a retry cannot fix.',
    'Prefer retry_step only for clearly transient failures with retry budget available.',
    'Prefer abort only when the lifecycle request is invalid or unsafe to continue.',
    'Allowed actions:',
    ...args.allowedActions.map((action) => `- ${action}`),
    '',
    'Lifecycle snapshot JSON:',
    JSON.stringify(args.snapshot, null, 2),
    '',
    'Required artifact body shape:',
    '{"phase":"lifecycle_recommendation","decision":"stop_blocked","summary":"...","classification":"provider_auth|transient_infra|task_contract|agent_output_invalid|ci_failure|review_feedback|human_gate|unknown","confidence":"high|medium|low","allowedNextAction":"stop_blocked","targetStep":"triage","evidence":[{"kind":"task_attempt_error","taskId":"...","attemptN":1,"value":"..."}],"humanMessage":"...","risk":"low|medium|high"}',
  ].join('\n');
  return baseBody(
    args.input,
    `Recommend recovery for ${args.step}`,
    brief,
    args.issue,
    lifecycleSuccessCriteria({
      step: 'supervisor-recommendation',
      expectedPhase: 'lifecycle_recommendation',
      expectedDecisionPattern: args.allowedActions
        .map((action) => escapeRegex(action))
        .join('|'),
      requiredFields: [
        'summary',
        'classification',
        'confidence',
        'allowedNextAction',
        'targetStep',
        'evidence',
        'humanMessage',
        'risk',
      ],
      dependency:
        'Decision-only lifecycle supervisor task. Use the provided snapshot and choose one allowed next action.',
    }),
  );
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
  prReview(kind: 'complexity' | 'functional' | 'security'): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: `pr-${kind}-review`,
      expectedPhase: 'pr_review',
      expectedDecisionPattern: 'review_passed|findings',
      requiredFields: [
        'summary',
        'prReviewKind',
        'findings',
        'prReviewCommentUrl',
        'prReviewCommentBody',
        'noImplementationPerformed',
      ],
      dependency:
        'Review the linked PR after CI is green. Start fresh, inspect the PR branch, and publish the exact PR comment body you report.',
    });
  },
  reviewResolution(): SuccessCriteria {
    return lifecycleSuccessCriteria({
      step: 'pr-review-resolution',
      expectedPhase: 'pr_open',
      expectedDecisionPattern: 'link_pr',
      requiredFields: [
        'summary',
        'prNumber',
        'prUrl',
        'resolvedFindings',
        'ignoredFindings',
        'changedFiles',
        'testsRun',
        'diaryEntryIds',
      ],
      dependency:
        'Continue from the implementation task and use every PR review task output. Apply only findings that are truly relevant.',
      sideEffects: {
        diaryEntryRequired: true,
        diaryEntryTags: ['accountable-commit'],
      },
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
        'Continue after the PR is merged. Create the final reflection entry and publish its link in the PR body or a PR comment.',
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
    'Report approvedPlanTaskId and approvedReviewTaskId so the lifecycle can audit which approved context was implemented.',
    'If the non-generated diff exceeds 500 changed lines or 15 files, include largeDiffJustification.',
    'Required artifact body shape:',
    '{"phase":"pr_open","decision":"link_pr","summary":"...","prNumber":123,"prUrl":"https://github.com/...","approvedPlanTaskId":"...","approvedReviewTaskId":"...","changedFiles":["..."],"testsRun":["..."],"diaryEntryIds":["..."],"planDeviations":[],"remainingRisks":[],"diffStats":{"files":1,"insertions":1,"deletions":0,"generatedFiles":[]}}',
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

function reviewTitle(kind: 'complexity' | 'functional' | 'security'): string {
  switch (kind) {
    case 'complexity':
      return 'Complexity review';
    case 'functional':
      return 'Functional review';
    case 'security':
      return 'Security review';
  }
}

function prReviewBrief(
  kind: 'complexity' | 'functional' | 'security',
  prNumber: number,
): string {
  const focus =
    kind === 'complexity'
      ? [
          'Judge the implementation complexity and whether auto-merge would be reasonable.',
          'Help the human understand blast radius, diff size, generated-code impact, and residual merge risk.',
        ]
      : kind === 'functional'
        ? [
            'Review whether the PR functionally satisfies the approved plan and issue.',
            'Check tests, behavior changes, edge cases, and whether any changes are unnecessary.',
          ]
        : [
            'Review security and integrity risks introduced by the PR.',
            'Check auth, secrets, permissions, supply-chain, data exposure, and unsafe automation risks.',
          ];
  return [
    `${reviewTitle(kind)} for PR #${prNumber}.`,
    'Start from a fresh session. Check out or inspect the PR branch as needed; do not assume another daemon has the implementation worktree.',
    'Do not modify code.',
    ...focus,
    'Create a PR comment with your review. The artifact must include prReviewCommentBody word for word exactly as posted, and prReviewCommentUrl.',
    'Use decision "review_passed" when there are no actionable findings. Use decision "findings" only for relevant changes that should be considered by the implementation agent.',
    'Set noImplementationPerformed to true.',
    'Required artifact body shape:',
    `{"phase":"pr_review","decision":"review_passed","summary":"...","prReviewKind":"${kind}","findings":[],"prReviewCommentUrl":"https://github.com/...","prReviewCommentBody":"...","noImplementationPerformed":true}`,
  ].join('\n');
}

function reviewResolutionBrief(
  prNumber: number,
  reviews: Array<{
    taskId: string;
    kind: string;
    summary: string;
    decision: string;
  }>,
): string {
  return [
    `Continue implementation for PR #${prNumber} after agent PR reviews.`,
    'Inspect the PR comments and the referenced review task outputs.',
    'Apply changes only when a finding is truly relevant and improves the PR. It is acceptable to ignore weak, redundant, or incorrect findings, but explain why.',
    'Update the same PR if changes are made. Do not open a new PR.',
    'Review task summary:',
    ...reviews.map(
      (review) =>
        `- ${review.kind}: task ${review.taskId}, decision ${review.decision}, summary: ${review.summary}`,
    ),
    'Required artifact body shape:',
    '{"phase":"pr_open","decision":"link_pr","summary":"...","prNumber":123,"prUrl":"https://github.com/...","resolvedFindings":["..."],"ignoredFindings":["..."],"changedFiles":["..."],"testsRun":["..."],"diaryEntryIds":["..."]}',
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
