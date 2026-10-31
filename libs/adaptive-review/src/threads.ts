import { GitHubApi } from '@moltnet/docs-impact-review/github-api';

import { parseFindingMarker } from './report.js';

/** One review thread as GraphQL `reviewThreads` returns it. */
export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line?: number | null;
  diffSide?: 'LEFT' | 'RIGHT';
  resolvedBy: { login: string } | null;
  comments: {
    nodes: Array<{
      author: { login: string } | null;
      authorAssociation?: string;
      body: string;
      url: string;
      originalCommit: { oid: string } | null;
    }>;
  };
}

export type GraphQL = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<unknown>;

/** GraphQL bot logins omit the `[bot]` suffix that REST logins carry. */
export function sameLogin(a: string, b: string): boolean {
  const bare = (login: string) => login.replace(/\[bot\]$/, '').toLowerCase();
  return bare(a) === bare(b);
}

/** Whether the reviewer opened the thread; its first comment is the finding. */
export function isReviewerThread(
  thread: ReviewThread,
  appLogin: string,
): boolean {
  const author = thread.comments.nodes[0]?.author;
  return Boolean(author && sameLogin(author.login, appLogin));
}

const THREADS_QUERY = `query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          diffSide
          resolvedBy { login }
          comments(first: 50) {
            nodes { author { login } authorAssociation body url originalCommit { oid } }
          }
        }
      }
    }
  }
}`;

export async function fetchReviewThreads(
  graphql: GraphQL,
  repo: string,
  pr: number,
): Promise<ReviewThread[]> {
  const [owner, name] = repo.split('/');
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  do {
    const data = (await graphql(THREADS_QUERY, {
      owner,
      repo: name,
      pr,
      cursor,
    })) as {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: ReviewThread[];
          };
        } | null;
      } | null;
    };
    const page = data.repository?.pullRequest?.reviewThreads;
    if (!page) throw new Error(`pull request ${repo}#${pr} was not found`);
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

/**
 * A GraphQL client for the job's token. GitHub Enterprise serves GraphQL
 * outside the REST prefix, so the endpoint comes from `GITHUB_GRAPHQL_URL`.
 */
export function createGraphQL(
  token: string,
  graphqlUrl = 'https://api.github.com/graphql',
): GraphQL {
  const api = new GitHubApi({
    token,
    apiUrl: graphqlUrl.replace(/\/graphql$/, ''),
  });
  return async (query, variables) => {
    const response = await api.request<{
      data?: unknown;
      errors?: Array<{ message?: string }>;
    }>('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    if (response.errors?.length)
      throw new Error(
        `GitHub GraphQL failed: ${response.errors.map((e) => e.message).join('; ')}`,
      );
    return response.data;
  };
}

/** Historical discussion is untrusted evidence, not reviewer instructions. */
export interface PreviousFinding {
  key: string;
  lane: 'tests' | 'conventions' | 'blast-radius' | 'performance';
  path: string;
  line: number | null;
  side: 'old' | 'new' | null;
  threadId: string;
  url: string;
  head: string | null;
  isResolved: boolean;
  isOutdated: boolean;
  body: string;
  replies: Array<{ author: string | null; body: string }>;
}

/** Retain every open finding for accounting; bound resolved historical context. */
export function previousFindings(
  threads: readonly ReviewThread[],
  appLogin: string,
): PreviousFinding[] {
  const counts = new Map<string, number>();
  const seen = new Set<string>();
  // GitHub returns threads in creation order. Keep recent open discussion
  // before resolved history when a lane exceeds the prompt budget.
  const ordered = [...threads]
    .reverse()
    .sort((a, b) => Number(a.isResolved) - Number(b.isResolved));
  return ordered.flatMap((thread): PreviousFinding[] => {
    if (!appLogin || !isReviewerThread(thread, appLogin)) return [];
    const first = thread.comments.nodes[0];
    const marker = parseFindingMarker(first.body);
    const lane = marker?.key.split(':')[0];
    if (
      !marker ||
      (lane !== 'tests' &&
        lane !== 'conventions' &&
        lane !== 'blast-radius' &&
        lane !== 'performance')
    )
      return [];
    if (seen.has(marker.key)) return [];
    seen.add(marker.key);
    if (thread.isResolved && (counts.get(lane) ?? 0) >= 20) return [];
    counts.set(lane, (counts.get(lane) ?? 0) + 1);
    return [
      {
        key: marker.key,
        lane,
        path: thread.path,
        line: thread.line ?? null,
        side:
          thread.diffSide === 'LEFT'
            ? 'old'
            : thread.diffSide === 'RIGHT'
              ? 'new'
              : null,
        threadId: thread.id,
        url: first.url,
        head: first.originalCommit?.oid ?? null,
        isResolved: thread.isResolved,
        isOutdated: thread.isOutdated,
        body: first.body.slice(0, 4000),
        replies: thread.comments.nodes
          .slice(1)
          .filter((comment) =>
            Boolean(
              comment.author &&
              (sameLogin(comment.author.login, appLogin) ||
                ['OWNER', 'MEMBER', 'COLLABORATOR'].includes(
                  comment.authorAssociation ?? '',
                )),
            ),
          )
          .slice(-3)
          .map((comment) => ({
            author: comment.author?.login ?? null,
            body: comment.body.slice(0, 1000),
          })),
      },
    ];
  });
}
