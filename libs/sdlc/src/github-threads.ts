import type { Revision } from './contracts.js';
import type { GithubRequest } from './github-coordination.js';

const COMMENTS = `comments(first: 100, after: $commentCursor) {
  nodes { author { __typename } }
  pageInfo { hasNextPage endCursor }
}`;

/** Count unresolved conversations containing any non-bot participant, including replies. */
export async function readGithubHumanThreads(input: {
  request: GithubRequest;
  repository: string;
  pr: number;
  revision: Revision;
  maxPages?: number;
}): Promise<number | undefined> {
  const [owner, name, extra] = input.repository.split('/');
  const maxPages = input.maxPages ?? 20;
  if (
    !owner ||
    !name ||
    extra ||
    !Number.isSafeInteger(input.pr) ||
    input.pr < 1 ||
    !Number.isSafeInteger(maxPages) ||
    maxPages < 1
  )
    throw new Error('Invalid conversation evidence binding');
  const variables = { owner, name, number: input.pr };
  const matches = (pull: Record<string, unknown>) =>
    pull.state === 'OPEN' &&
    pull.headRefOid === input.revision.head &&
    pull.baseRefOid === input.revision.base;
  const seen = new Set<string>();
  let cursor: string | null = null;
  let count = 0;
  for (let page = 0; ; page += 1) {
    if (page >= maxPages) return undefined;
    const data = await query(
      input.request,
      `query SdlcThreads($owner: String!, $name: String!, $number: Int!, $cursor: String, $commentCursor: String) {
      repository(owner: $owner, name: $name) { pullRequest(number: $number) {
        state headRefOid baseRefOid
        reviewThreads(first: 100, after: $cursor) {
          nodes { id isResolved ${COMMENTS} }
          pageInfo { hasNextPage endCursor }
        }
      } }
    }`,
      { ...variables, cursor, commentCursor: null },
    );
    const pull = object(object(data.repository).pullRequest);
    if (!matches(pull)) return undefined;
    const threads = connection(pull.reviewThreads);
    for (const value of threads.nodes) {
      const thread = object(value);
      if (
        typeof thread.id !== 'string' ||
        seen.has(thread.id) ||
        typeof thread.isResolved !== 'boolean'
      )
        throw new Error('Invalid or unstable review thread identity');
      seen.add(thread.id);
      if (thread.isResolved) continue;
      let comments = connection(thread.comments);
      let human = false;
      const cursors = new Set<string>();
      for (let commentPage = 0; ; commentPage += 1) {
        human = comments.nodes.some((value) => {
          const author = object(value).author;
          return !author || object(author).__typename !== 'Bot';
        });
        if (human || !comments.next) break;
        if (commentPage + 1 >= maxPages) return undefined;
        if (cursors.has(comments.next))
          throw new Error('Unstable comment pagination');
        cursors.add(comments.next);
        const more = await query(
          input.request,
          `query SdlcThreadComments($id: ID!, $commentCursor: String) {
          node(id: $id) { ... on PullRequestReviewThread { id ${COMMENTS} } }
        }`,
          { id: thread.id, commentCursor: comments.next },
        );
        const node = object(more.node);
        if (node.id !== thread.id)
          throw new Error('Review thread identity changed');
        comments = connection(node.comments);
      }
      if (human) count += 1;
    }
    if (!threads.next) break;
    if (threads.next === cursor)
      throw new Error('Unstable review thread pagination');
    cursor = threads.next;
  }
  const final = await query(
    input.request,
    `query SdlcThreadRevision($owner: String!, $name: String!, $number: Int!) {
    repository(owner: $owner, name: $name) { pullRequest(number: $number) { state headRefOid baseRefOid } }
  }`,
    variables,
  );
  return matches(object(object(final.repository).pullRequest))
    ? count
    : undefined;
}
async function query(request: GithubRequest, query: string, variables: object) {
  const response = object(
    await request('/graphql', 'POST', { query, variables }),
  );
  if (
    response.errors !== undefined &&
    (!Array.isArray(response.errors) || response.errors.length)
  )
    throw new Error('GitHub conversation query failed');
  return object(response.data);
}
function connection(value: unknown): { nodes: unknown[]; next: string | null } {
  const conn = object(value);
  const info = object(conn.pageInfo);
  if (
    !Array.isArray(conn.nodes) ||
    conn.nodes.length > 100 ||
    typeof info.hasNextPage !== 'boolean' ||
    (info.hasNextPage &&
      (typeof info.endCursor !== 'string' || !info.endCursor))
  )
    throw new Error('Incomplete GitHub conversation page');
  return {
    nodes: conn.nodes,
    next: info.hasNextPage ? (info.endCursor as string) : null,
  };
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid GitHub conversation response');
  return value as Record<string, unknown>;
}
