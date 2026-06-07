import { describe, expect, it } from 'vitest';

import { fakeDeps } from './test-fakes.js';
import type { IssueLifecycleInput, WorkflowContext } from './types.js';
import { runGithubIssueLifecycle } from './workflow.js';

const BASE_INPUT: IssueLifecycleInput = {
  repo: 'getlarge/themoltnet',
  issueNumber: 1327,
  teamId: 'team',
  diaryId: 'diary',
  correlationId: '00000000-0000-4000-8000-000000000999',
  pollIntervalSec: 1,
};

function successfulOutputs() {
  return [
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
  ];
}

function recordingContext(sleeps: string[]): WorkflowContext {
  return {
    step(_name, fn) {
      return fn();
    },
    sleepFor(name) {
      sleeps.push(name);
      return Promise.resolve();
    },
  };
}

describe('GitHub issue lifecycle integration', () => {
  it('waits for explicit human approval before implementation', async () => {
    const { deps, github, tasks } = fakeDeps(successfulOutputs());
    const sleeps: string[] = [];
    github.approvalResponses = [false, false, true];

    const result = await runGithubIssueLifecycle(
      BASE_INPUT,
      deps,
      recordingContext(sleeps),
    );

    expect(result.status).toBe('done');
    expect(sleeps).toEqual([
      'wait-plan-approval-label',
      'wait-plan-approval-label',
    ]);
    expect(tasks.created.map((task) => task.title)).toEqual([
      'Triage issue #1327',
      'Plan issue #1327',
      'Review plan for issue #1327',
      'Implement issue #1327',
      'Release issue #1327',
      'Notify issue #1327',
    ]);
  });

  it('stops after triage when the issue needs clarification', async () => {
    const { deps, tasks } = fakeDeps([
      {
        phase: 'classified',
        decision: 'needs_triage',
        summary: 'needs repro steps',
      },
    ]);

    await expect(runGithubIssueLifecycle(BASE_INPUT, deps)).rejects.toThrow(
      'triage did not approve planning: needs_triage',
    );
    expect(tasks.created.map((task) => task.title)).toEqual([
      'Triage issue #1327',
    ]);
  });

  it('creates an implementation retry when the linked PR fails checks', async () => {
    const { deps, github, tasks } = fakeDeps([
      ...successfulOutputs().slice(0, 4),
      {
        phase: 'pr_open',
        decision: 'link_pr',
        summary: 'fixed failed checks',
        prNumber: 42,
        prUrl: 'https://github.com/getlarge/themoltnet/pull/42',
      },
      ...successfulOutputs().slice(4),
    ]);
    github.prResponses = [
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'failure',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: false,
        checks: 'failure',
      },
      {
        number: 42,
        url: 'https://github.com/getlarge/themoltnet/pull/42',
        merged: true,
        checks: 'success',
      },
    ];

    const result = await runGithubIssueLifecycle(BASE_INPUT, deps);

    expect(result.prNumber).toBe(42);
    expect(
      tasks.created.filter((task) => task.title === 'Implement issue #1327'),
    ).toHaveLength(2);
    expect(tasks.created.map((task) => task.title)).toContain(
      'Release issue #1327',
    );
  });

  it('fails when review findings cannot be resolved within the review budget', async () => {
    const { deps, tasks } = fakeDeps([
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
        findings: ['missing test plan'],
      },
      {
        phase: 'plan_generated',
        decision: 'ready_for_review',
        summary: 'revised',
        plan: 'plan v2',
      },
    ]);

    await expect(
      runGithubIssueLifecycle(
        {
          ...BASE_INPUT,
          maxReviewRounds: 1,
        },
        deps,
      ),
    ).rejects.toThrow('plan review did not pass within 1 rounds');
    expect(tasks.created.map((task) => task.title)).toEqual([
      'Triage issue #1327',
      'Plan issue #1327',
      'Review plan for issue #1327',
      'Revise plan for issue #1327',
    ]);
  });
});
