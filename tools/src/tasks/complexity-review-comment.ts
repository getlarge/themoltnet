import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  type PrReviewOutput,
  PrReviewOutput as PrReviewOutputSchema,
} from '@moltnet/tasks';
import { Value } from 'typebox/value';

export const COMPLEXITY_REVIEW_COMMENT_MARKER =
  '<!-- moltnet:complexity-review -->';

const FULL_GIT_OID = /^[0-9a-f]{40}$/;

export interface IssueComment {
  id: number;
  body: string | null;
  user: { type: string } | null;
}

function requireFullOid(value: string, label: string): string {
  if (!FULL_GIT_OID.test(value)) {
    throw new Error(`${label} must be a full 40-character lowercase git OID`);
  }
  return value;
}

function runDetails(args: {
  revision: string;
  runUrl: string;
  taskId?: string;
}): string {
  return [
    `Head: \`${args.revision}\``,
    `[workflow run](${args.runUrl})`,
    ...(args.taskId ? [`Task: \`${args.taskId}\``] : []),
  ].join(' · ');
}

export function renderComplexityReviewProgress(args: {
  revision: string;
  runUrl: string;
}): string {
  requireFullOid(args.revision, 'review revision');
  return (
    `${COMPLEXITY_REVIEW_COMMENT_MARKER}\n` +
    '## MoltNet complexity review\n\n' +
    `Review in progress for ${runDetails(args)}.\n\n` +
    'Any result for an earlier head is stale until this revision finishes.'
  );
}

export function renderComplexityReviewStale(args: {
  reviewedRevision: string;
  currentRevision: string;
  runUrl: string;
  taskId?: string;
}): string {
  requireFullOid(args.reviewedRevision, 'reviewed revision');
  requireFullOid(args.currentRevision, 'current revision');
  return (
    `${COMPLEXITY_REVIEW_COMMENT_MARKER}\n` +
    '## MoltNet complexity review\n\n' +
    `The result for ${runDetails({
      revision: args.reviewedRevision,
      runUrl: args.runUrl,
      taskId: args.taskId,
    })} is stale.\n\n` +
    `The pull request now points at \`${args.currentRevision}\`. ` +
    'The superseded result was not published as current guidance.'
  );
}

export function renderComplexityReviewFailure(args: {
  revision: string;
  runUrl: string;
  taskId?: string;
}): string {
  requireFullOid(args.revision, 'review revision');
  return (
    `${COMPLEXITY_REVIEW_COMMENT_MARKER}\n` +
    '## MoltNet complexity review\n\n' +
    `The review failed for ${runDetails(args)}. No complexity judgment was published.`
  );
}

export function renderComplexityReviewResult(args: {
  revision: string;
  runUrl: string;
  taskId: string;
  output: PrReviewOutput;
}): string {
  requireFullOid(args.revision, 'review revision');
  const criteria = args.output.scores
    .map(
      (score) =>
        `- **${score.criterionId}: ${score.score === 1 ? 'pass' : 'fail'}** — ` +
        score.rationale,
    )
    .join('\n');

  return (
    `${COMPLEXITY_REVIEW_COMMENT_MARKER}\n` +
    '## MoltNet complexity review\n\n' +
    `**Weighted composite:** ${args.output.composite.toFixed(2)}\n\n` +
    `**Verdict:** ${args.output.verdict}\n\n` +
    `${criteria}\n\n` +
    '_This advisory measures review burden, not correctness or code quality. ' +
    'Low scores are expected for deliberately broad or security-sensitive changes._\n\n' +
    runDetails(args)
  );
}

export function findComplexityReviewComment(
  comments: IssueComment[],
): IssueComment | undefined {
  return comments.find(
    (comment) =>
      comment.user?.type === 'Bot' &&
      comment.body?.includes(COMPLEXITY_REVIEW_COMMENT_MARKER),
  );
}

interface GitHubPullRequest {
  head: { sha: string };
}

class GitHubApi {
  constructor(
    private readonly repo: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await this.fetchImpl(`https://api.github.com${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${this.token}`,
        'content-type': 'application/json',
        'x-github-api-version': '2022-11-28',
        ...init?.headers,
      },
    });
    if (!response.ok) {
      throw new Error(
        `GitHub API ${init?.method ?? 'GET'} ${path} failed with ${response.status}`,
      );
    }
    return (await response.json()) as T;
  }

  getPullRequest(prNumber: number): Promise<GitHubPullRequest> {
    return this.request<GitHubPullRequest>(
      `/repos/${this.repo}/pulls/${prNumber}`,
    );
  }

  async listComments(prNumber: number): Promise<IssueComment[]> {
    const comments: IssueComment[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.request<IssueComment[]>(
        `/repos/${this.repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      );
      comments.push(...batch);
      if (batch.length < 100) return comments;
    }
  }

  async upsertComment(prNumber: number, body: string): Promise<void> {
    const existing = findComplexityReviewComment(
      await this.listComments(prNumber),
    );
    if (existing) {
      await this.request(`/repos/${this.repo}/issues/comments/${existing.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      return;
    }
    await this.request(`/repos/${this.repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
}

export async function updateComplexityReviewComment(args: {
  mode: 'start' | 'publish';
  repo: string;
  prNumber: number;
  reviewedRevision: string;
  runUrl: string;
  token: string;
  taskId?: string;
  reviewSucceeded?: boolean;
  resultPath?: string;
  fetchImpl?: typeof fetch;
}): Promise<'progress' | 'published' | 'stale' | 'failed'> {
  requireFullOid(args.reviewedRevision, 'reviewed revision');
  const github = new GitHubApi(args.repo, args.token, args.fetchImpl);
  const pr = await github.getPullRequest(args.prNumber);
  const currentRevision = requireFullOid(pr.head.sha, 'current revision');

  if (currentRevision !== args.reviewedRevision) {
    await github.upsertComment(
      args.prNumber,
      renderComplexityReviewStale({
        reviewedRevision: args.reviewedRevision,
        currentRevision,
        runUrl: args.runUrl,
        taskId: args.taskId,
      }),
    );
    return 'stale';
  }

  if (args.mode === 'start') {
    await github.upsertComment(
      args.prNumber,
      renderComplexityReviewProgress({
        revision: args.reviewedRevision,
        runUrl: args.runUrl,
      }),
    );
    return 'progress';
  }

  if (!args.reviewSucceeded || !args.taskId || !args.resultPath) {
    await github.upsertComment(
      args.prNumber,
      renderComplexityReviewFailure({
        revision: args.reviewedRevision,
        runUrl: args.runUrl,
        taskId: args.taskId,
      }),
    );
    return 'failed';
  }

  const output = JSON.parse(readFileSync(args.resultPath, 'utf8')) as unknown;
  if (!Value.Check(PrReviewOutputSchema, output)) {
    throw new Error('accepted task output is not a valid PrReviewOutput');
  }
  await github.upsertComment(
    args.prNumber,
    renderComplexityReviewResult({
      revision: args.reviewedRevision,
      runUrl: args.runUrl,
      taskId: args.taskId,
      output,
    }),
  );
  return 'published';
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      mode: { type: 'string' },
      repo: { type: 'string' },
      pr: { type: 'string' },
      revision: { type: 'string' },
      'run-url': { type: 'string' },
      'task-id': { type: 'string' },
      'review-succeeded': { type: 'boolean', default: false },
      'result-path': { type: 'string' },
    },
  });
  if (
    (values.mode !== 'start' && values.mode !== 'publish') ||
    !values.repo ||
    !values.pr ||
    !values.revision ||
    !values['run-url']
  ) {
    throw new Error(
      'Usage: complexity-review-comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL',
    );
  }
  const prNumber = Number(values.pr);
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error('--pr must be a positive integer');
  }
  const token = process.env.GITHUB_TOKEN?.trim();
  if (!token) throw new Error('GITHUB_TOKEN is required');

  const status = await updateComplexityReviewComment({
    mode: values.mode,
    repo: values.repo,
    prNumber,
    reviewedRevision: values.revision,
    runUrl: values['run-url'],
    token,
    taskId: values['task-id'],
    reviewSucceeded: values['review-succeeded'],
    resultPath: values['result-path'],
  });
  process.stdout.write(`${JSON.stringify({ status })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    console.error('[fatal]', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
