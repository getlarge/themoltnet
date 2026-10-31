import { describe, expect, it, vi } from 'vitest';

import type { GithubRequest } from './github-coordination.js';
import { markGithubReady } from './github-ready.js';

function fixture() {
  const pull = {
    node_id: 'node',
    state: 'open',
    merged: false,
    draft: true,
    head: { sha: 'head' },
    base: { sha: 'base' },
  };
  const request = vi.fn<GithubRequest>().mockImplementation((path) => {
    if (path === '/graphql') {
      pull.draft = false;
      return Promise.resolve({
        data: {
          markPullRequestReadyForReview: {
            pullRequest: { id: 'node', isDraft: false },
          },
        },
      });
    }
    return Promise.resolve(pull);
  });
  const input = {
    request,
    repository: 'owner/repo',
    pr: 1,
    revision: {
      head: 'head',
      base: 'base',
      briefDigest: 'brief',
      policyDigest: 'policy',
    },
    key: 'operation',
    isAuthorized: vi.fn().mockResolvedValue(true),
  };
  return { input, request, pull };
}
describe('review-start mutation', () => {
  it('marks only the authorized revision ready and reconciles retry', async () => {
    const { input, request } = fixture();
    expect(await markGithubReady(input)).toBe(true);
    expect(await markGithubReady(input)).toBe(true);
    expect(
      request.mock.calls.filter(([path]) => path === '/graphql'),
    ).toHaveLength(1);
  });
  it('recovers a lost response without repeating the mutation', async () => {
    const { input, request, pull } = fixture();
    request.mockImplementation((path) => {
      if (path === '/graphql') {
        pull.draft = false;
        return Promise.reject(new Error('lost ack'));
      }
      return Promise.resolve(pull);
    });
    await expect(markGithubReady(input)).rejects.toThrow('lost ack');
    expect(await markGithubReady(input)).toBe(true);
    expect(
      request.mock.calls.filter(([path]) => path === '/graphql'),
    ).toHaveLength(1);
  });
  it('refuses stale heads and revoked authorization', async () => {
    const { input, request, pull } = fixture();
    pull.head.sha = 'new';
    expect(await markGithubReady(input)).toBe(false);
    pull.head.sha = 'head';
    input.isAuthorized.mockResolvedValue(false);
    expect(await markGithubReady(input)).toBe(false);
    expect(request.mock.calls.every(([, method]) => method === 'GET')).toBe(
      true,
    );
  });
  it('reports supersession if the head changes during the provider mutation', async () => {
    const { input, request, pull } = fixture();
    request.mockImplementation((path) => {
      if (path === '/graphql') {
        pull.head.sha = 'new';
        pull.draft = false;
        return Promise.resolve({
          data: {
            markPullRequestReadyForReview: {
              pullRequest: { id: 'node', isDraft: false },
            },
          },
        });
      }
      return Promise.resolve(pull);
    });
    expect(await markGithubReady(input)).toBe(false);
  });
});
