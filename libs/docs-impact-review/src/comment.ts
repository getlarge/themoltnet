import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { githubApiUrl, githubToken } from './config.js';
import { requireFullOid } from './git.js';
import { GitHubApi, type GitHubApiOptions } from './github-api.js';
import { DOCS_IMPACT_COMMENT_MARKER, renderComment } from './report.js';
import type { DocsImpactReport } from './types.js';

export interface IssueComment {
  id: number;
  body: string | null;
  user: { login: string } | null;
}

/** The correlation id ties a comment to its MoltNet tasks and worker logs. */
function correlationSuffix(correlationId?: string): string {
  return correlationId ? ` · correlation \`${correlationId}\`` : '';
}

function runLine(
  revision: string,
  runUrl: string,
  correlationId?: string,
): string {
  return `Head \`${revision}\` · [workflow run](${runUrl})${correlationSuffix(correlationId)}`;
}

const PROGRESS_HEADLINE = '**Docs impact: reviewing**';

export function renderProgress(revision: string, runUrl: string): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `${PROGRESS_HEADLINE} · ${runLine(revision, runUrl)}`,
    '',
    'Any result for an earlier head is stale until this review finishes.',
  ].join('\n');
}

export function renderStale(
  reviewedRevision: string,
  currentRevision: string,
  runUrl: string,
  correlationId?: string,
): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: stale** · ${runLine(reviewedRevision, runUrl, correlationId)}`,
    '',
    `The pull request now points at \`${currentRevision}\`. This result was not published as current guidance.`,
  ].join('\n');
}

export function renderPublished(
  report: DocsImpactReport,
  runUrl: string,
  correlationId?: string,
): string {
  return `${renderComment(report)}\n\n[workflow run](${runUrl})${correlationSuffix(correlationId)}`;
}

export function renderMissingReport(
  revision: string,
  runUrl: string,
  correlationId?: string,
): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: not reviewed** · ${runLine(revision, runUrl, correlationId)}`,
    '',
    'The review did not produce a report. No judgment was made.',
  ].join('\n');
}

export function renderCancelled(
  revision: string,
  runUrl: string,
  correlationId?: string,
): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: not completed** · ${runLine(revision, runUrl, correlationId)}`,
    '',
    'The run was cancelled or timed out before the review finished. No judgment was made.',
  ].join('\n');
}

/** Whether `body` is the in-progress placeholder of the run at `runUrl`. */
function isProgressOf(body: string | null, runUrl: string): boolean {
  return (
    !!body?.includes(PROGRESS_HEADLINE) &&
    body.includes(`[workflow run](${runUrl})`)
  );
}

/**
 * Only a marker comment written by the posting identity is ours to update:
 * a token cannot edit another account's comment, and a human quoting the
 * marker must not be overwritten.
 */
export function findDocsImpactComment(
  comments: IssueComment[],
  author: string,
): IssueComment | undefined {
  return comments.find(
    (comment) =>
      comment.user?.login === author &&
      comment.body?.includes(DOCS_IMPACT_COMMENT_MARKER),
  );
}

/** The comment's GitHub calls, retried on rate limits and 5xx errors. */
class CommentApi {
  private readonly api: GitHubApi;

  constructor(
    private readonly repo: string,
    token: string,
    private readonly author: string,
    options: {
      apiUrl?: string;
      fetchImpl?: typeof fetch;
      retry?: GitHubApiOptions['retry'];
    },
  ) {
    this.api = new GitHubApi({ token, ...options });
  }

  async headSha(prNumber: number): Promise<string> {
    const pr = await this.api.request<{ head: { sha: string } }>(
      `/repos/${this.repo}/pulls/${prNumber}`,
    );
    return pr.head.sha;
  }

  async find(prNumber: number): Promise<IssueComment | undefined> {
    const comments = await this.api.paginate<IssueComment>(
      `/repos/${this.repo}/issues/${prNumber}/comments`,
    );
    return findDocsImpactComment(comments, this.author);
  }

  async edit(id: number, body: string): Promise<void> {
    await this.api.request(`/repos/${this.repo}/issues/comments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body }),
    });
  }

  async upsert(prNumber: number, body: string): Promise<void> {
    const existing = await this.find(prNumber);
    if (existing) {
      await this.api.request(
        `/repos/${this.repo}/issues/comments/${existing.id}`,
        { method: 'PATCH', body: JSON.stringify({ body }) },
      );
      return;
    }
    await this.api.request(`/repos/${this.repo}/issues/${prNumber}/comments`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    });
  }
}

function readReport(path: string | undefined): DocsImpactReport | undefined {
  if (!path) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
      reports?: DocsImpactReport[];
    };
    return parsed.reports?.[0];
  } catch {
    return undefined;
  }
}

/**
 * Upserts the single docs-impact comment. The PR head is checked first on
 * every write, so a run for an older head can never overwrite feedback for
 * a newer one.
 */
export async function updateDocsImpactComment(args: {
  mode: 'start' | 'publish' | 'cancelled';
  repo: string;
  prNumber: number;
  reviewedRevision: string;
  runUrl: string;
  token: string;
  /** Login of the account the token posts as, e.g. `my-app[bot]`. */
  author: string;
  reportPath?: string;
  correlationId?: string;
  apiUrl?: string;
  fetchImpl?: typeof fetch;
  retry?: GitHubApiOptions['retry'];
}): Promise<
  'progress' | 'published' | 'stale' | 'missing' | 'cancelled' | 'unchanged'
> {
  requireFullOid(args.reviewedRevision, 'reviewed revision');
  const github = new CommentApi(args.repo, args.token, args.author, {
    apiUrl: args.apiUrl,
    fetchImpl: args.fetchImpl,
    retry: args.retry,
  });
  // A cancelled run replaces only its own placeholder: by the time it runs,
  // a newer run may already own the comment.
  if (args.mode === 'cancelled') {
    const existing = await github.find(args.prNumber);
    if (!existing || !isProgressOf(existing.body, args.runUrl)) {
      return 'unchanged';
    }
    await github.edit(
      existing.id,
      renderCancelled(args.reviewedRevision, args.runUrl, args.correlationId),
    );
    return 'cancelled';
  }
  const current = requireFullOid(
    await github.headSha(args.prNumber),
    'current revision',
  );
  if (current !== args.reviewedRevision) {
    await github.upsert(
      args.prNumber,
      renderStale(
        args.reviewedRevision,
        current,
        args.runUrl,
        args.correlationId,
      ),
    );
    return 'stale';
  }
  if (args.mode === 'start') {
    await github.upsert(
      args.prNumber,
      renderProgress(args.reviewedRevision, args.runUrl),
    );
    return 'progress';
  }
  const report = readReport(args.reportPath);
  if (!report || report.headRevision !== args.reviewedRevision) {
    await github.upsert(
      args.prNumber,
      renderMissingReport(
        args.reviewedRevision,
        args.runUrl,
        args.correlationId,
      ),
    );
    return 'missing';
  }
  await github.upsert(
    args.prNumber,
    renderPublished(report, args.runUrl, args.correlationId),
  );
  // Narrow the check-then-write race: if the head moved while publishing,
  // replace the result with the stale notice.
  const after = await github.headSha(args.prNumber);
  if (after !== args.reviewedRevision) {
    await github.upsert(
      args.prNumber,
      renderStale(
        args.reviewedRevision,
        after,
        args.runUrl,
        args.correlationId,
      ),
    );
    return 'stale';
  }
  return 'published';
}

/** The comment CLI used by CI to post and update the review comment. */
export async function runCommentCli(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      mode: { type: 'string' },
      repo: { type: 'string' },
      pr: { type: 'string' },
      revision: { type: 'string' },
      'run-url': { type: 'string' },
      report: { type: 'string' },
      author: { type: 'string' },
      'correlation-id': { type: 'string' },
    },
  });
  if (
    (values.mode !== 'start' &&
      values.mode !== 'publish' &&
      values.mode !== 'cancelled') ||
    !values.repo ||
    !values.pr ||
    !values.revision ||
    !values['run-url'] ||
    !values.author
  ) {
    throw new Error(
      'Usage: comment --mode start|publish|cancelled --repo owner/repo --pr N --revision SHA --run-url URL --author LOGIN [--report summary.json] [--correlation-id UUID]',
    );
  }
  const prNumber = Number(values.pr);
  if (!Number.isInteger(prNumber) || prNumber < 1) {
    throw new Error('--pr must be a positive integer');
  }
  const token = githubToken();
  if (!token) throw new Error('GITHUB_TOKEN is required');
  const status = await updateDocsImpactComment({
    mode: values.mode,
    repo: values.repo,
    prNumber,
    reviewedRevision: values.revision,
    runUrl: values['run-url'],
    token,
    author: values.author,
    reportPath: values.report,
    correlationId: values['correlation-id'],
    apiUrl: githubApiUrl(),
  });
  process.stdout.write(`${JSON.stringify({ status })}\n`);
}
