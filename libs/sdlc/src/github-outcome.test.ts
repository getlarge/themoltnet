import { describe, expect, it, vi } from 'vitest';

import type { GithubRequest } from './github-coordination.js';
import { githubOutcomeIsCurrent } from './github-outcome.js';
import type { OutcomeInput } from './outcome.js';

function fixture() {
  const input: OutcomeInput = {
    diaryId: 'diary',
    teamId: 'team',
    findings: [],
    handoff: {
      version: 1,
      workItem: { provider: 'github', repository: 'owner/repo', key: '1' },
      generation: 'event',
      correlationId: 'case',
      revision: {
        base: 'base',
        head: 'head',
        policyDigest: 'policy',
        briefDigest: 'brief',
      },
      acceptedWork: { taskId: 'task', attempt: 1, outputCid: 'cid' },
    },
    observation: {
      state: 'merged',
      occurredAt: '2026-10-29T10:30:00Z',
      providerUrl: 'https://github.com/owner/repo/pull/2',
      mergeCommit: 'merge',
    },
  };
  const pull = {
    state: 'closed',
    closed_at: input.observation.occurredAt,
    head: { sha: 'head' },
    merged: true,
    merge_commit_sha: 'merge',
  };
  const request = vi
    .fn<GithubRequest>()
    .mockImplementation(() => Promise.resolve(pull));
  return { input, pull, request };
}
describe('GitHub outcome observation', () => {
  it('accepts the exact merged closure', async () => {
    const { input, request } = fixture();
    expect(await githubOutcomeIsCurrent(input, request)).toBe(true);
  });
  it.each(['state', 'closed_at', 'merge_commit_sha'] as const)(
    'rejects a changed %s',
    async (key) => {
      const { input, pull, request } = fixture();
      pull[key] = 'changed';
      expect(await githubOutcomeIsCurrent(input, request)).toBe(false);
    },
  );
  it('rejects changed heads and foreign repositories', async () => {
    const { input, pull, request } = fixture();
    pull.head.sha = 'new';
    expect(await githubOutcomeIsCurrent(input, request)).toBe(false);
    input.observation.providerUrl = 'https://github.com/other/repo/pull/2';
    expect(await githubOutcomeIsCurrent(input, request)).toBe(false);
  });
  it('does not describe an unmerged closure as a merge', async () => {
    const { input, pull, request } = fixture();
    pull.merged = false;
    expect(await githubOutcomeIsCurrent(input, request)).toBe(false);
    input.observation.state = 'closed-unmerged';
    expect(await githubOutcomeIsCurrent(input, request)).toBe(true);
  });
});
