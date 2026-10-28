import { GitHubApi } from '@moltnet/docs-impact-review/github-api';

/** One review thread as GraphQL `reviewThreads` returns it. */
export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  resolvedBy: { login: string } | null;
  comments: {
    nodes: Array<{
      author: { login: string } | null;
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
          resolvedBy { login }
          comments(first: 50) {
            nodes { author { login } body url originalCommit { oid } }
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
