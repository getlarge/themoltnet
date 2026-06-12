import type { SuccessCriteria } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import type { FakeGithub } from './test-fakes.js';
import { fakeDeps } from './test-fakes.js';
import type { WorkflowContext } from './types.js';
import { runGithubIssueLifecycle } from './workflow.js';

function assertionIds(taskInput: unknown): string[] {
  return (
    (taskInput as { successCriteria?: SuccessCriteria } | undefined)
      ?.successCriteria?.assertions ?? []
  ).map((assertion) => assertion.id);
}

function prReviewOutputs() {
  return [
    {
      phase: 'pr_review',
      decision: 'review_passed',
      summary: 'complexity ok',
      prReviewKind: 'complexity',
      findings: [],
      prReviewCommentUrl:
        'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      prReviewCommentBody: 'complexity ok',
      noImplementationPerformed: true,
    },
    {
      phase: 'pr_review',
      decision: 'review_passed',
      summary: 'functional ok',
      prReviewKind: 'functional',
      findings: [],
      prReviewCommentUrl:
        'https://github.com/getlarge/themoltnet/pull/42#issuecomment-2',
      prReviewCommentBody: 'functional ok',
      noImplementationPerformed: true,
    },
    {
      phase: 'pr_review',
      decision: 'review_passed',
      summary: 'security ok',
      prReviewKind: 'security',
      findings: [],
      prReviewCommentUrl:
        'https://github.com/getlarge/themoltnet/pull/42#issuecomment-3',
      prReviewCommentBody: 'security ok',
      noImplementationPerformed: true,
    },
    {
      phase: 'pr_open',
      decision: 'link_pr',
      summary: 'review feedback checked',
      prNumber: 42,
      prUrl: 'https://github.com/getlarge/themoltnet/pull/42',
      resolvedFindings: [],
      ignoredFindings: [],
      changedFiles: [],
      testsRun: [],
      diaryEntryIds: ['entry-implementation'],
    },
  ];
}

describe('runGithubIssueLifecycle', () => {
  it('creates a freeform continuation chain through notify', async () => {
    const {
      deps: d,
      github,
      tasks,
    } = fakeDeps([
      {
        phase: 'classified',
        decision: 'plan',
        summary: 'classified path\\with|pipe\nnext',
      },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
        prUrl: 'https://github.com/getlarge/themoltnet/pull/42',
      },
      ...prReviewOutputs(),
      {
        phase: 'done',
        decision: 'notify',
        summary: 'notified',
        notifySkipped: false,
        reflectionEntryId: 'entry-reflection',
        linkedEntryIds: ['entry-implementation'],
        prReflectionUrl:
          'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      },
    ]);
    github.approvalResponses = [false, true];

    const result = await runGithubIssueLifecycle(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1327,
        teamId: 'team',
        diaryId: 'diary',
        correlationId: '00000000-0000-4000-8000-000000000999',
        consoleUrl: 'http://localhost:5174/',
        pollIntervalSec: 1,
      },
      d,
    );

    expect(result).toMatchObject({ status: 'done', prNumber: 42 });
    expect(github.comments).toHaveLength(3);
    const approvalComment = github.comments.find((comment) =>
      comment.body.includes('moltnet-issue-lifecycle:plan-approval'),
    );
    const statusComment = github.comments.find((comment) =>
      comment.body.includes('moltnet-issue-lifecycle:status'),
    );
    const readyComment = github.comments.find((comment) =>
      comment.body.includes('moltnet-issue-lifecycle:ready-for-review'),
    );
    expect(approvalComment?.body).toContain(
      'MoltNet Issue Lifecycle: Plan Ready',
    );
    expect(approvalComment?.body).toContain('moltnet:plan-approved');
    expect(approvalComment?.body).toContain(
      '00000000-0000-4000-8000-000000000999',
    );
    expect(approvalComment?.body).toContain(
      'Console task chain: [open related tasks](http://localhost:5174/tasks?correlationId=00000000-0000-4000-8000-000000000999)',
    );
    expect(approvalComment?.body).toContain(
      'Plan task: [`00000000-0000-4000-8000-000000000002` attempt 1](http://localhost:5174/tasks/00000000-0000-4000-8000-000000000002/attempts/1)',
    );
    expect(approvalComment?.body).toContain(
      'Review task: [`00000000-0000-4000-8000-000000000003` attempt 1](http://localhost:5174/tasks/00000000-0000-4000-8000-000000000003/attempts/1)',
    );
    expect(approvalComment?.body).toContain('Approved plan:');
    expect(approvalComment?.body).toContain('plan');
    expect(approvalComment?.body).toContain('Reviewed plan summary:');
    expect(statusComment?.body).toContain('MoltNet Issue Lifecycle: Status');
    expect(statusComment?.body).toContain(
      'Console task chain: [open related tasks](http://localhost:5174/tasks?correlationId=00000000-0000-4000-8000-000000000999)',
    );
    expect(statusComment?.body).toContain(
      'Implementation | completed | [00000000-0000-4000-8000-000000000004 attempt 1](http://localhost:5174/tasks/00000000-0000-4000-8000-000000000004/attempts/1)',
    );
    expect(statusComment?.body).toContain(
      'Agent PR reviews | completed |  | 3 reviews accepted',
    );
    expect(statusComment?.body).toContain(
      'Triage | completed | [00000000-0000-4000-8000-000000000001 attempt 1](http://localhost:5174/tasks/00000000-0000-4000-8000-000000000001/attempts/1) | classified path\\\\with\\|pipe next',
    );
    expect(statusComment?.body).toContain(
      'Lifecycle | completed |  | Done for PR #42',
    );
    expect(readyComment?.body).toContain(
      'MoltNet Issue Lifecycle: Ready For Human Review',
    );
    expect(readyComment?.body).toContain('complexity ok');
    expect(github.labels).toEqual([
      { issueNumber: 42, label: 'moltnet:ready-for-review' },
    ]);
    expect(tasks.created).toHaveLength(9);
    expect(tasks.created[0]?.taskType).toBe('freeform');
    expect(tasks.created[0]?.input).toMatchObject({
      execution: { workspace: 'dedicated_worktree' },
    });
    const issueOutputCid = tasks.created[0]?.references?.[0]?.outputCid;
    expect(issueOutputCid).toMatch(/^ba/);
    expect(issueOutputCid).not.toContain('gh:issue');
    expect(
      (
        tasks.created[0]?.input as
          | { successCriteria?: SuccessCriteria }
          | undefined
      )?.successCriteria?.assertions,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'triage-phase',
          value: '"phase"\\s*:\\s*"classified"',
        }),
      ]),
    );
    expect(assertionIds(tasks.created[0]?.input)).toEqual(
      expect.arrayContaining([
        'triage-classification',
        'triage-labels',
        'triage-planningReady',
        'triage-actionability',
        'triage-missingInformation',
      ]),
    );
    const secondInput = tasks.created[1]?.input as
      | {
          continueFrom?: {
            taskId?: unknown;
            attemptN?: unknown;
            mode?: unknown;
          };
          brief?: string;
          successCriteria?: SuccessCriteria;
        }
      | undefined;
    expect(typeof secondInput?.continueFrom?.taskId).toBe('string');
    const sourceTaskId = secondInput?.continueFrom?.taskId as string;
    expect(secondInput?.continueFrom).toMatchObject({
      attemptN: 1,
      mode: 'extend',
    });
    expect(secondInput?.brief).toContain(
      `This task continues from task ${sourceTaskId} attempt 1.`,
    );
    expect(secondInput?.successCriteria?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'plan-phase',
          value: '"phase"\\s*:\\s*"plan_generated"',
        }),
        expect.objectContaining({
          id: 'source-task-id',
          value: `"sourceTaskId"\\s*:\\s*"${sourceTaskId}"`,
        }),
        expect.objectContaining({
          id: 'source-attempt-n',
          value: '"sourceAttemptN"\\s*:\\s*1',
        }),
      ]),
    );
    expect(assertionIds(secondInput)).toEqual(
      expect.arrayContaining([
        'plan-risks',
        'plan-testStrategy',
        'plan-acceptanceCriteria',
        'plan-touchedAreas',
        'plan-estimatedDiffRisk',
        'plan-noImplementationPerformed',
      ]),
    );
    expect(assertionIds(tasks.created[2]?.input)).toEqual(
      expect.arrayContaining([
        'plan-review-findings',
        'plan-review-reviewedPlanSummary',
        'plan-review-noImplementationPerformed',
      ]),
    );
    expect(assertionIds(tasks.created[3]?.input)).toEqual(
      expect.arrayContaining([
        'approved-plan-task-id',
        'approved-review-task-id',
        'implementation-changedFiles',
        'implementation-testsRun',
        'implementation-diaryEntryIds',
        'implementation-planDeviations',
        'implementation-remainingRisks',
        'implementation-diffStats',
      ]),
    );
    const implementationInput = tasks.created[3]?.input as
      | {
          continueFrom?: unknown;
          execution?: unknown;
          successCriteria?: SuccessCriteria;
        }
      | undefined;
    expect(implementationInput?.continueFrom).toBeUndefined();
    expect(implementationInput?.execution).toEqual({
      workspace: 'dedicated_worktree',
    });
    expect(tasks.created[3]?.claimCondition).toEqual({
      op: 'task_status',
      taskId: '00000000-0000-4000-8000-000000000003',
      statuses: ['completed'],
    });
    expect(tasks.created[3]?.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId: '00000000-0000-4000-8000-000000000002',
        }),
        expect.objectContaining({
          taskId: '00000000-0000-4000-8000-000000000003',
        }),
      ]),
    );
    expect(assertionIds(tasks.created[4]?.input)).toEqual(
      expect.arrayContaining([
        'pr-complexity-review-prReviewKind',
        'pr-complexity-review-prReviewCommentUrl',
        'pr-complexity-review-prReviewCommentBody',
      ]),
    );
    expect(assertionIds(tasks.created[5]?.input)).toEqual(
      expect.arrayContaining(['pr-functional-review-prReviewKind']),
    );
    expect(assertionIds(tasks.created[6]?.input)).toEqual(
      expect.arrayContaining(['pr-security-review-prReviewKind']),
    );
    expect(assertionIds(tasks.created[7]?.input)).toEqual(
      expect.arrayContaining([
        'pr-review-resolution-resolvedFindings',
        'pr-review-resolution-ignoredFindings',
      ]),
    );
    expect(
      (
        tasks.created[3]?.input as
          | { successCriteria?: SuccessCriteria }
          | undefined
      )?.successCriteria?.sideEffects,
    ).toEqual({
      diaryEntryRequired: true,
      diaryEntryTags: ['accountable-commit'],
    });
    const notifyInput = tasks.created[8]?.input as
      | { brief?: string; successCriteria?: SuccessCriteria }
      | undefined;
    expect(notifyInput?.brief).toContain(
      'Create a reflection diary entry that recaps this lifecycle session.',
    );
    expect(notifyInput?.brief).toContain(
      'Add the reflection entry link to the PR body or to a PR comment.',
    );
    expect(notifyInput?.successCriteria?.assertions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'notify-reflectionEntryId',
        }),
        expect.objectContaining({
          id: 'notify-linkedEntryIds',
        }),
        expect.objectContaining({
          id: 'notify-prReflectionUrl',
        }),
        expect.objectContaining({
          id: 'notify-followUps',
        }),
      ]),
    );
    expect(notifyInput?.successCriteria?.sideEffects).toEqual({
      diaryEntryRequired: true,
      diaryEntryTags: ['reflection', 'issue-lifecycle'],
    });
    expect(tasks.created.slice(1).every((task) => task.claimCondition)).toBe(
      true,
    );
  });

  it('uses event-aware waits when the workflow context supports them', async () => {
    const { deps: d, github } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
      },
      ...prReviewOutputs(),
      {
        phase: 'done',
        decision: 'skip_notify',
        summary: 'reflected',
        notifySkipped: true,
        reflectionEntryId: 'entry-reflection',
        linkedEntryIds: ['entry-implementation'],
        prReflectionUrl:
          'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      },
    ]);
    github.approvalResponses = [false, true];
    const events: string[] = [];
    const sleeps: string[] = [];
    const ctx: WorkflowContext = {
      step(_name, fn) {
        return fn();
      },
      sleepFor(name) {
        sleeps.push(name);
        return Promise.resolve();
      },
      awaitEvent(eventName) {
        events.push(eventName);
        return Promise.resolve({});
      },
    };

    await runGithubIssueLifecycle(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1327,
        teamId: 'team',
        diaryId: 'diary',
        correlationId: '00000000-0000-4000-8000-000000000999',
        pollIntervalSec: 1,
      },
      d,
      ctx,
    );

    expect(events).toContain(
      'github.issue.label:getlarge/themoltnet:1327:moltnet:plan-approved',
    );
    expect(sleeps).toEqual([]);
  });

  it('stops when triage says the issue needs more triage', async () => {
    const { deps: d, tasks } = fakeDeps([
      {
        phase: 'classified',
        decision: 'needs_triage',
        summary: 'needs clarification',
      },
    ]);

    await expect(
      runGithubIssueLifecycle(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: '00000000-0000-4000-8000-000000000999',
          pollIntervalSec: 1,
        },
        d,
      ),
    ).rejects.toThrow('triage did not approve planning: needs_triage');

    expect(tasks.created.map((task) => task.title)).toEqual([
      'Triage issue #1327',
    ]);
  });

  it('asks a supervisor task to classify terminal daemon failures', async () => {
    const { deps: d, tasks } = fakeDeps([
      {
        __taskStatus: 'failed',
        error: {
          code: 'llm_api_error',
          message: '401 "Unauthorized"',
          retryable: false,
        },
        messages: [
          {
            seq: 1,
            kind: 'provider',
            payload: {
              provider: 'ollama-cloud',
              model: 'glm-5.1:cloud',
            },
          },
          {
            seq: 2,
            kind: 'turn_end',
            payload: {
              stop_reason: 'error',
              error: 'llm_api_error',
            },
          },
        ],
      },
      {
        phase: 'lifecycle_recommendation',
        decision: 'stop_blocked',
        summary: 'provider auth failed',
        classification: 'provider_auth',
        confidence: 'high',
        allowedNextAction: 'stop_blocked',
        targetStep: 'triage',
        evidence: [
          {
            kind: 'task_attempt_error',
            taskId: '00000000-0000-4000-8000-000000000001',
            attemptN: 1,
            value: 'llm_api_error: 401 Unauthorized',
          },
        ],
        humanMessage:
          'Fix the daemon provider credentials before retrying the lifecycle.',
        risk: 'low',
      },
    ]);

    await expect(
      runGithubIssueLifecycle(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: '00000000-0000-4000-8000-000000000999',
          pollIntervalSec: 1,
        },
        d,
      ),
    ).rejects.toThrow(
      'lifecycle supervisor recommended stop_blocked for triage',
    );

    expect(tasks.created.map((task) => task.title)).toEqual([
      'Triage issue #1327',
      'Recommend recovery for triage',
    ]);
    const supervisorInput = tasks.created[1]?.input as
      | { brief?: string; successCriteria?: SuccessCriteria }
      | undefined;
    expect(supervisorInput?.brief).toContain('ollama-cloud');
    expect(supervisorInput?.brief).toContain('llm_api_error');
    expect(supervisorInput?.brief).toContain('401 \\"Unauthorized\\"');
    expect(supervisorInput?.brief).toContain('"allowedActions"');
    expect(assertionIds(supervisorInput)).toEqual(
      expect.arrayContaining([
        'supervisor-recommendation-classification',
        'supervisor-recommendation-allowedNextAction',
        'supervisor-recommendation-evidence',
        'supervisor-recommendation-humanMessage',
      ]),
    );
  });

  it('routes invalid accepted task output through a supervisor task', async () => {
    const { deps: d, tasks } = fakeDeps([
      {
        __rawOutput: {
          summary: 'not a lifecycle artifact',
          artifacts: [],
        },
      },
      {
        phase: 'lifecycle_recommendation',
        decision: 'stop_blocked',
        summary: 'agent returned invalid output',
        classification: 'agent_output_invalid',
        confidence: 'high',
        allowedNextAction: 'stop_blocked',
        targetStep: 'triage',
        evidence: [
          {
            kind: 'invalid_artifact',
            taskId: '00000000-0000-4000-8000-000000000001',
          },
        ],
        humanMessage:
          'The accepted task output was missing the lifecycle artifact.',
        risk: 'low',
      },
    ]);

    await expect(
      runGithubIssueLifecycle(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: '00000000-0000-4000-8000-000000000999',
          pollIntervalSec: 1,
        },
        d,
      ),
    ).rejects.toThrow(
      'lifecycle supervisor recommended stop_blocked for triage',
    );

    expect(tasks.created.map((task) => task.title)).toEqual([
      'Triage issue #1327',
      'Recommend recovery for triage',
    ]);
    expect((tasks.created[1]?.input as { brief?: string }).brief).toContain(
      'freeform output is missing artifacts[0].body',
    );
  });

  it('rejects contradictory supervisor recommendations', async () => {
    const { deps: d } = fakeDeps([
      {
        __taskStatus: 'failed',
        error: { code: 'llm_api_error', message: 'timeout', retryable: true },
      },
      {
        phase: 'lifecycle_recommendation',
        decision: 'stop_blocked',
        summary: 'contradictory recommendation',
        classification: 'transient_infra',
        confidence: 'low',
        allowedNextAction: 'abort',
        targetStep: 'triage',
        evidence: [{ kind: 'task_attempt_error' }],
        humanMessage: 'contradictory action',
        risk: 'medium',
      },
    ]);

    await expect(
      runGithubIssueLifecycle(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: '00000000-0000-4000-8000-000000000999',
          pollIntervalSec: 1,
        },
        d,
      ),
    ).rejects.toThrow(
      'lifecycle supervisor decision stop_blocked does not match allowedNextAction abort for triage',
    );
  });

  it('does not notify when human-review checks fail on the final attempt', async () => {
    const {
      deps: d,
      github,
      tasks,
    } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
      },
      ...prReviewOutputs(),
    ]);
    github.approvalResponses = [false, true];
    github.prResponses = [
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'success',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'success',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'failure',
      },
    ];

    await expect(
      runGithubIssueLifecycle(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: '00000000-0000-4000-8000-000000000999',
          pollIntervalSec: 1,
          maxImplementationRetries: 0,
        },
        d,
      ),
    ).rejects.toThrow(
      'PR #42 checks failed during human review after retry budget',
    );

    expect(tasks.created.map((task) => task.title)).not.toContain(
      'Notify issue #1327',
    );
    const statusComment = github.comments.find((comment) =>
      comment.body.includes('moltnet-issue-lifecycle:status'),
    );
    expect(statusComment?.body).toContain(
      'Checks failed during human review; retry budget exhausted',
    );
  });

  it('rechecks the PR is merged before notify', async () => {
    const {
      deps: d,
      github,
      tasks,
    } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
        prUrl: 'https://github.com/getlarge/themoltnet/pull/42',
      },
      ...prReviewOutputs(),
    ]);
    github.approvalResponses = [false, true];
    github.prResponses = [
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'success',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'success',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: true,
        checks: 'success',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'failure',
      },
    ];

    await expect(
      runGithubIssueLifecycle(
        {
          repo: 'getlarge/themoltnet',
          issueNumber: 1327,
          teamId: 'team',
          diaryId: 'diary',
          correlationId: '00000000-0000-4000-8000-000000000999',
          pollIntervalSec: 1,
        },
        d,
      ),
    ).rejects.toThrow('PR #42 is not merged; refusing to notify completion');

    expect(tasks.created.map((task) => task.title)).not.toContain(
      'Notify issue #1327',
    );
    const statusComment = github.comments.find((comment) =>
      comment.body.includes('moltnet-issue-lifecycle:status'),
    );
    expect(statusComment?.body).toContain(
      'PR #42 is not merged; refusing to notify completion',
    );
  });

  it('creates a plan revision when review returns findings', async () => {
    const {
      deps: d,
      github,
      tasks,
    } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'findings',
        summary: 'needs work',
        findings: ['tighten tests'],
      },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'revised',
        plan: 'plan v2',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
      },
      ...prReviewOutputs(),
      {
        phase: 'done',
        decision: 'skip_notify',
        summary: 'reflected',
        notifySkipped: true,
        reflectionEntryId: 'entry-reflection',
        linkedEntryIds: ['entry-implementation'],
        prReflectionUrl:
          'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      },
    ]);
    github.approvalResponses = [false, true];
    (d.github as FakeGithub).skipNotify = true;

    await runGithubIssueLifecycle(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1327,
        teamId: 'team',
        diaryId: 'diary',
        correlationId: '00000000-0000-4000-8000-000000000999',
        pollIntervalSec: 1,
      },
      d,
    );

    expect(tasks.created.map((task) => task.title)).toContain(
      'Revise plan for issue #1327',
    );
    const revision = tasks.created.find(
      (task) => task.title === 'Revise plan for issue #1327',
    );
    expect(assertionIds(revision?.input)).toEqual(
      expect.arrayContaining([
        'plan-revision-resolvedFindings',
        'plan-revision-remainingRisks',
        'plan-revision-testStrategy',
        'plan-revision-acceptanceCriteria',
        'plan-revision-noImplementationPerformed',
      ]),
    );
    expect(tasks.created.map((task) => task.title)).toContain(
      'Notify issue #1327',
    );
  });

  it('does not duplicate an existing approval prompt comment', async () => {
    const correlationId = '00000000-0000-4000-8000-000000000999';
    const { deps: d, github } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
      },
      ...prReviewOutputs(),
      {
        phase: 'done',
        decision: 'skip_notify',
        summary: 'reflected',
        notifySkipped: true,
        reflectionEntryId: 'entry-reflection',
        linkedEntryIds: ['entry-implementation'],
        prReflectionUrl:
          'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      },
    ]);
    github.approvalResponses = [false, true];
    github.comments = [
      {
        id: 1,
        body: `<!-- moltnet-issue-lifecycle:plan-approval:${correlationId} -->`,
      },
    ];

    await runGithubIssueLifecycle(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1327,
        teamId: 'team',
        diaryId: 'diary',
        correlationId,
        pollIntervalSec: 1,
      },
      d,
    );

    expect(github.comments).toHaveLength(3);
    expect(
      github.comments.filter((comment) =>
        comment.body.includes('moltnet-issue-lifecycle:plan-approval'),
      ),
    ).toHaveLength(1);
    expect(
      github.comments.filter((comment) =>
        comment.body.includes('moltnet-issue-lifecycle:status'),
      ),
    ).toHaveLength(1);
  });

  it('passes structured review findings to the revision task', async () => {
    const {
      deps: d,
      github,
      tasks,
    } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'findings',
        summary: 'needs work',
        findings: [
          {
            id: 'testing-approach',
            priority: 'medium',
            description: 'The test plan is too vague.',
            suggestedAction: 'Name the integration test coverage.',
          },
        ],
      },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'revised',
        plan: 'plan v2',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
      },
      ...prReviewOutputs(),
      {
        phase: 'done',
        decision: 'skip_notify',
        summary: 'reflected',
        notifySkipped: true,
        reflectionEntryId: 'entry-reflection',
        linkedEntryIds: ['entry-implementation'],
        prReflectionUrl:
          'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      },
    ]);
    github.approvalResponses = [false, true];

    await runGithubIssueLifecycle(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1327,
        teamId: 'team',
        diaryId: 'diary',
        correlationId: '00000000-0000-4000-8000-000000000999',
        pollIntervalSec: 1,
      },
      d,
    );

    const revision = tasks.created.find(
      (task) => task.title === 'Revise plan for issue #1327',
    );
    expect((revision?.input as { brief?: string }).brief).toContain(
      'testing-approach - medium - The test plan is too vague. - Name the integration test coverage.',
    );
  });

  it('creates a defensive revision when review fails without findings', async () => {
    const {
      deps: d,
      github,
      tasks,
    } = fakeDeps([
      { phase: 'classified', decision: 'plan', summary: 'classified' },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'planned',
        plan: 'plan',
      },
      {
        phase: 'plan_generated',
        decision: 'findings',
        summary: 'The plan lacks enough implementation detail.',
        findings: [],
      },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'revised',
        plan: 'plan v2',
      },
      {
        phase: 'plan_generated',
        decision: 'review_passed',
        summary: 'reviewed',
        findings: [],
      },
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'implemented',
        prNumber: 42,
      },
      ...prReviewOutputs(),
      {
        phase: 'done',
        decision: 'skip_notify',
        summary: 'reflected',
        notifySkipped: true,
        reflectionEntryId: 'entry-reflection',
        linkedEntryIds: ['entry-implementation'],
        prReflectionUrl:
          'https://github.com/getlarge/themoltnet/pull/42#issuecomment-1',
      },
    ]);
    github.approvalResponses = [false, true];

    await runGithubIssueLifecycle(
      {
        repo: 'getlarge/themoltnet',
        issueNumber: 1327,
        teamId: 'team',
        diaryId: 'diary',
        correlationId: '00000000-0000-4000-8000-000000000999',
        pollIntervalSec: 1,
      },
      d,
    );

    const revision = tasks.created.find(
      (task) => task.title === 'Revise plan for issue #1327',
    );
    expect((revision?.input as { brief?: string }).brief).toContain(
      'Review decision "findings" did not pass but produced no explicit findings.',
    );
    expect((revision?.input as { brief?: string }).brief).toContain(
      'The plan lacks enough implementation detail.',
    );
  });
});
