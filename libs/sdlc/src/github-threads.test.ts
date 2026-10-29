import { describe, expect, it, vi } from 'vitest';

import type { GithubRequest } from './github-coordination.js';
import { readGithubHumanThreads } from './github-threads.js';

function conn(nodes: unknown[], next: string | null = null) {
  return { nodes, pageInfo: { hasNextPage: Boolean(next), endCursor: next } };
}
const comment = (kind: string) => ({ author: { __typename: kind } });
function fixture() {
  const threads = [
    { id: '1', isResolved: false, comments: conn([comment('Bot')]) },
  ];
  const pull = {
    state: 'OPEN',
    headRefOid: 'head',
    baseRefOid: 'base',
    reviewThreads: conn(threads),
  };
  const request = vi
    .fn<GithubRequest>()
    .mockResolvedValue({ data: { repository: { pullRequest: pull } } });
  const input = {
    request,
    repository: 'owner/repo',
    pr: 1,
    revision: {
      base: 'base',
      head: 'head',
      policyDigest: 'policy',
      briefDigest: 'brief',
    },
  };
  return { input, request, pull, threads };
}
describe('human conversation evidence', () => {
  it('does not count bot-only or resolved conversations', async () => {
    const { input, threads } = fixture();
    threads.push({
      id: '2',
      isResolved: true,
      comments: conn([comment('User')]),
    });
    expect(await readGithubHumanThreads(input)).toBe(0);
  });
  it('counts human replies to a bot thread on later comment pages', async () => {
    const { input, request, pull, threads } = fixture();
    threads[0].comments = conn([comment('Bot')], 'later');
    request
      .mockResolvedValueOnce({ data: { repository: { pullRequest: pull } } })
      .mockResolvedValueOnce({
        data: { node: { id: '1', comments: conn([comment('User')]) } },
      });
    expect(await readGithubHumanThreads(input)).toBe(1);
  });
  it('counts deleted authors conservatively', async () => {
    const { input, threads } = fixture();
    threads[0].comments = conn([{ author: null }]);
    expect(await readGithubHumanThreads(input)).toBe(1);
  });
  it('returns incomplete when revision changes or pagination cannot finish', async () => {
    const { input, threads, pull } = fixture();
    threads[0].comments = conn([comment('Bot')], 'later');
    expect(
      await readGithubHumanThreads({ ...input, maxPages: 1 }),
    ).toBeUndefined();
    pull.headRefOid = 'new';
    expect(await readGithubHumanThreads(input)).toBeUndefined();
  });
  it('rejects GraphQL errors rather than interpreting them as no threads', async () => {
    const { input, request } = fixture();
    request.mockResolvedValue({ errors: [{ message: 'denied' }] });
    await expect(readGithubHumanThreads(input)).rejects.toThrow('query failed');
  });
});
