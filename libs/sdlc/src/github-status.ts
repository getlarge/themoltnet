import { createHash } from 'node:crypto';

import {
  createGithubIssueTransport,
  type GithubRequest,
  syncGithubStage,
  type SyncStageInput,
} from './github-coordination.js';

/** A maintained projection, serialized by the durable owner, never a lock. */
export async function publishGithubStatus(input: {
  request: GithubRequest;
  repository: string;
  issueNumber: number;
  appUserId: number;
  caseKey: string;
  body: string;
  projection: SyncStageInput;
  /** Must check the approved generation and PR revision, not just issue labels. */
  isCurrent(): Promise<boolean>;
}): Promise<{ published: boolean; commentId?: number; updatedAt?: string }> {
  const transport = createGithubIssueTransport(
    input.request,
    input.repository,
    input.issueNumber,
  );
  if (
    !input.caseKey ||
    !Number.isSafeInteger(input.appUserId) ||
    input.appUserId <= 0
  )
    throw new Error('Invalid status owner');
  const marker = `<!-- moltnet:sdlc:${createHash('sha256').update(input.caseKey).digest('hex')} -->`;
  const body = `${marker}\n${input.body}`;
  const path = `/repos/${input.repository}/issues/${input.issueNumber}/comments`;
  let comment: ReturnType<typeof readComment> | undefined;
  for (let page = 1; ; page += 1) {
    if (page > 20) throw new Error('Incomplete status comment history');
    const response = await input.request(
      `${path}?per_page=100&page=${page}`,
      'GET',
    );
    if (!Array.isArray(response) || response.length > 100)
      throw new Error('Invalid issue comments');
    for (const value of response) {
      const item = readComment(value);
      if (
        item.userId !== input.appUserId ||
        !item.body.startsWith(`${marker}\n`)
      )
        continue;
      if (comment) throw new Error('Multiple owned SDLC status comments');
      comment = item;
    }
    if (response.length < 100) break;
  }
  if (!(await input.isCurrent())) return { published: false };
  const labels = await syncGithubStage(transport, input.projection);
  if (labels !== 'synced' || !(await input.isCurrent()))
    return { published: false };
  if (comment?.body !== body) {
    const response = await input.request(
      comment
        ? `/repos/${input.repository}/issues/comments/${comment.id}`
        : path,
      comment ? 'PATCH' : 'POST',
      { body },
    );
    const written = readComment(response);
    if (
      written.userId !== input.appUserId ||
      written.body !== body ||
      (comment && written.id !== comment.id)
    )
      throw new Error('Status publication mismatch');
    comment = written;
  }
  if (!comment) throw new Error('Missing status comment receipt');
  return {
    published: await input.isCurrent(),
    commentId: comment.id,
    ...(comment.updatedAt ? { updatedAt: comment.updatedAt } : {}),
  };
}

function readComment(value: unknown): {
  id: number;
  body: string;
  userId: number;
  updatedAt?: string;
} {
  if (
    !value ||
    typeof value !== 'object' ||
    !('id' in value) ||
    typeof value.id !== 'number' ||
    !Number.isSafeInteger(value.id) ||
    !('body' in value) ||
    typeof value.body !== 'string' ||
    !('user' in value) ||
    !value.user ||
    typeof value.user !== 'object' ||
    !('id' in value.user) ||
    typeof value.user.id !== 'number'
  )
    throw new Error('Invalid GitHub comment response');
  return {
    id: value.id,
    body: value.body,
    userId: value.user.id,
    ...('updated_at' in value &&
    typeof value.updated_at === 'string' &&
    Number.isFinite(Date.parse(value.updated_at))
      ? { updatedAt: value.updated_at }
      : {}),
  };
}
