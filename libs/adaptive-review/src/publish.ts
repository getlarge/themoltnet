import { readFileSync } from 'node:fs';

import {
  findPaginated,
  GitHubApi,
  listPaginated,
} from '@moltnet/docs-impact-review/github-api';
import { Type } from 'typebox';
import { Value } from 'typebox/value';

import { env } from './config.js';
import { PriorFindingReviewSchema } from './prior-findings.js';
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
import {
  createGraphQL,
  fetchReviewThreads,
  type GraphQL,
  isReviewerThread,
  type ReviewThread,
} from './threads.js';
import type { AdaptiveReport } from './workflow.js';

type Request = (
  url: string,
  method?: string,
  body?: object,
) => Promise<unknown>;

interface PublishOptions {
  request: Request;
  /** Reads thread state; required unless inline findings are off. */
  graphql?: GraphQL;
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
    (report.priorFindingOutcomes !== undefined &&
      !Value.Check(
        Type.Array(PriorFindingReviewSchema),
        report.priorFindingOutcomes,
      )) ||
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
            typeof finding.concern === 'string' &&
            (finding.existingFindingKey === undefined ||
              (typeof finding.existingFindingKey === 'string' &&
                finding.existingFindingKey.length > 0)),
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

/**
 * The reviewer's existing threads by finding key. A key with any open thread
 * is open; a key whose threads are all resolved is resolved.
 */
async function threadState(
  graphql: GraphQL,
  report: AdaptiveReport,
  appLogin: string,
): Promise<{
  open: Set<string>;
  resolved: Set<string>;
  previous: ReviewThread[];
}> {
  const threads = await fetchReviewThreads(graphql, report.repo, report.pr);
  const open = new Set<string>();
  const resolved = new Set<string>();
  for (const thread of threads) {
    if (!isReviewerThread(thread, appLogin)) continue;
    const key = postedFindingKey(thread.comments.nodes[0]?.body ?? '');
    if (!key) continue;
    if (thread.isResolved) resolved.add(key);
    else open.add(key);
  }
  for (const key of open) resolved.delete(key);
  return {
    open,
    resolved,
    previous: threads.filter((thread) => isReviewerThread(thread, appLogin)),
  };
}

function isUnprocessable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 422
  );
}

interface PostedThreads {
  summary: ThreadSummary;
  /** The review that holds this run's threads, if one was created. */
  reviewId?: number;
}

/**
 * Opens one review thread per finding that has no thread yet, anchored to
 * the reviewed head. Identity defaults to location; focused findings may
 * reference an earlier owned thread after validating its lane and path.
 * A resolved thread is not
 * reopened: the summary lists the finding instead, so a new concern at a
 * line the author already settled stays visible without repeating a thread.
 * GitHub rejects the whole review when one anchor is outside the diff; the
 * summary then lists every finding instead.
 */
async function publishFindingThreads(
  request: Request,
  graphql: GraphQL,
  report: AdaptiveReport,
  { appLogin, runUrl }: { appLogin: string; runUrl: string },
  candidates: InlineFinding[],
): Promise<PostedThreads> {
  const { open, resolved, previous } = await threadState(
    graphql,
    report,
    appLogin,
  );
  for (const finding of candidates) {
    const reference = finding.existingFindingKey;
    if (
      reference &&
      !previous.some(
        (item) =>
          postedFindingKey(item.comments.nodes[0]?.body ?? '') === reference &&
          item.path === finding.path &&
          reference.startsWith(`${finding.lane}:`),
      )
    )
      throw new Error('finding references an unavailable prior review thread');
  }
  const fresh = candidates.filter((finding) => {
    const key = findingKey(finding);
    return !open.has(key) && !resolved.has(key);
  });
  const existing = candidates.filter((finding) =>
    open.has(findingKey(finding)),
  ).length;
  const keys = new Set(candidates.map(findingKey).filter((k) => open.has(k)));
  const summary = (posted: number): ThreadSummary => ({
    posted,
    existing,
    keys,
    resolved,
    links: new Map(
      previous.flatMap((thread) => {
        const first = thread.comments.nodes[0];
        const key = postedFindingKey(first?.body ?? '');
        return key && first?.url ? [[key, first.url] as const] : [];
      }),
    ),
  });
  if (!fresh.length) return { summary: summary(0) };
  const source = { runUrl, correlationId: report.correlationId };
  let created: { id?: number };
  try {
    created = (await request(
      `/repos/${report.repo}/pulls/${report.pr}/reviews`,
      'POST',
      {
        commit_id: report.head,
        event: 'COMMENT',
        body: `Adaptive review of \`${report.head.slice(0, 7)}\`: ${fresh.length} new finding${fresh.length === 1 ? '' : 's'}.`,
        comments: fresh.map((finding) => ({
          path: finding.path,
          line: finding.line,
          side: finding.side === 'old' ? 'LEFT' : 'RIGHT',
          body: renderFindingComment(finding, source),
        })),
      },
    )) as { id?: number };
  } catch (error) {
    if (!isUnprocessable(error)) throw error;
    process.stdout.write(
      '::warning::GitHub rejected the review threads; the summary lists the findings instead.\n',
    );
    return { summary: summary(0) };
  }
  for (const finding of fresh) keys.add(findingKey(finding));
  return {
    summary: summary(fresh.length),
    ...(typeof created.id === 'number' ? { reviewId: created.id } : {}),
  };
}

/**
 * Deletes the threads a stale run opened. They anchor to a head that is no
 * longer current, and GitHub would later mark them outdated, which reads as
 * a fix to anyone counting outcomes.
 */
async function withdrawThreads(
  request: Request,
  report: AdaptiveReport,
  reviewId: number,
): Promise<void> {
  const comments = await listPaginated<{ id: number }>(
    (path) => request(path) as Promise<Array<{ id: number }>>,
    `/repos/${report.repo}/pulls/${report.pr}/reviews/${reviewId}/comments`,
  );
  for (const comment of comments)
    await request(
      `/repos/${report.repo}/pulls/comments/${comment.id}`,
      'DELETE',
    );
}

export async function publishAdaptiveReport(
  report: AdaptiveReport,
  {
    request,
    graphql,
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
  if (candidates.length && !graphql)
    throw new Error('a GraphQL client is required to publish review threads');
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
  // Threads go out only after the last pre-write check, so a run that is
  // already stale opens none; a run that goes stale below withdraws them.
  const posted =
    candidates.length && graphql
      ? await publishFindingThreads(
          request,
          graphql,
          report,
          { appLogin, runUrl },
          candidates,
        )
      : undefined;
  const body = renderAdaptiveComment(report, runUrl, posted?.summary);
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
  if (posted?.reviewId !== undefined)
    await withdrawThreads(request, report, posted.reviewId);
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
    graphql: createGraphQL(token, env().GITHUB_GRAPHQL_URL || undefined),
    runUrl,
    appLogin,
    expected,
    inlineFindings: env().ADAPTIVE_INLINE_FINDINGS !== 'false',
  });
}
