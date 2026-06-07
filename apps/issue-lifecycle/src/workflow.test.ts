import type { SuccessCriteria } from '@moltnet/tasks';
import { describe, expect, it } from 'vitest';

import type { FakeGithub } from './test-fakes.js';
import { fakeDeps } from './test-fakes.js';
import { runGithubIssueLifecycle } from './workflow.js';

function assertionIds(taskInput: unknown): string[] {
  return (
    (taskInput as { successCriteria?: SuccessCriteria } | undefined)
      ?.successCriteria?.assertions ?? []
  ).map((assertion) => assertion.id);
}

describe('runGithubIssueLifecycle', () => {
  it('creates a freeform continuation chain through notify', async () => {
    const { deps: d, tasks } = fakeDeps([
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
      { phase: 'releasing', decision: 'ship', summary: 'released' },
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

    const result = await runGithubIssueLifecycle(
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

    expect(result).toMatchObject({ status: 'done', prNumber: 42 });
    expect(tasks.created).toHaveLength(6);
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
        'implementation-changedFiles',
        'implementation-testsRun',
        'implementation-diaryEntryIds',
        'implementation-planDeviations',
        'implementation-remainingRisks',
        'implementation-diffStats',
      ]),
    );
    expect(assertionIds(tasks.created[4]?.input)).toEqual(
      expect.arrayContaining([
        'release-releaseRequired',
        'release-releaseActions',
        'release-evidence',
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
    const notifyInput = tasks.created[5]?.input as
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

  it('creates a plan revision when review returns findings', async () => {
    const { deps: d, tasks } = fakeDeps([
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
      { phase: 'releasing', decision: 'ship', summary: 'released' },
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

  it('passes structured review findings to the revision task', async () => {
    const { deps: d, tasks } = fakeDeps([
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
      { phase: 'releasing', decision: 'ship', summary: 'released' },
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
    const { deps: d, tasks } = fakeDeps([
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
      { phase: 'releasing', decision: 'ship', summary: 'released' },
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
