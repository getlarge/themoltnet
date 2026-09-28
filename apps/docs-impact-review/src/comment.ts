import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { githubToken } from './config.js';
import { requireFullOid } from './git.js';
import { DOCS_IMPACT_COMMENT_MARKER, renderComment } from './report.js';
import type { DocsImpactReport } from './types.js';

export interface IssueComment {
  id: number;
  body: string | null;
  user: { type: string } | null;
}

function runLine(revision: string, runUrl: string): string {
  return `Head \`${revision}\` · [workflow run](${runUrl})`;
}

export function renderProgress(revision: string, runUrl: string): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: reviewing** · ${runLine(revision, runUrl)}`,
    '',
    'Any result for an earlier head is stale until this review finishes.',
  ].join('\n');
}

export function renderStale(
  reviewedRevision: string,
  currentRevision: string,
  runUrl: string,
): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: stale** · ${runLine(reviewedRevision, runUrl)}`,
    '',
    `The pull request now points at \`${currentRevision}\`. This result was not published as current guidance.`,
  ].join('\n');
}

export function renderPublished(
  report: DocsImpactReport,
  runUrl: string,
): string {
  return `${renderComment(report)}\n\n[workflow run](${runUrl})`;
}

export function renderMissingReport(revision: string, runUrl: string): string {
  return [
    DOCS_IMPACT_COMMENT_MARKER,
    `**Docs impact: not reviewed** · ${runLine(revision, runUrl)}`,
    '',
    'The review did not produce a report. No judgment was made.',
  ].join('\n');
}

/** Only a bot-authored marker comment is ours to update. */
export function findDocsImpactComment(
  comments: IssueComment[],
): IssueComment | undefined {
  return comments.find(
    (comment) =>
      comment.user?.type === 'Bot' &&
      comment.body?.includes(DOCS_IMPACT_COMMENT_MARKER),
  );
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

  async headSha(prNumber: number): Promise<string> {
    const pr = await this.request<{ head: { sha: string } }>(
      `/repos/${this.repo}/pulls/${prNumber}`,
    );
    return pr.head.sha;
  }

  async upsert(prNumber: number, body: string): Promise<void> {
    const comments: IssueComment[] = [];
    for (let page = 1; ; page += 1) {
      const batch = await this.request<IssueComment[]>(
        `/repos/${this.repo}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      );
      comments.push(...batch);
      if (batch.length < 100) break;
    }
    const existing = findDocsImpactComment(comments);
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
  mode: 'start' | 'publish';
  repo: string;
  prNumber: number;
  reviewedRevision: string;
  runUrl: string;
  token: string;
  reportPath?: string;
  fetchImpl?: typeof fetch;
}): Promise<'progress' | 'published' | 'stale' | 'missing'> {
  requireFullOid(args.reviewedRevision, 'reviewed revision');
  const github = new GitHubApi(args.repo, args.token, args.fetchImpl);
  const current = requireFullOid(
    await github.headSha(args.prNumber),
    'current revision',
  );
  if (current !== args.reviewedRevision) {
    await github.upsert(
      args.prNumber,
      renderStale(args.reviewedRevision, current, args.runUrl),
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
      renderMissingReport(args.reviewedRevision, args.runUrl),
    );
    return 'missing';
  }
  await github.upsert(args.prNumber, renderPublished(report, args.runUrl));
  // Narrow the check-then-write race: if the head moved while publishing,
  // replace the result with the stale notice.
  const after = await github.headSha(args.prNumber);
  if (after !== args.reviewedRevision) {
    await github.upsert(
      args.prNumber,
      renderStale(args.reviewedRevision, after, args.runUrl),
    );
    return 'stale';
  }
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
      report: { type: 'string' },
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
      'Usage: comment --mode start|publish --repo owner/repo --pr N --revision SHA --run-url URL [--report summary.json]',
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
    reportPath: values.report,
  });
  process.stdout.write(`${JSON.stringify({ status })}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `[fatal] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
