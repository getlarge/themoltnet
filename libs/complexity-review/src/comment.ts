import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { Value } from 'typebox/value';

import { githubToken } from './config.js';
import {
  type ComplexityReviewOutput,
  ComplexityReviewOutput as ComplexityReviewOutputSchema,
} from './result.js';

export const COMPLEXITY_REVIEW_COMMENT_MARKER =
  '<!-- moltnet:complexity-review -->';

const FULL_GIT_OID = /^[0-9a-f]{40}$/;

export interface IssueComment {
  id: number;
  body: string | null;
  user: { login: string } | null;
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
  durationMs: number;
  domainCount: number;
  summarizedPaths?: string[];
  generatedPaths?: string[];
  output: ComplexityReviewOutput;
}): string {
  requireFullOid(args.revision, 'review revision');
  const burden =
    args.output.composite === undefined
      ? 'undetermined'
      : args.output.composite >= 0.8
        ? 'low'
        : args.output.composite >= 0.5
          ? 'moderate'
          : 'high';
  const criteria = args.output.scores
    .map(
      (score) =>
        `- **${score.criterionId}: ${score.status}** — ` + score.rationale,
    )
    .join('\n');
  const assessedCount = args.output.scores.filter(
    (score) => score.status !== 'unclear',
  ).length;

  return (
    `${COMPLEXITY_REVIEW_COMMENT_MARKER}\n` +
    '## MoltNet complexity review\n\n' +
    `Complexity: ${burden} burden · head ${args.revision.slice(0, 7)} · reviewed in ${Math.round(args.durationMs / 1000)}s\n\n` +
    `Stages: change map → ${args.domainCount} focused review${args.domainCount === 1 ? '' : 's'} → synthesis.\n\n` +
    `**Weighted composite (assessed criteria only):** ${args.output.composite === undefined ? 'N/A' : args.output.composite.toFixed(2)}\n\n` +
    `Assessed criteria: ${assessedCount}/${args.output.scores.length}.\n\n` +
    `**Verdict:** ${args.output.verdict}\n\n` +
    `${criteria}\n\n` +
    (args.summarizedPaths?.length
      ? `Generated lockfile contents summarized (change metadata only): ${args.summarizedPaths.map((path) => JSON.stringify(path)).join(', ')}.\n\n`
      : '') +
    (args.generatedPaths?.length
      ? `${describeGenerated(args.generatedPaths)}\n\n`
      : '') +
    '_This advisory measures review burden, not correctness or code quality. ' +
    'Low scores are expected for deliberately broad or security-sensitive changes._\n\n' +
    runDetails(args)
  );
}

/** Generated files can number in the hundreds; name a few, count the rest. */
const GENERATED_PATHS_SHOWN = 5;

function describeGenerated(paths: string[]): string {
  const shown = paths
    .slice(0, GENERATED_PATHS_SHOWN)
    .map((path) => JSON.stringify(path))
    .join(', ');
  const more = paths.length - GENERATED_PATHS_SHOWN;
  return `Not reviewed, marked \`linguist-generated\` at the base revision (${paths.length} file${paths.length === 1 ? '' : 's'}): ${shown}${more > 0 ? ` and ${more} more` : ''}.`;
}

export function findComplexityReviewComment(
  comments: IssueComment[],
  author: string,
): IssueComment | undefined {
  return comments.find(
    (comment) =>
      comment.user?.login === author &&
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
    private readonly author: string,
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
      this.author,
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
  author: string;
  taskId?: string;
  reviewSucceeded?: boolean;
  resultPath?: string;
  fetchImpl?: typeof fetch;
}): Promise<'progress' | 'published' | 'stale' | 'failed'> {
  requireFullOid(args.reviewedRevision, 'reviewed revision');
  const github = new GitHubApi(
    args.repo,
    args.token,
    args.author,
    args.fetchImpl,
  );
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

  const report = JSON.parse(readFileSync(args.resultPath, 'utf8')) as {
    output?: unknown;
    durationMs?: unknown;
    taskIds?: unknown;
    summarizedPaths?: unknown;
    generatedPaths?: unknown;
  };
  const output = report.output;
  if (!Value.Check(ComplexityReviewOutputSchema, output)) {
    throw new Error(
      'accepted task output is not a valid ComplexityReviewOutput',
    );
  }
  if (
    typeof report.durationMs !== 'number' ||
    !Number.isFinite(report.durationMs) ||
    report.durationMs < 0 ||
    !Array.isArray(report.taskIds) ||
    report.taskIds.length < 3
  ) {
    throw new Error('accepted review report has no valid workflow timing');
  }
  if (
    report.summarizedPaths !== undefined &&
    (!Array.isArray(report.summarizedPaths) ||
      report.summarizedPaths.some((path) => typeof path !== 'string'))
  ) {
    throw new Error('invalid summarized evidence paths');
  }
  if (
    report.generatedPaths !== undefined &&
    (!Array.isArray(report.generatedPaths) ||
      report.generatedPaths.some((path) => typeof path !== 'string'))
  ) {
    throw new Error('invalid generated evidence paths');
  }
  await github.upsertComment(
    args.prNumber,
    renderComplexityReviewResult({
      revision: args.reviewedRevision,
      runUrl: args.runUrl,
      taskId: args.taskId,
      durationMs: report.durationMs,
      domainCount: report.taskIds.length - 2,
      summarizedPaths: report.summarizedPaths as string[] | undefined,
      generatedPaths: report.generatedPaths as string[] | undefined,
      output,
    }),
  );
  return 'published';
}

export async function main(): Promise<void> {
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
      author: { type: 'string' },
    },
  });
  if (
    (values.mode !== 'start' && values.mode !== 'publish') ||
    !values.repo ||
    !values.pr ||
    !values.revision ||
    !values['run-url'] ||
    !values.author
  ) {
    throw new Error(
      'Usage: complexity-review-comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL',
    );
  }
  const prNumber = Number(values.pr);
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error('--pr must be a positive integer');
  }
  const token = githubToken();

  const status = await updateComplexityReviewComment({
    mode: values.mode,
    repo: values.repo,
    prNumber,
    reviewedRevision: values.revision,
    runUrl: values['run-url'],
    token,
    author: values.author,
    taskId: values['task-id'],
    reviewSucceeded: values['review-succeeded'],
    resultPath: values['result-path'],
  });
  process.stdout.write(`${JSON.stringify({ status })}\n`);
}
