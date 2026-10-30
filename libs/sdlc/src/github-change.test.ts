import { describe, expect, it, vi } from 'vitest';

import { githubPullRequestNumber, verifyGithubDraft } from './github-change.js';
import type { GithubRequest } from './github-coordination.js';

function fixture() {
  const pr = {
    state: 'open',
    draft: true,
    merged: false,
    changed_files: 1,
    head: { sha: 'head', ref: 'agent/docs', repo: { full_name: 'owner/repo' } },
    base: { sha: 'base', ref: 'main', repo: { full_name: 'owner/repo' } },
  };
  const files = [{ filename: 'docs/example.md', status: 'modified' }];
  const request = vi
    .fn<GithubRequest>()
    .mockImplementation((path) =>
      Promise.resolve(path.includes('/files?') ? files : pr),
    );
  const input = {
    request,
    repository: 'owner/repo',
    pr: 42,
    expectedHead: 'head',
    expectedBranch: 'agent/docs',
    baseBranch: 'main',
    allowedPaths: ['docs/'],
    protectedPaths: ['docs/private/'],
  };
  return { input, request, pr, files };
}

describe('GitHub draft delivery gate', () => {
  it('accepts only the current draft and complete allowed file set', async () => {
    const { input } = fixture();
    expect(await verifyGithubDraft(input)).toEqual({
      base: 'base',
      head: 'head',
    });
  });
  it.each(['docs/private/secret.md', 'apps/auth.ts', 'docs/../apps/auth.ts'])(
    'rejects out-of-policy path %s',
    async (filename) => {
      const { input, files } = fixture();
      files[0].filename = filename;
      expect(await verifyGithubDraft(input)).toBeUndefined();
    },
  );
  it('checks the old path of a rename as well as its destination', async () => {
    const { input, request, pr } = fixture();
    request.mockResolvedValueOnce(pr).mockResolvedValueOnce([
      {
        filename: 'docs/example.md',
        status: 'renamed',
        previous_filename: 'apps/auth.ts',
      },
    ]);
    expect(await verifyGithubDraft(input)).toBeUndefined();
  });
  it('rejects a fork or a non-draft PR', async () => {
    const { input, pr } = fixture();
    pr.head.repo.full_name = 'someone/fork';
    expect(await verifyGithubDraft(input)).toBeUndefined();
    pr.head.repo.full_name = 'owner/repo';
    pr.draft = false;
    expect(await verifyGithubDraft(input)).toBeUndefined();
  });
  it('rejects incomplete file coverage and revision changes during pagination', async () => {
    const { input, request, pr, files } = fixture();
    pr.changed_files = 2;
    expect(await verifyGithubDraft(input)).toBeUndefined();
    pr.changed_files = 1;
    request
      .mockResolvedValueOnce(pr)
      .mockResolvedValueOnce(files)
      .mockResolvedValueOnce({ ...pr, head: { ...pr.head, sha: 'new' } });
    expect(await verifyGithubDraft(input)).toBeUndefined();
  });
});

describe('GitHub PR links', () => {
  it('matches repository names case-insensitively', () => {
    expect(
      githubPullRequestNumber(
        'https://github.com/Owner/Repo/pull/42',
        'owner/repo',
      ),
    ).toBe(42);
  });
  it.each([
    'invalid',
    'https://github.com/other/repo/pull/42',
    'https://github.com/owner/repo/pull/42/files',
    'https://github.com/owner/repo/pull/9007199254740992',
    'https://user@github.com/owner/repo/pull/42',
    'https://example.com/owner/repo/pull/42',
  ])('rejects %s', (url) => {
    expect(githubPullRequestNumber(url, 'owner/repo')).toBeUndefined();
  });
});
