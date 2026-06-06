import { describe, expect, it } from 'vitest';

import type { FakeGithub } from './test-fakes.js';
import { fakeDeps } from './test-fakes.js';
import { runGithubIssueLifecycle } from './workflow.js';

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
    const secondInput = tasks.created[1]?.input as
      | {
          continueFrom?: {
            taskId?: unknown;
            attemptN?: unknown;
            mode?: unknown;
          };
        }
      | undefined;
    expect(typeof secondInput?.continueFrom?.taskId).toBe('string');
    expect(secondInput?.continueFrom).toMatchObject({
      attemptN: 1,
      mode: 'extend',
    });
    expect(tasks.created.slice(1).every((task) => task.claimCondition)).toBe(
      true,
    );
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
  });
});
