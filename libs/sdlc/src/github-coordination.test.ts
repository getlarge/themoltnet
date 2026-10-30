import { describe, expect, it } from 'vitest';

import {
  approvalAfterBrief,
  type ApprovalEvent,
  createGithubIssueTransport,
  type GithubIssueSnapshot,
  type GithubIssueTransport,
  issueDigest,
  syncGithubStage,
} from './github-coordination.js';

function fixture() {
  const issue: GithubIssueSnapshot = {
    state: 'open',
    title: 'Fix docs',
    body: 'Acceptance criteria',
    labels: ['bug', 'stage:delivery'],
  };
  const writes: string[] = [];
  const transport: GithubIssueTransport = {
    readIssue: () => Promise.resolve({ ...issue, labels: [...issue.labels] }),
    addLabels: (labels) => {
      writes.push('add');
      issue.labels = [...new Set([...issue.labels, ...labels])];
      return Promise.resolve();
    },
    removeLabel: (label) => {
      writes.push(`remove:${label}`);
      issue.labels = issue.labels.filter((item) => item !== label);
      return Promise.resolve();
    },
  };
  const input = {
    stage: 'review',
    policy: { stages: { delivery: 'stage:delivery', review: 'stage:review' } },
    expectedIssueDigest: issueDigest(issue),
    stopLabels: ['agent:pause'],
  };
  return { issue, writes, transport, input };
}

describe('GitHub stage synchronization', () => {
  it('preserves unrelated labels and makes a repeated handoff a no-op', async () => {
    const { issue, writes, transport, input } = fixture();
    expect(await syncGithubStage(transport, input)).toBe('synced');
    expect(issue.labels).toEqual(['bug', 'stage:review']);
    const count = writes.length;
    expect(await syncGithubStage(transport, input)).toBe('synced');
    expect(writes).toHaveLength(count);
  });
  it('reconciles a crash after GitHub accepted a mutation but before acknowledgement', async () => {
    const { issue, writes, transport, input } = fixture();
    const add = transport.addLabels.bind(transport);
    transport.addLabels = async (labels) => {
      await add(labels);
      throw new Error('Connection lost after write');
    };
    await expect(syncGithubStage(transport, input)).rejects.toThrow(
      'Connection lost',
    );
    transport.addLabels = add;
    expect(await syncGithubStage(transport, input)).toBe('synced');
    expect(writes.filter((write) => write === 'add')).toHaveLength(1);
    expect(issue.labels).toEqual(['bug', 'stage:review']);
  });
  it('observes a pause between mutations and does not erase it', async () => {
    const { issue, transport, input, writes } = fixture();
    const add = transport.addLabels.bind(transport);
    transport.addLabels = async (labels) => {
      await add(labels);
      issue.labels.push('agent:pause');
    };
    expect(await syncGithubStage(transport, input)).toBe('superseded');
    expect(writes).toEqual(['add']);
    expect(issue.labels).toContain('agent:pause');
  });
  it('does not publish progress for an edited issue', async () => {
    const { issue, transport, input, writes } = fixture();
    issue.body = 'Different acceptance criteria';
    expect(await syncGithubStage(transport, input)).toBe('superseded');
    expect(writes).toEqual([]);
  });
  it('detects a concurrent label edit in its final read', async () => {
    const { issue, transport, input } = fixture();
    const remove = transport.removeLabel.bind(transport);
    transport.removeLabel = async (label) => {
      await remove(label);
      issue.labels = ['bug'];
    };
    expect(await syncGithubStage(transport, input)).toBe('interrupted');
  });
  it('rejects policy that would remove a human control label', async () => {
    const { transport, input } = fixture();
    input.stopLabels = ['stage:delivery'];
    await expect(syncGithubStage(transport, input)).rejects.toThrow(
      'Control labels',
    );
  });
});

describe('approval timeline', () => {
  const brief = {
    presentedAt: '2026-10-29T10:00:00Z',
    issueDigest: 'issue-1',
    briefDigest: 'brief-1',
  };
  const current = { issueDigest: 'issue-1', labelPresent: true };
  const event: ApprovalEvent = {
    id: '1',
    action: 'labeled',
    createdAt: '2026-10-29T10:00:01Z',
    authorized: true,
  };
  it('binds an authorized event after presentation to the approved brief', () => {
    expect(approvalAfterBrief([event], brief, current)).toEqual({
      authorized: true,
      eventId: '1',
      briefDigest: 'brief-1',
    });
  });
  it.each([
    { createdAt: '2026-10-29T09:59:59Z' },
    { createdAt: brief.presentedAt },
    { createdAt: 'invalid' },
    { authorized: false },
    { action: 'unlabeled' as const },
  ])('rejects stale or invalid event %j', (override) => {
    expect(
      approvalAfterBrief([{ ...event, ...override }], brief, current),
    ).toBeUndefined();
  });
  it('does not resurrect an approval removed and reapplied by an unauthorized actor', () => {
    expect(
      approvalAfterBrief(
        [event, { ...event, id: '2', authorized: false }],
        brief,
        current,
      ),
    ).toBeUndefined();
  });
  it('rejects changed contents or a removed admission label', () => {
    expect(
      approvalAfterBrief([event], brief, { ...current, issueDigest: 'edited' }),
    ).toBeUndefined();
    expect(
      approvalAfterBrief([event], brief, { ...current, labelPresent: false }),
    ).toBeUndefined();
  });
});

describe('GitHub API binding', () => {
  it('normalizes issue data and uses granular label endpoints', async () => {
    const calls: unknown[] = [];
    const transport = createGithubIssueTransport(
      (path, method, body) => {
        calls.push({ path, method, body });
        return Promise.resolve({
          state: 'open',
          title: 'Fix',
          body: null,
          labels: [{ name: 'bug' }],
        });
      },
      'example/repo',
      42,
    );
    expect(await transport.readIssue()).toEqual({
      state: 'open',
      title: 'Fix',
      body: '',
      labels: ['bug'],
    });
    await transport.addLabels(['stage:review']);
    await transport.removeLabel('stage:delivery');
    expect(calls).toEqual([
      { path: '/repos/example/repo/issues/42', method: 'GET', body: undefined },
      {
        path: '/repos/example/repo/issues/42/labels',
        method: 'POST',
        body: { labels: ['stage:review'] },
      },
      {
        path: '/repos/example/repo/issues/42/labels/stage%3Adelivery',
        method: 'DELETE',
        body: undefined,
      },
    ]);
  });
  it('rejects PRs and malformed responses before deriving admission state', async () => {
    const transport = createGithubIssueTransport(
      () =>
        Promise.resolve({
          state: 'open',
          title: 'PR',
          body: '',
          labels: [],
          pull_request: {},
        }),
      'example/repo',
      42,
    );
    await expect(transport.readIssue()).rejects.toThrow('Invalid GitHub issue');
  });
});
