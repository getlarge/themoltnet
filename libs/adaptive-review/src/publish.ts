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
}

export async function publishAdaptiveReport(
  report: AdaptiveReport,
  { request, runUrl, appLogin }: PublishOptions,
): Promise<void> {
  if (!appLogin) throw new Error('GitHub App login is required to publish');
  const current = (await request(
    `/repos/${report.repo}/pulls/${report.pr}`,
  )) as { head: { sha: string }; base: { sha: string } };
  if (current.head.sha !== report.head)
    throw new Error('PR head changed; refusing to publish stale review');
  if (current.base.sha !== report.base)
    throw new Error('PR base changed; refusing to publish stale review');
  const body = renderAdaptiveComment(report, runUrl);
  let previous: { id: number } | undefined;
  for (let page = 1; page <= 100 && !previous; page++) {
    const comments = (await request(
      `/repos/${report.repo}/issues/${report.pr}/comments?per_page=100&page=${page}`,
    )) as Array<{ id: number; body: string; user: { login: string } }>;
    previous = comments.find(
      (comment) =>
        comment.body.includes(ADAPTIVE_REVIEW_MARKER) &&
        comment.user.login === appLogin,
    );
    if (comments.length < 100) break;
  }
  const latest = (await request(
    `/repos/${report.repo}/pulls/${report.pr}`,
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
      `/repos/${report.repo}/issues/comments/${previous.id}`,
      'PATCH',
      { body },
    );
  } else {
    await request(
      `/repos/${report.repo}/issues/${report.pr}/comments`,
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
  const report = JSON.parse(readFileSync(path, 'utf8')) as AdaptiveReport;
  const api = new GitHubApi({ token, apiUrl: env().GITHUB_API_URL });
  const request: Request = (url, method = 'GET', body) =>
    api.request(url, {
      method,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  await publishAdaptiveReport(report, { request, runUrl, appLogin });
}
