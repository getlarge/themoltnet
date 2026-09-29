import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';

import type { ActionEnv } from './config.js';
import {
  checkEligibility,
  type PullRequestFacts,
  type PullRequestFile,
} from './eligibility.js';
import { GitHubApi } from './github-api.js';

/**
 * A UUID derived from `seed` (SHA-256, with the version and variant bits of a
 * name-based UUID), so every job of one workflow run computes the same id
 * without passing it around, and a re-run attempt gets a new one.
 */
export function correlationIdFor(seed: string): string {
  const bytes = createHash('sha256').update(seed).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface PrepareOptions {
  api: GitHubApi;
  repo: string;
  pullNumber: number;
  runId: string;
  runAttempt: string;
  profile: string;
  coverageProfile?: string;
  docsCheckProfile?: string;
  protectedPaths: string[];
}

/** The `prepare` outputs; every value is a string, as step outputs are. */
export interface PreparedReview {
  skip: 'true' | 'false';
  reason: string;
  'pr-number': string;
  'base-sha': string;
  'head-sha': string;
  'correlation-id': string;
  profile: string;
  'coverage-profile': string;
  'docs-check-profile': string;
  /** JSON array of distinct profiles: one drain worker each. */
  'worker-profiles': string;
}

interface PullRequest {
  number: number;
  user: { login: string };
  base: { sha: string };
  head: { sha: string; repo: { full_name: string } | null };
}

interface PullRequestFileResponse {
  filename: string;
  previous_filename?: string;
}

/** Collects the pull request facts, pins revisions, and applies the gate. */
export async function preparePullRequestReview(
  options: PrepareOptions,
): Promise<PreparedReview> {
  const { api, repo, pullNumber } = options;
  const pr = await api.request<PullRequest>(
    `/repos/${repo}/pulls/${pullNumber}`,
  );
  const files = await api.paginate<PullRequestFileResponse>(
    `/repos/${repo}/pulls/${pullNumber}/files`,
  );
  const facts: PullRequestFacts = {
    headRepo: pr.head.repo?.full_name ?? null,
    baseRepo: repo,
    author: pr.user.login,
    files: files.map(
      (file): PullRequestFile => ({
        filename: file.filename,
        ...(file.previous_filename
          ? { previous_filename: file.previous_filename }
          : {}),
      }),
    ),
    protectedPaths: options.protectedPaths,
  };
  const eligibility = checkEligibility(facts);
  const coverageProfile = options.coverageProfile || options.profile;
  const docsCheckProfile = options.docsCheckProfile || options.profile;
  return {
    skip: eligibility.eligible ? 'false' : 'true',
    reason: eligibility.eligible ? '' : eligibility.reason,
    'pr-number': String(pr.number),
    'base-sha': pr.base.sha,
    'head-sha': pr.head.sha,
    'correlation-id': correlationIdFor(
      [repo, pr.number, pr.head.sha, options.runId, options.runAttempt].join(
        ':',
      ),
    ),
    profile: options.profile,
    'coverage-profile': coverageProfile,
    'docs-check-profile': docsCheckProfile,
    'worker-profiles': JSON.stringify([
      ...new Set([options.profile, coverageProfile, docsCheckProfile]),
    ]),
  };
}

/** The pull request a `pull_request` or `issue_comment` event is about. */
export function pullNumberFromEvent(eventName: string, event: unknown): number {
  const payload = event as {
    pull_request?: { number?: number };
    issue?: { number?: number; pull_request?: unknown };
  };
  const number =
    eventName === 'issue_comment'
      ? payload.issue?.pull_request
        ? payload.issue.number
        : undefined
      : payload.pull_request?.number;
  if (!number) {
    throw new Error(
      `run on pull_request or on a pull request's issue_comment (got ${eventName})`,
    );
  }
  return number;
}

function required(env: ActionEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** `prepare` step: writes the step outputs and explains a skip. */
export async function runPrepareCli(
  env: ActionEnv,
  fetchImpl?: typeof fetch,
): Promise<void> {
  const protectedPaths = (env.PROTECTED_PATHS ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (protectedPaths.length === 0) {
    process.stdout.write(
      '::warning::no protected-paths: a pull request that changes the review workflow is reviewed by the workflow it changes\n',
    );
  }
  const eventName = required(env, 'GITHUB_EVENT_NAME');
  const event = JSON.parse(
    readFileSync(required(env, 'GITHUB_EVENT_PATH'), 'utf8'),
  ) as unknown;
  const prepared = await preparePullRequestReview({
    api: new GitHubApi({
      token: required(env, 'GITHUB_TOKEN'),
      apiUrl: env.GITHUB_API_URL,
      fetchImpl,
    }),
    repo: required(env, 'GITHUB_REPOSITORY'),
    pullNumber: pullNumberFromEvent(eventName, event),
    runId: required(env, 'GITHUB_RUN_ID'),
    runAttempt: required(env, 'GITHUB_RUN_ATTEMPT'),
    profile: required(env, 'PROFILE'),
    coverageProfile: env.COVERAGE_PROFILE,
    docsCheckProfile: env.DOCS_CHECK_PROFILE,
    protectedPaths,
  });
  const output = required(env, 'GITHUB_OUTPUT');
  appendFileSync(
    output,
    (Object.entries(prepared) as Array<[string, string]>)
      .map(([name, value]) => `${name}=${value.replace(/[\r\n]+/g, ' ')}\n`)
      .join(''),
  );
  if (prepared.skip === 'true') {
    process.stdout.write(
      `::notice::Docs impact review skipped: ${prepared.reason}\n`,
    );
    if (env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        env.GITHUB_STEP_SUMMARY,
        `### Docs impact review skipped\n\n${prepared.reason}\n`,
      );
    }
  }
}
