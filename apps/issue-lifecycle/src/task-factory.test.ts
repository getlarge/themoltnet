import { describe, expect, it } from 'vitest';

import type { LifecycleConfig } from './lifecycle-config.js';
import { buildTriageTask, normalizeLifecycleInput } from './task-factory.js';
import type { GithubIssue, IssueLifecycleInput } from './types.js';

const PROFILE_ID = '00000000-0000-4000-8000-0000000000aa';

const ISSUE: GithubIssue = {
  number: 7,
  title: 'Example',
  body: 'body',
  labels: [],
};

function input(
  overrides: Partial<IssueLifecycleInput> = {},
): IssueLifecycleInput & ReturnType<typeof normalizeLifecycleInput> {
  return normalizeLifecycleInput({
    repo: 'getlarge/themoltnet',
    issueNumber: 7,
    teamId: '00000000-0000-4000-8000-0000000000t1',
    diaryId: '00000000-0000-4000-8000-0000000000d1',
    correlationId: '00000000-0000-4000-8000-0000000000c1',
    ...overrides,
  });
}

describe('buildTriageTask config wiring', () => {
  it('omits allowedProfiles and uses the default attempts with no config', async () => {
    const body = await buildTriageTask(input(), ISSUE);

    expect('allowedProfiles' in body).toBe(false);
    expect(body.maxAttempts).toBe(3); // RETRYABLE_AGENT_TASK_ATTEMPTS
    expect('requiredExecutorTrustLevel' in body).toBe(false);
  });

  it('pins allowedProfiles from a configured profileId', async () => {
    const lifecycleConfig: LifecycleConfig = {
      triage: { profileId: PROFILE_ID },
    };
    const body = await buildTriageTask(input({ lifecycleConfig }), ISSUE);

    expect(body.allowedProfiles).toEqual([{ profileId: PROFILE_ID }]);
  });

  it('applies the configured per-step maxAttempts', async () => {
    const lifecycleConfig: LifecycleConfig = { triage: { maxAttempts: 1 } };
    const body = await buildTriageTask(input({ lifecycleConfig }), ISSUE);

    expect(body.maxAttempts).toBe(1);
  });

  it('applies the per-step requiredExecutorTrustLevel', async () => {
    const lifecycleConfig: LifecycleConfig = {
      triage: { requiredExecutorTrustLevel: 'sandboxAttested' },
    };
    const body = await buildTriageTask(input({ lifecycleConfig }), ISSUE);

    expect(body.requiredExecutorTrustLevel).toBe('sandboxAttested');
  });

  it('lets a per-step trust level override the global input default', async () => {
    const body = await buildTriageTask(
      input({
        requiredExecutorTrustLevel: 'selfDeclared',
        lifecycleConfig: {
          triage: { requiredExecutorTrustLevel: 'agentSigned' },
        },
      }),
      ISSUE,
    );

    expect(body.requiredExecutorTrustLevel).toBe('agentSigned');
  });

  it('falls back to the global trust level when the step sets none', async () => {
    const body = await buildTriageTask(
      input({ requiredExecutorTrustLevel: 'releaseVerifiedTool' }),
      ISSUE,
    );

    expect(body.requiredExecutorTrustLevel).toBe('releaseVerifiedTool');
  });
});
