import { readFileSync } from 'node:fs';

import { shorten } from '@moltnet/docs-impact-review';
import { GitHubApi } from '@moltnet/docs-impact-review/github-api';
import { connect } from '@themoltnet/sdk/node';

import { env, required } from './config.js';
import { postedFindingKey } from './report.js';

/** What the author did about one finding by the time the PR closed. */
export type FindingOutcome = 'fixed' | 'dismissed' | 'ignored';

/** One review thread as GraphQL `reviewThreads` returns it. */
export interface ReviewThread {
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  comments: {
    nodes: Array<{
      author: { login: string } | null;
      body: string;
      originalCommit: { oid: string } | null;
    }>;
  };
}

export interface RecordedFinding {
  key: string;
  lane: string;
  path: string;
  /** Head the finding was raised on; its review run names the models. */
  reviewedHead: string | null;
  concern: string;
  outcome: FindingOutcome;
  /** The latest reply from someone other than the reviewer, if any. */
  reason: string | null;
}

export interface PullRequestOutcomes {
  repo: string;
  pr: number;
  merged: boolean;
  head: string;
  findings: RecordedFinding[];
}

const MAX_REASON = 500;
const MAX_CONCERN = 1000;

/** GraphQL bot logins omit the `[bot]` suffix that REST logins carry. */
function sameLogin(a: string, b: string): boolean {
  const bare = (login: string) => login.replace(/\[bot\]$/, '').toLowerCase();
  return bare(a) === bare(b);
}

/** The finding text from a thread body, without marker, header, or footer. */
function concernText(body: string): string {
  const lines = body.split('\n').slice(1);
  return lines
    .filter(
      (line) =>
        !line.startsWith('**Adaptive review · ') &&
        !line.startsWith('_Fix it, or resolve'),
    )
    .join(' ')
    .trim();
}

/**
 * Classifies the reviewer's threads. A thread whose line changed after the
 * finding (`isOutdated`) counts as fixed, even when also resolved: GitHub
 * marks it outdated only when a later commit touched the anchored line. A
 * resolved thread whose line did not change was dismissed, and its reason is
 * the latest human reply. Anything else was ignored. "Outdated" is a proxy:
 * an incidental edit to the line also counts as a fix.
 */
export function classifyThreads(
  threads: readonly ReviewThread[],
  appLogin: string,
): RecordedFinding[] {
  const findings: RecordedFinding[] = [];
  for (const thread of threads) {
    const [first, ...replies] = thread.comments.nodes;
    if (!first?.author || !sameLogin(first.author.login, appLogin)) continue;
    const key = postedFindingKey(first.body);
    if (!key) continue;
    const reply = replies
      .filter(
        (comment) =>
          comment.author && !sameLogin(comment.author.login, appLogin),
      )
      .at(-1);
    findings.push({
      key,
      lane: key.split(':')[0] ?? 'unknown',
      path: thread.path,
      reviewedHead: first.originalCommit?.oid ?? null,
      concern: shorten(concernText(first.body), MAX_CONCERN),
      outcome: thread.isOutdated
        ? 'fixed'
        : thread.isResolved
          ? 'dismissed'
          : 'ignored',
      reason: reply ? shorten(reply.body, MAX_REASON) : null,
    });
  }
  return findings;
}

export const OUTCOMES_TAG = 'review:adaptive-outcomes';

export function outcomeTags(outcomes: PullRequestOutcomes): string[] {
  const lanes = [...new Set(outcomes.findings.map((f) => f.lane))].sort();
  return [
    OUTCOMES_TAG,
    `repo:${outcomes.repo}`,
    `pr:${outcomes.pr}`,
    ...lanes.map((lane) => `lane:${lane}`),
  ];
}

/** Entry content: a short summary for people, then the data for evals. */
export function renderOutcomesEntry(outcomes: PullRequestOutcomes): string {
  const count = (outcome: FindingOutcome) =>
    outcomes.findings.filter((finding) => finding.outcome === outcome).length;
  return [
    `Adaptive review outcomes for ${outcomes.repo}#${outcomes.pr} (${outcomes.merged ? 'merged' : 'closed without merge'} at ${outcomes.head.slice(0, 7)}).`,
    '',
    `Findings: ${outcomes.findings.length}. Fixed: ${count('fixed')}. Dismissed: ${count('dismissed')}. Ignored: ${count('ignored')}.`,
    '',
    '"Fixed" means a later commit changed the anchored line; confirm it before using a finding as an eval case.',
    '',
    '```json',
    JSON.stringify({ version: 1, ...outcomes }, null, 2),
    '```',
  ].join('\n');
}

type GraphQL = (
  query: string,
  variables: Record<string, unknown>,
) => Promise<unknown>;

const THREADS_QUERY = `query($owner: String!, $repo: String!, $pr: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          isResolved
          isOutdated
          path
          comments(first: 50) {
            nodes { author { login } body originalCommit { oid } }
          }
        }
      }
    }
  }
}`;

export async function fetchReviewThreads(
  graphql: GraphQL,
  repo: string,
  pr: number,
): Promise<ReviewThread[]> {
  const [owner, name] = repo.split('/');
  const threads: ReviewThread[] = [];
  let cursor: string | null = null;
  do {
    const data = (await graphql(THREADS_QUERY, {
      owner,
      repo: name,
      pr,
      cursor,
    })) as {
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: boolean; endCursor: string | null };
            nodes: ReviewThread[];
          };
        } | null;
      } | null;
    };
    const page = data.repository?.pullRequest?.reviewThreads;
    if (!page) throw new Error(`pull request ${repo}#${pr} was not found`);
    threads.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);
  return threads;
}

export interface OutcomeEntries {
  /** Whether an outcomes entry for this PR already exists. */
  exists(tags: string[]): Promise<boolean>;
  create(body: {
    title: string;
    content: string;
    tags: string[];
    entryType: 'episodic';
    importance: number;
  }): Promise<{ id: string }>;
}

export type RecordResult =
  | { recorded: true; entryId: string; findings: number }
  | { recorded: false; reason: 'no-findings' | 'already-recorded' };

/**
 * Writes one diary entry per closed PR with the outcome of every finding
 * the reviewer posted as a thread. A PR with no threads writes nothing, and
 * a PR closed again after a reopen keeps its first entry.
 */
export async function recordReviewOutcomes(
  pull: { repo: string; pr: number; merged: boolean; head: string },
  deps: { graphql: GraphQL; entries: OutcomeEntries; appLogin: string },
): Promise<RecordResult> {
  const threads = await fetchReviewThreads(deps.graphql, pull.repo, pull.pr);
  const findings = classifyThreads(threads, deps.appLogin);
  if (!findings.length) return { recorded: false, reason: 'no-findings' };
  const outcomes: PullRequestOutcomes = { ...pull, findings };
  const tags = outcomeTags(outcomes);
  if (
    await deps.entries.exists([
      OUTCOMES_TAG,
      `repo:${pull.repo}`,
      `pr:${pull.pr}`,
    ])
  )
    return { recorded: false, reason: 'already-recorded' };
  const entry = await deps.entries.create({
    title: `Adaptive review outcomes: ${pull.repo}#${pull.pr}`,
    content: renderOutcomesEntry(outcomes),
    tags,
    entryType: 'episodic',
    importance: 4,
  });
  return { recorded: true, entryId: entry.id, findings: findings.length };
}

/** Reads the closed PR from the GitHub Actions event payload. */
export function closedPullFromEvent(path = required('GITHUB_EVENT_PATH')): {
  repo: string;
  pr: number;
  merged: boolean;
  head: string;
} {
  const event = JSON.parse(readFileSync(path, 'utf8')) as {
    repository?: { full_name?: string };
    pull_request?: {
      number?: number;
      merged?: boolean;
      head?: { sha?: string };
    };
  };
  const repo = event.repository?.full_name;
  const pr = event.pull_request?.number;
  const head = event.pull_request?.head?.sha;
  if (!repo || !Number.isSafeInteger(pr) || !head)
    throw new Error('the event is not a pull request event');
  return {
    repo,
    pr: pr as number,
    merged: event.pull_request?.merged === true,
    head,
  };
}

/**
 * The workflow entry point: reads the closed PR from the event, the threads
 * with the job's token, and signs the entry with the agent's identity seed so
 * an eval case can be traced to the PR that produced it.
 */
export async function recordReviewOutcomesFromEnv(): Promise<void> {
  const source = env();
  const token = required('GH_TOKEN', source);
  const appLogin = required('ADAPTIVE_APP_LOGIN', source);
  const diaryId = required('MOLTNET_DIARY_ID', source);
  const privateKey = required('MOLTNET_PRIVATE_KEY', source);
  const graphqlUrl =
    source.GITHUB_GRAPHQL_URL || 'https://api.github.com/graphql';
  const api = new GitHubApi({
    token,
    apiUrl: graphqlUrl.replace(/\/graphql$/, ''),
  });
  const graphql: GraphQL = async (query, variables) => {
    const response = await api.request<{
      data?: unknown;
      errors?: Array<{ message?: string }>;
    }>('/graphql', {
      method: 'POST',
      body: JSON.stringify({ query, variables }),
    });
    if (response.errors?.length)
      throw new Error(
        `GitHub GraphQL failed: ${response.errors.map((e) => e.message).join('; ')}`,
      );
    return response.data;
  };
  const agent = await connect();
  const entries: OutcomeEntries = {
    async exists(tags) {
      const page = await agent.entries.list(diaryId, { tags, limit: 1 });
      return page.items.length > 0;
    },
    create: (body) => agent.entries.createSigned(diaryId, body, privateKey),
  };
  const result = await recordReviewOutcomes(closedPullFromEvent(), {
    graphql,
    entries,
    appLogin,
  });
  process.stdout.write(
    result.recorded
      ? `Recorded ${result.findings} finding outcomes in entry ${result.entryId}.\n`
      : `No outcomes entry written: ${result.reason}.\n`,
  );
}
