import { describe, expect, it, vi } from 'vitest';

import { readGithubApproval } from './github-admission.js';
import { type GithubRequest, issueDigest } from './github-coordination.js';

function fixture() {
  const issue = {
    state: 'open' as const,
    title: 'Repair docs',
    body: 'Brief',
    labels: ['approved'],
  };
  const event = {
    id: 1,
    event: 'labeled',
    label: { name: 'approved' },
    created_at: '2026-10-29T10:01:00Z',
    actor: { id: 42, login: 'reviewer' },
  };
  const request = vi.fn<GithubRequest>().mockImplementation((path) => {
    if (path.includes('/events?')) return Promise.resolve([event]);
    if (path.endsWith('/permission'))
      return Promise.resolve({ permission: 'write', user: { id: 42 } });
    return Promise.resolve(issue);
  });
  const input = {
    request,
    repository: 'owner/repo',
    issueNumber: 1,
    label: 'approved',
    brief: {
      presentedAt: '2026-10-29T10:00:00Z',
      issueDigest: issueDigest(issue),
      briefDigest: 'brief',
    },
    allowedPermissions: ['admin', 'write'] as const,
  };
  return { issue, event, request, input };
}

describe('GitHub approval ingestion', () => {
  it('binds approval to a provider event and verified actor identity', async () => {
    const { input, request } = fixture();
    expect(await readGithubApproval(input)).toEqual({
      authorized: true,
      eventId: '1',
      briefDigest: 'brief',
    });
    expect(request).toHaveBeenCalledWith(
      '/repos/owner/repo/collaborators/reviewer/permission',
      'GET',
    );
  });
  it('reads later pages before authorizing', async () => {
    const { input, request, issue, event } = fixture();
    request.mockImplementation((path) => {
      if (path.endsWith('page=1'))
        return Promise.resolve(
          Array.from({ length: 100 }, () => ({ event: 'commented' })),
        );
      if (path.endsWith('page=2')) return Promise.resolve([event]);
      if (path.endsWith('/permission'))
        return Promise.resolve({ permission: 'write', user: { id: 42 } });
      return Promise.resolve(issue);
    });
    expect(await readGithubApproval(input)).toMatchObject({ eventId: '1' });
  });
  it('fails closed when pagination is bounded before completion', async () => {
    const { input, request, issue } = fixture();
    request.mockImplementation((path) =>
      Promise.resolve(
        path.includes('/events?')
          ? Array.from({ length: 100 }, () => ({ event: 'commented' }))
          : issue,
      ),
    );
    await expect(readGithubApproval({ ...input, maxPages: 1 })).rejects.toThrow(
      'Incomplete',
    );
  });
  it('rejects a changed issue after permission lookup', async () => {
    const { input, request, issue, event } = fixture();
    request
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce([event])
      .mockResolvedValueOnce({ permission: 'write', user: { id: 42 } })
      .mockResolvedValueOnce({ ...issue, body: 'Changed' });
    expect(await readGithubApproval(input)).toBeUndefined();
  });
  it.each([
    { permission: 'read', user: { id: 42 } },
    { permission: 'write', user: { id: 99 } },
  ])(
    'rejects insufficient permission or a mismatched actor',
    async (permission) => {
      const { input, request, issue, event } = fixture();
      request
        .mockResolvedValueOnce(issue)
        .mockResolvedValueOnce([event])
        .mockResolvedValueOnce(permission)
        .mockResolvedValueOnce(issue);
      expect(await readGithubApproval(input)).toBeUndefined();
    },
  );
  it('does not mistake same-timestamp relabeling for fresh approval', async () => {
    const { input, request, issue, event } = fixture();
    request
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce([event, { ...event, id: 2, event: 'unlabeled' }]);
    await expect(readGithubApproval(input)).rejects.toThrow('Ambiguous');
  });
  it('accepts a later fresh approval after an older ambiguous relabel', async () => {
    const { input, request, issue, event } = fixture();
    request
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce([
        event,
        { ...event, id: 2, event: 'unlabeled' },
        { ...event, id: 3, created_at: '2026-10-29T10:02:00Z' },
      ])
      .mockResolvedValueOnce({ permission: 'write', user: { id: 42 } })
      .mockResolvedValueOnce(issue);
    expect(await readGithubApproval(input)).toMatchObject({ eventId: '3' });
  });
  it('rejects history whose timestamps move backwards', async () => {
    const { input, request, issue, event } = fixture();
    request
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce([
        event,
        { ...event, id: 2, created_at: '2026-10-29T09:59:00Z' },
      ]);
    await expect(readGithubApproval(input)).rejects.toThrow('Unstable');
  });
  it('rejects malformed label events instead of falling back to an older approval', async () => {
    const { input, request, issue, event } = fixture();
    request
      .mockResolvedValueOnce(issue)
      .mockResolvedValueOnce([event, { ...event, id: 2, label: null }]);
    await expect(readGithubApproval(input)).rejects.toThrow('Invalid');
  });
});
