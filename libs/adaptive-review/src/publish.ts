import { readFileSync } from 'node:fs';

import { GitHubApi } from '@moltnet/docs-impact-review/github-api';

import { env } from './config.js';
import { ADAPTIVE_REVIEW_MARKER, renderAdaptiveComment } from './report.js';
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

export async function publishAdaptiveReport(
  report: AdaptiveReport,
  { request, runUrl, appLogin, expected }: PublishOptions,
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
  const body = renderAdaptiveComment(report, runUrl);
  let previous: { id: number } | undefined;
  for (let page = 1; page <= 100 && !previous; page++) {
    const comments = (await request(
      `/repos/${expected.repo}/issues/${expected.pr}/comments?per_page=100&page=${page}`,
    )) as Array<{ id: number; body: string; user: { login: string } }>;
    previous = comments.find(
      (comment) =>
        comment.body.includes(ADAPTIVE_REVIEW_MARKER) &&
        comment.user.login === appLogin,
    );
    if (comments.length < 100) break;
  }
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
  if (previous) {
    await request(
      `/repos/${expected.repo}/issues/comments/${previous.id}`,
      'PATCH',
      { body },
    );
  } else {
    await request(
      `/repos/${expected.repo}/issues/${expected.pr}/comments`,
      'POST',
      { body },
    );
  }
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
  await publishAdaptiveReport(report, { request, runUrl, appLogin, expected });
}
