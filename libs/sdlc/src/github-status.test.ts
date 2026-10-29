import { describe, expect, it } from 'vitest';

import { type GithubRequest, issueDigest } from './github-coordination.js';
import { publishGithubStatus } from './github-status.js';

function fixture() {
  const issue = {
    state: 'open',
    title: 'Brief',
    body: 'Criteria',
    labels: ['bug'],
  };
  const comments: { id: number; body: string; user: { id: number } }[] = [];
  let loseAcknowledgement = false;
  let posts = 0;
  let patches = 0;
  const request: GithubRequest = (path, method, body) => {
    if (method === 'GET')
      return Promise.resolve(path.includes('/comments?') ? comments : issue);
    if (path.endsWith('/labels')) {
      issue.labels.push(...(body as { labels: string[] }).labels);
      return Promise.resolve({});
    }
    if (method === 'DELETE') {
      const label = decodeURIComponent(path.split('/').at(-1) ?? '');
      issue.labels = issue.labels.filter((value) => value !== label);
      return Promise.resolve({});
    }
    const content = (body as { body: string }).body;
    if (method === 'POST') {
      posts += 1;
      const comment = {
        id: comments.length + 1,
        body: content,
        user: { id: 42 },
      };
      comments.push(comment);
      if (loseAcknowledgement) {
        loseAcknowledgement = false;
        return Promise.reject(new Error('lost acknowledgement'));
      }
      return Promise.resolve(comment);
    }
    patches += 1;
    const comment = comments.find(
      (item) => String(item.id) === path.split('/').at(-1),
    );
    if (!comment) throw new Error('Unknown comment');
    comment.body = content;
    return Promise.resolve(comment);
  };
  const input = {
    request,
    repository: 'owner/repo',
    issueNumber: 1,
    appUserId: 42,
    caseKey: 'owner/repo#1:generation',
    body: 'Stage: delivery',
    isCurrent: () => Promise.resolve(true),
    projection: {
      stage: 'delivery',
      policy: { stages: { delivery: 'stage:delivery', ready: 'stage:ready' } },
      expectedIssueDigest: issueDigest(issue),
      stopLabels: ['paused'],
    },
  };
  return {
    input,
    comments,
    issue,
    loseNextAcknowledgement: () => {
      loseAcknowledgement = true;
    },
    counts: () => ({ posts, patches }),
  };
}

describe('GitHub maintained status projection', () => {
  it('reconciles a lost create acknowledgement without a second comment', async () => {
    const { input, comments, counts, loseNextAcknowledgement } = fixture();
    loseNextAcknowledgement();
    await expect(publishGithubStatus(input)).rejects.toThrow(
      'lost acknowledgement',
    );
    expect(await publishGithubStatus(input)).toEqual({
      published: true,
      commentId: 1,
    });
    expect(comments).toHaveLength(1);
    expect(counts()).toEqual({ posts: 1, patches: 0 });
  });
  it('updates the same comment and only the configured stage labels', async () => {
    const { input, issue, counts } = fixture();
    await publishGithubStatus(input);
    await publishGithubStatus({
      ...input,
      body: 'Stage: ready for human review',
      projection: { ...input.projection, stage: 'ready' },
    });
    expect(counts()).toEqual({ posts: 1, patches: 1 });
    expect(issue.labels).toEqual(['bug', 'stage:ready']);
  });
  it('does not adopt a matching marker posted by another actor', async () => {
    const { input, comments, counts } = fixture();
    await publishGithubStatus(input);
    comments[0].user.id = 99;
    await publishGithubStatus(input);
    expect(counts()).toEqual({ posts: 2, patches: 0 });
  });
  it('does not publish stale or paused work', async () => {
    const { input, issue, counts } = fixture();
    expect(
      await publishGithubStatus({
        ...input,
        isCurrent: () => Promise.resolve(false),
      }),
    ).toEqual({ published: false });
    issue.labels.push('paused');
    expect(await publishGithubStatus(input)).toEqual({ published: false });
    expect(counts().posts).toBe(0);
  });
});
