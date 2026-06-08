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
  return execFileSync('gh', args, {
    encoding: 'utf8',
    cwd: options.cwd,
    env: {
      ...(options.env ?? {}),
      ...(options.token ? { GH_TOKEN: options.token } : {}),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function runGhJson<T>(
  args: string[],
  options: { token?: string; cwd?: string; env?: NodeJS.ProcessEnv },
): T {
  const raw = runGh(args, options);
  return JSON.parse(raw) as T;
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
    runGh(
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
    runGh(
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
    runGh(
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
