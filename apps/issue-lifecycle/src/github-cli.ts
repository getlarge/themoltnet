import type { ExecFileSyncOptionsWithStringEncoding } from 'node:child_process';
import { execFileSync } from 'node:child_process';

import type {
  GithubClient,
  GithubIssue,
  GithubIssueComment,
  PullRequestStatus,
} from './types.js';

interface GhIssueJson {
  number: number;
  title: string;
  body?: string;
  labels?: Array<{ name: string }>;
}

interface GhPrJson {
  number: number;
  url: string;
  state: string;
  mergedAt?: string | null;
  statusCheckRollup?: Array<{ conclusion?: string | null; status?: string }>;
}

interface GhIssueCommentJson {
  id: number;
  body?: string;
}

function runGh(
  args: string[],
  options: { token?: string; cwd?: string; env?: NodeJS.ProcessEnv },
): string {
  const env = { ...(options.env ?? {}) };
  if (options.token) {
    env.GH_TOKEN = options.token;
    env.GITHUB_TOKEN = options.token;
  }
  return execFileSync('gh', args, {
    encoding: 'utf8',
    cwd: options.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  } satisfies ExecFileSyncOptionsWithStringEncoding);
}

function errorText(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const maybeOutput = error as Error & {
    stderr?: Buffer | string;
    stdout?: Buffer | string;
  };
  return [
    error.message,
    maybeOutput.stderr?.toString() ?? '',
    maybeOutput.stdout?.toString() ?? '',
  ].join('\n');
}

function isGhAuthError(error: unknown): boolean {
  const text = errorText(error);
  return (
    text.includes('HTTP 401') ||
    text.includes('Bad credentials') ||
    text.includes('Try authenticating with:  gh auth login')
  );
}

function runGhJson<T>(
  args: string[],
  options: {
    token?: string;
    tokenProvider?: () => string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): T {
  const raw = runGhWithAuth(args, options);
  return JSON.parse(raw) as T;
}

function runGhWithAuth(
  args: string[],
  options: {
    token?: string;
    tokenProvider?: () => string;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
  },
): string {
  const token = options.token ?? options.tokenProvider?.();
  try {
    return runGh(args, { ...options, token });
  } catch (error) {
    if (!options.tokenProvider || !isGhAuthError(error)) throw error;
    const refreshedToken = options.tokenProvider();
    return runGh(args, { ...options, token: refreshedToken });
  }
}

function checksConclusion(pr: GhPrJson): PullRequestStatus['checks'] {
  const checks = pr.statusCheckRollup ?? [];
  if (checks.length === 0) return 'pending';
  if (
    checks.some(
      (check) =>
        check.conclusion === 'FAILURE' ||
        check.conclusion === 'TIMED_OUT' ||
        check.conclusion === 'CANCELLED' ||
        check.conclusion === 'ACTION_REQUIRED',
    )
  ) {
    return 'failure';
  }
  if (
    checks.every(
      (check) =>
        check.conclusion === 'SUCCESS' ||
        check.conclusion === 'NEUTRAL' ||
        check.conclusion === 'SKIPPED',
    )
  ) {
    return 'success';
  }
  return 'pending';
}

export class GhCliGithubClient implements GithubClient {
  constructor(
    private readonly options: {
      token?: string;
      tokenProvider?: () => string;
      cwd?: string;
      env?: NodeJS.ProcessEnv;
    } = {},
  ) {}

  getIssue(repo: string, issueNumber: number): Promise<GithubIssue> {
    const issue = runGhJson<GhIssueJson>(
      [
        'issue',
        'view',
        String(issueNumber),
        '--repo',
        repo,
        '--json',
        'number,title,body,labels',
      ],
      this.options,
    );
    return Promise.resolve({
      number: issue.number,
      title: issue.title,
      body: issue.body ?? '',
      labels: (issue.labels ?? []).map((label) => label.name),
    });
  }

  listIssueComments(
    repo: string,
    issueNumber: number,
  ): Promise<GithubIssueComment[]> {
    const comments = runGhJson<GhIssueCommentJson[]>(
      ['api', `repos/${repo}/issues/${issueNumber}/comments`],
      this.options,
    );
    return Promise.resolve(
      comments.map((comment) => ({
        id: comment.id,
        body: comment.body ?? '',
      })),
    );
  }

  createIssueComment(
    repo: string,
    issueNumber: number,
    body: string,
  ): Promise<void> {
    runGhWithAuth(
      [
        'api',
        `repos/${repo}/issues/${issueNumber}/comments`,
        '-f',
        `body=${body}`,
      ],
      this.options,
    );
    return Promise.resolve();
  }

  updateIssueComment(
    repo: string,
    commentId: number,
    body: string,
  ): Promise<void> {
    runGhWithAuth(
      [
        'api',
        `repos/${repo}/issues/comments/${commentId}`,
        '-X',
        'PATCH',
        '-f',
        `body=${body}`,
      ],
      this.options,
    );
    return Promise.resolve();
  }

  addIssueLabel(
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<void> {
    runGhWithAuth(
      [
        'api',
        `repos/${repo}/issues/${issueNumber}/labels`,
        '-f',
        `labels[]=${label}`,
      ],
      this.options,
    );
    return Promise.resolve();
  }

  async hasIssueLabel(
    repo: string,
    issueNumber: number,
    label: string,
  ): Promise<boolean> {
    const issue = await this.getIssue(repo, issueNumber);
    return issue.labels.includes(label);
  }

  getPullRequest(repo: string, prNumber: number): Promise<PullRequestStatus> {
    const pr = runGhJson<GhPrJson>(
      [
        'pr',
        'view',
        String(prNumber),
        '--repo',
        repo,
        '--json',
        'number,url,state,mergedAt,statusCheckRollup',
      ],
      this.options,
    );
    return Promise.resolve({
      number: pr.number,
      url: pr.url,
      merged:
        pr.state === 'MERGED' ||
        (pr.mergedAt !== undefined && pr.mergedAt !== null),
      checks: checksConclusion(pr),
    });
  }
}
