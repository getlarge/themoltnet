import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

import { actionEnv } from './config.js';

interface PullRequest {
  number: number;
  user: { login: string };
  changed_files: number;
  base: { sha: string };
  head: { sha: string; repo: { full_name: string } | null };
}
interface PullRequestFile {
  filename: string;
  previous_filename?: string;
}
export interface PreparedReview {
  v: 1;
  eligible: boolean;
  reason: string;
  pr: number;
  baseSha: string;
  headSha: string;
  correlationId: string;
  runAttempt: number;
  profile: string;
  rubric: string;
}

const oid = /^[0-9a-f]{40}$/;
const defaultRubric = 'rubrics/pr-complexity-binary-v1.json';

export function parsePreparedReview(
  raw: string,
  attempt?: string,
): PreparedReview {
  let value: PreparedReview;
  try {
    value = JSON.parse(raw) as PreparedReview;
  } catch {
    throw new Error('prepared review is not JSON');
  }
  if (
    value?.v !== 1 ||
    !value.eligible ||
    !Number.isInteger(value.pr) ||
    value.pr < 1 ||
    !oid.test(value.baseSha) ||
    !oid.test(value.headSha) ||
    !/^[0-9a-f-]{36}$/.test(value.correlationId) ||
    !Number.isInteger(value.runAttempt) ||
    !value.profile?.trim() ||
    !value.rubric?.trim()
  ) {
    throw new Error('prepared complexity review is missing required fields');
  }
  if (attempt && String(value.runAttempt) !== attempt)
    throw new Error(
      'review and workers need the same run attempt; re-run all jobs',
    );
  return value;
}

function correlationId(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function prepareReview(args: {
  repo: string;
  pr: number;
  token: string;
  runId: string;
  runAttempt: number;
  profile: string;
  protectedPaths: string[];
  fetchImpl?: typeof fetch;
}): Promise<PreparedReview> {
  if (!args.profile?.trim()) throw new Error('profile is required');
  const fetchImpl = args.fetchImpl ?? fetch;
  const api = actionEnv().GITHUB_API_URL || 'https://api.github.com';
  async function request<T>(path: string): Promise<T> {
    const response = await fetchImpl(`${api}${path}`, {
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${args.token}`,
        'x-github-api-version': '2022-11-28',
      },
    });
    if (!response.ok)
      throw new Error(`GitHub API ${path} returned ${response.status}`);
    return (await response.json()) as T;
  }
  const pr = await request<PullRequest>(`/repos/${args.repo}/pulls/${args.pr}`);
  const files: PullRequestFile[] = [];
  for (let page = 1; page <= 30; page++) {
    const batch = await request<PullRequestFile[]>(
      `/repos/${args.repo}/pulls/${args.pr}/files?per_page=100&page=${page}`,
    );
    files.push(...batch);
    if (batch.length < 100) break;
  }
  let rubric = defaultRubric;
  try {
    const config = await request<{ content: string }>(
      `/repos/${args.repo}/contents/.github/complexity-review.json?ref=${pr.base.sha}`,
    );
    const parsed = JSON.parse(
      Buffer.from(config.content, 'base64').toString('utf8'),
    ) as { rubric?: unknown };
    if (
      typeof parsed.rubric === 'string' &&
      /^[\w./-]+\.json$/.test(parsed.rubric) &&
      !parsed.rubric.includes('..') &&
      !parsed.rubric.startsWith('/')
    )
      rubric = parsed.rubric;
    else
      throw new Error('invalid rubric path in .github/complexity-review.json');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('returned 404'))
      throw error;
  }
  const changed = files.flatMap((file) =>
    [file.filename, file.previous_filename].filter((p): p is string =>
      Boolean(p),
    ),
  );
  const guarded = changed.filter((path) =>
    args.protectedPaths.some((prefix) => path.startsWith(prefix)),
  );
  const reason =
    pr.head.repo?.full_name !== args.repo
      ? 'fork pull request'
      : pr.user.login === 'dependabot[bot]'
        ? 'Dependabot pull request'
        : files.length < pr.changed_files
          ? 'incomplete changed-file listing'
          : guarded.length > 0
            ? `review runtime changed: ${guarded.join(', ')}`
            : '';
  return {
    v: 1,
    eligible: !reason,
    reason,
    pr: pr.number,
    baseSha: pr.base.sha,
    headSha: pr.head.sha,
    correlationId: correlationId(
      `${args.repo}:${pr.number}:${pr.head.sha}:${args.runId}:${args.runAttempt}`,
    ),
    runAttempt: args.runAttempt,
    profile: args.profile,
    rubric,
  };
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export async function prepareCli(): Promise<void> {
  const env = actionEnv();
  const event = JSON.parse(
    readFileSync(required(env, 'GITHUB_EVENT_PATH'), 'utf8'),
  ) as {
    pull_request?: { number: number };
    issue?: { number: number; pull_request?: unknown };
  };
  const pr =
    env.GITHUB_EVENT_NAME === 'issue_comment' && event.issue?.pull_request
      ? event.issue.number
      : event.pull_request?.number;
  if (!pr) throw new Error('event has no pull request');
  const result = await prepareReview({
    repo: required(env, 'GITHUB_REPOSITORY'),
    pr,
    token: required(env, 'GITHUB_TOKEN'),
    runId: required(env, 'GITHUB_RUN_ID'),
    runAttempt: Number(env.GITHUB_RUN_ATTEMPT),
    profile: required(env, 'PROFILE'),
    protectedPaths: (env.PROTECTED_PATHS || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  appendFileSync(
    required(env, 'GITHUB_OUTPUT'),
    `skip=${!result.eligible}\nreason=${result.reason.replace(/[\r\n]/g, ' ')}\ncorrelation-id=${result.correlationId}\nprepared=${JSON.stringify(result)}\n`,
  );
  if (!result.eligible)
    process.stdout.write(`Complexity review skipped: ${result.reason}\n`);
}

/** Validate the payload at the review boundary and expose checked fields. */
export function checkPreparedCli(env: NodeJS.ProcessEnv = actionEnv()): void {
  const prepared = parsePreparedReview(
    required(env, 'PREPARED'),
    required(env, 'GITHUB_RUN_ATTEMPT'),
  );
  required(env, 'TEAM_ID');
  required(env, 'DIARY_ID');
  const output = required(env, 'GITHUB_OUTPUT');
  appendFileSync(
    output,
    `pr=${prepared.pr}\nbase=${prepared.baseSha}\nhead=${prepared.headSha}\ncorrelation=${prepared.correlationId}\nprofile=${prepared.profile}\nrubric=${prepared.rubric}\n`,
  );
}
