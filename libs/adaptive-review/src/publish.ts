import { readFileSync } from 'node:fs';

import {
  findPaginated,
  GitHubApi,
  listPaginated,
} from '@moltnet/docs-impact-review/github-api';

import { env } from './config.js';
import {
  ADAPTIVE_REVIEW_MARKER,
  findingKey,
  type InlineFinding,
  inlineFindings,
  postedFindingKey,
  renderAdaptiveComment,
  renderAdaptiveStale,
  renderFindingComment,
  type ThreadSummary,
} from './report.js';
import type { AdaptiveReport } from './workflow.js';

type Request = (
  url: string,
  method?: string,
  body?: object,
) => Promise<unknown>;

interface PublishOptions {
  request: Request;
  runUrl: string;
  appLogin: string;
  /** Post each cited finding as a review thread; on unless set to false. */
  inlineFindings?: boolean;
  expected: Pick<
    AdaptiveReport,
    | 'repo'
    | 'pr'
    | 'base'
    | 'head'
    | 'correlationId'
    | 'policyDigest'
    | 'referenceDigests'
    | 'runtimeSha'
  >;
}

function assertReport(value: unknown): asserts value is AdaptiveReport {
  if (!value || typeof value !== 'object')
    throw new Error('invalid adaptive report');
  const report = value as Partial<AdaptiveReport>;
  if (
    report.version !== 1 ||
    (report.mode !== 'active' && report.mode !== 'shadow') ||
    typeof report.repo !== 'string' ||
    !Number.isSafeInteger(report.pr) ||
    typeof report.base !== 'string' ||
    typeof report.head !== 'string' ||
    typeof report.correlationId !== 'string' ||
    typeof report.policyDigest !== 'string' ||
    typeof report.runtimeSha !== 'string' ||
    !report.referenceDigests ||
    typeof report.referenceDigests !== 'object' ||
    !report.routing ||
    !Array.isArray(report.routing.routes) ||
    !Array.isArray(report.results) ||
    !Array.isArray(report.gaps) ||
    !report.gaps.every((gap) => typeof gap === 'string') ||
    !report.results.every(
      (result) =>
        result &&
        typeof result.lane === 'string' &&
        typeof result.status === 'string' &&
        typeof result.summary === 'string' &&
        (result.unclear === undefined ||
          (Array.isArray(result.unclear) &&
            result.unclear.every((item) => typeof item === 'string'))) &&
        Array.isArray(result.findings) &&
        result.findings.every(
          (finding) =>
            finding &&
            typeof finding.path === 'string' &&
            typeof finding.concern === 'string',
        ),
    )
  )
    throw new Error('invalid adaptive report');
}

function assertExpected(
  report: AdaptiveReport,
  expected: PublishOptions['expected'],
): void {
  for (const key of [
    'repo',
    'pr',
    'base',
    'head',
    'correlationId',
    'policyDigest',
    'runtimeSha',
  ] as const) {
    if (report[key] !== expected[key])
      throw new Error(
        `adaptive report ${key} does not match the prepared review`,
      );
  }
  if (
    JSON.stringify(report.referenceDigests) !==
    JSON.stringify(expected.referenceDigests)
  )
    throw new Error(
      'adaptive report references do not match the prepared review',
    );
}

type ReviewComment = { body: string; user: { login: string } };

/** Keys of the findings this reviewer already has a thread for on the PR. */
async function postedFindings(
  request: Request,
  report: AdaptiveReport,
  appLogin: string,
): Promise<Set<string>> {
  const comments = await listPaginated<ReviewComment>(
    (path) => request(path) as Promise<ReviewComment[]>,
    `/repos/${report.repo}/pulls/${report.pr}/comments`,
  );
  const keys = new Set<string>();
  for (const comment of comments) {
    if (comment.user.login !== appLogin) continue;
    const key = postedFindingKey(comment.body);
    if (key) keys.add(key);
  }
  return keys;
}

function isUnprocessable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 422
  );
}

/**
 * Opens one review thread per finding not already posted, anchored to the
 * reviewed head. GitHub rejects the whole review when one anchor is outside
 * the diff; the summary then lists the findings instead, so none is lost.
 */
async function publishFindingThreads(
  request: Request,
  report: AdaptiveReport,
  appLogin: string,
  candidates: InlineFinding[],
): Promise<ThreadSummary> {
  const existing = await postedFindings(request, report, appLogin);
  const fresh = candidates.filter(
    (finding) => !existing.has(findingKey(finding)),
  );
  const open = candidates.length - fresh.length;
  const keys = new Set(
    candidates.map(findingKey).filter((key) => existing.has(key)),
  );
  if (!fresh.length) return { posted: 0, existing: open, keys };
  try {
    await request(`/repos/${report.repo}/pulls/${report.pr}/reviews`, 'POST', {
      commit_id: report.head,
      event: 'COMMENT',
      body: `Adaptive review of \`${report.head.slice(0, 7)}\`: ${fresh.length} new finding${fresh.length === 1 ? '' : 's'}.`,
      comments: fresh.map((finding) => ({
        path: finding.path,
        line: finding.line,
        side: finding.side === 'old' ? 'LEFT' : 'RIGHT',
        body: renderFindingComment(finding),
      })),
    });
  } catch (error) {
    if (!isUnprocessable(error)) throw error;
    process.stdout.write(
      '::warning::GitHub rejected the review threads; the summary lists the findings instead.\n',
    );
    return { posted: 0, existing: open, keys };
  }
  for (const finding of fresh) keys.add(findingKey(finding));
  return { posted: fresh.length, existing: open, keys };
}

export async function publishAdaptiveReport(
  report: AdaptiveReport,
  {
    request,
    runUrl,
    appLogin,
    expected,
    inlineFindings: inline,
  }: PublishOptions,
): Promise<void> {
  assertReport(report);
  assertExpected(report, expected);
  if (!appLogin) throw new Error('GitHub App login is required to publish');
  const current = (await request(
    `/repos/${expected.repo}/pulls/${expected.pr}`,
  )) as { head: { sha: string }; base: { sha: string } };
  if (current.head.sha !== report.head)
    throw new Error('PR head changed; refusing to publish stale review');
  if (current.base.sha !== report.base)
    throw new Error('PR base changed; refusing to publish stale review');
  const candidates = inline === false ? [] : inlineFindings(report.results);
  const threads = candidates.length
    ? await publishFindingThreads(request, report, appLogin, candidates)
    : undefined;
  const body = renderAdaptiveComment(report, runUrl, threads);
  type Comment = { id: number; body: string; user: { login: string } };
  const previous = await findPaginated<Comment>(
    (path) => request(path) as Promise<Comment[]>,
    `/repos/${expected.repo}/issues/${expected.pr}/comments`,
    (comment) =>
      comment.body.includes(ADAPTIVE_REVIEW_MARKER) &&
      comment.user.login === appLogin,
  );
  const latest = (await request(
    `/repos/${expected.repo}/pulls/${expected.pr}`,
  )) as {
    head: { sha: string };
    base: { sha: string };
  };
  if (latest.head.sha !== report.head)
    throw new Error('PR head changed before publishing review');
  if (latest.base.sha !== report.base)
    throw new Error('PR base changed before publishing review');
  let commentId: number;
  if (previous) {
    await request(
      `/repos/${expected.repo}/issues/comments/${previous.id}`,
      'PATCH',
      { body },
    );
    commentId = previous.id;
  } else {
    const created = (await request(
      `/repos/${expected.repo}/issues/${expected.pr}/comments`,
      'POST',
      { body },
    )) as { id: number };
    commentId = created.id;
  }
  // Narrow the check-then-write race: if the PR moved while publishing,
  // replace the result with a stale notice.
  const after = (await request(
    `/repos/${expected.repo}/pulls/${expected.pr}`,
  )) as { head: { sha: string }; base: { sha: string } };
  if (after.head.sha === report.head && after.base.sha === report.base) return;
  await request(
    `/repos/${expected.repo}/issues/comments/${commentId}`,
    'PATCH',
    {
      body: renderAdaptiveStale(
        report,
        { head: after.head.sha, base: after.base.sha },
        runUrl,
      ),
    },
  );
  throw new Error(
    'PR changed while publishing review; replaced it with a stale notice',
  );
}

export async function publishAdaptiveReportFromEnv(): Promise<void> {
  const path = env().ADAPTIVE_REPORT;
  const token = env().GH_TOKEN;
  const runUrl = env().ADAPTIVE_RUN_URL;
  const appLogin = env().ADAPTIVE_APP_LOGIN;
  if (!path || !token || !runUrl || !appLogin)
    throw new Error('report, App token, run URL, and App login are required');
  const report: unknown = JSON.parse(readFileSync(path, 'utf8'));
  assertReport(report);
  const prepared = JSON.parse(
    readFileSync(env().ADAPTIVE_PREPARED ?? '', 'utf8'),
  ) as {
    repo: string;
    pr: number;
    base: string;
    head: string;
    correlationId: string;
  };
  const route = JSON.parse(
    readFileSync(env().ADAPTIVE_ROUTE ?? '', 'utf8'),
  ) as {
    policyDigest: string;
    referenceDigests: Record<string, string>;
    runtimeSha: string;
  };
  const expected = { ...prepared, ...route };
  const api = new GitHubApi({ token, apiUrl: env().GITHUB_API_URL });
  const request: Request = (url, method = 'GET', body) =>
    api.request(url, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await publishAdaptiveReport(report, {
    request,
    runUrl,
    appLogin,
    expected,
    inlineFindings: env().ADAPTIVE_INLINE_FINDINGS !== 'false',
  });
}
