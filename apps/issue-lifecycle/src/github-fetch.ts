import type {
  GithubClient,
  GithubIssue,
  GithubIssueComment,
  PullRequestStatus,
} from './types.js';

export type GithubTokenProvider = (options?: {
  forceRefresh?: boolean;
}) => Promise<string>;

interface GithubFetchClientOptions {
  token?: string;
  tokenProvider?: GithubTokenProvider;
  apiBaseUrl?: string;
  retryDelayMs?: number;
}

interface GithubIssueJson {
  number: number;
  title: string;
  body?: string | null;
  labels?: Array<string | { name?: string | null }>;
}

interface GithubIssueCommentJson {
  id: number;
  body?: string | null;
}

interface PullRequestGraphqlResponse {
  data?: {
    repository?: {
      pullRequest?: {
        number: number;
        url: string;
        state: string;
        mergedAt?: string | null;
        statusCheckRollup?: {
          nodes?: Array<{
            conclusion?: string | null;
            status?: string | null;
            state?: string | null;
          } | null> | null;
        } | null;
      } | null;
    } | null;
  };
  errors?: Array<{ message?: string }>;
}

class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'GithubApiError';
  }
}

function splitRepo(repo: string): { owner: string; name: string } {
  const [owner, name] = repo.split('/');
  if (!owner || !name) throw new Error(`invalid GitHub repo "${repo}"`);
  return { owner, name };
}

function encodeRepoPath(repo: string): string {
  const { owner, name } = splitRepo(repo);
  return `${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
}

function normalizeLabel(label: string | { name?: string | null }): string {
  return typeof label === 'string' ? label : (label.name ?? '');
}

function checksConclusion(
  checks: Array<{
    conclusion?: string | null;
    status?: string | null;
    state?: string | null;
  }>,
): PullRequestStatus['checks'] {
  if (checks.length === 0) return 'pending';
  if (
    checks.some((check) =>
      [
        'FAILURE',
        'TIMED_OUT',
        'CANCELLED',
        'ACTION_REQUIRED',
        'ERROR',
      ].includes(check.conclusion ?? check.state ?? ''),
    )
  ) {
    return 'failure';
  }
  if (
    checks.every((check) =>
      ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(
        check.conclusion ?? check.state ?? '',
      ),
    )
  ) {
    return 'success';
  }
  return 'pending';
}

function isRetryableStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

function isNetworkFailure(error: unknown): boolean {
  if (error instanceof GithubApiError) return isRetryableStatus(error.status);
  return error instanceof TypeError;
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

export class FetchGithubClient implements GithubClient {
  private readonly apiBaseUrl: string;
  private readonly retryDelayMs: number;

  constructor(private readonly options: GithubFetchClientOptions) {
    this.apiBaseUrl = options.apiBaseUrl ?? 'https://api.github.com';
    this.retryDelayMs = options.retryDelayMs ?? 250;
  }

  async getIssue(repo: string, issueNumber: number): Promise<GithubIssue> {
    const issue = await this.githubJson<GithubIssueJson>(
      `/repos/${encodeRepoPath(repo)}/issues/${issueNumber}`,
    );
    return {
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      labels: (issue.labels ?? []).map(normalizeLabel).filter(Boolean),
    };
  }

  async listIssueComments(
    repo: string,
    issueNumber: number,
  ): Promise<GithubIssueComment[]> {
    const comments = await this.githubJson<GithubIssueCommentJson[]>(
      `/repos/${encodeRepoPath(repo)}/issues/${issueNumber}/comments`,
    );
    return comments.map((comment) => ({
      id: comment.id,
      body: comment.body ?? '',
    }));
  }

  async createIssueComment(
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    await this.githubJson(
      `/repos/${encodeRepoPath(repo)}/issues/${issueNumber}/comments`,
      {
        method: 'POST',
        body: JSON.stringify({ body }),
      },
    );
  }

  async updateIssueComment(
    repo: string,
    commentId: number,
    body: string,
  ): Promise<void> {
    await this.githubJson(
      `/repos/${encodeRepoPath(repo)}/issues/comments/${commentId}`,
      {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      },
    );
  }

  async addIssueLabel(
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void> {
    await this.githubJson(
      `/repos/${encodeRepoPath(repo)}/issues/${issueNumber}/labels`,
      {
        method: 'POST',
        body: JSON.stringify({ labels: [label] }),
      },
    );
  }

  async hasIssueLabel(
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<boolean> {
    const issue = await this.getIssue(repo, issueNumber);
    return issue.labels.includes(label);
  }

  async getPullRequest(
    repo: string,
    prNumber: number,
  ): Promise<PullRequestStatus> {
    const { owner, name } = splitRepo(repo);
    const response = await this.githubJson<PullRequestGraphqlResponse>(
      '/graphql',
      {
        method: 'POST',
        body: JSON.stringify({
          query: `query IssueLifecyclePullRequest($owner: String!, $name: String!, $number: Int!) {
            repository(owner: $owner, name: $name) {
              pullRequest(number: $number) {
                number
                url
                state
                mergedAt
                statusCheckRollup(first: 100) {
                  nodes {
                    ... on CheckRun { conclusion status }
                    ... on StatusContext { state }
                  }
                }
              }
            }
          }`,
          variables: { owner, name, number: prNumber },
        }),
      },
    );
    if (response.errors?.length) {
      throw new Error(
        `GitHub GraphQL error: ${response.errors
          .map((error) => error.message ?? 'unknown error')
          .join('; ')}`,
      );
    }
    const pr = response.data?.repository?.pullRequest;
    if (!pr)
      throw new Error(`GitHub pull request not found: ${repo}#${prNumber}`);
    return {
      number: pr.number,
      url: pr.url,
      merged:
        pr.state === 'MERGED' ||
        (pr.mergedAt !== undefined && pr.mergedAt !== null),
      checks: checksConclusion(
        (pr.statusCheckRollup?.nodes ?? []).filter(
          (node): node is NonNullable<typeof node> => Boolean(node),
        ),
      ),
    };
  }

  private async githubJson<T = unknown>(
    path: string,
    init: RequestInit = {},
  ): Promise<T> {
    const response = await this.githubFetch(path, init);
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  private async githubFetch(
    path: string,
    init: RequestInit,
    attempt = 1,
    forceRefresh = false,
  ): Promise<Response> {
    const token =
      this.options.token ??
      (await this.options.tokenProvider?.({ forceRefresh }));
    if (!token) {
      throw new Error(
        'GitHub token unavailable; configure moltnet GitHub credentials, GH_TOKEN/GITHUB_TOKEN, or --github-auth gh-cli',
      );
    }
    try {
      const response = await fetch(`${this.apiBaseUrl}${path}`, {
        ...init,
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.headers ?? {}),
        },
      });
      if (
        response.status === 401 &&
        this.options.tokenProvider &&
        !forceRefresh
      ) {
        return await this.githubFetch(path, init, attempt, true);
      }
      if (!response.ok) {
        throw new GithubApiError(
          `GitHub API error (${response.status}): ${await response.text()}`,
          response.status,
        );
      }
      return response;
    } catch (error) {
      if (attempt >= 3 || !isNetworkFailure(error)) throw error;
      await sleep(this.retryDelayMs * attempt);
      return this.githubFetch(path, init, attempt + 1, forceRefresh);
    }
  }
}
