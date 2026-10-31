import { readFileSync } from 'node:fs';

import { shorten } from '@moltnet/docs-impact-review';
import { GitHubApi } from '@moltnet/docs-impact-review/github-api';
import { connect } from '@themoltnet/sdk/node';

import { env, required } from './config.js';
import { parseFindingMarker } from './report.js';
import {
  createGraphQL,
  fetchReviewThreads,
  type GraphQL,
  isReviewerThread,
  type ReviewThread,
  sameLogin,
} from './threads.js';

/**
 * What GitHub showed for one finding's thread when the PR closed. These are
 * observations, not a verdict: `outdated` means a later commit changed the
 * anchored line, not that the concern was fixed, and a resolved thread may
 * have been fixed elsewhere. `adjudication` stays `unverified` until a person
 * or an eval confirms whether the finding was a true positive.
 */
export interface RecordedFinding {
  key: string;
  lane: string;
  path: string;
  /** GraphQL node ID and URL of the thread, to revisit the evidence. */
  threadId: string;
  url: string | null;
  /** Head the finding was raised on. */
  reviewedHead: string | null;
  /** The workflow run and review correlation that produced the finding. */
  runUrl: string | null;
  correlationId: string | null;
  concern: string;
  resolved: boolean;
  outdated: boolean;
  resolvedBy: string | null;
  /** The latest reply from someone other than the reviewer, if any. */
  reply: string | null;
  adjudication: 'unverified';
}

export interface ClosedPull {
  repo: string;
  pr: number;
  merged: boolean;
  head: string;
  closedAt: string;
}

export interface PullRequestOutcomes extends ClosedPull {
  findings: RecordedFinding[];
}

const MAX_REPLY = 500;
const MAX_CONCERN = 1000;

/** The finding text from a thread body, without marker, header, or footer. */
function concernText(body: string): string {
  const lines = body.split('\n').slice(1);
  return lines
    .filter(
      (line) =>
        !line.startsWith('**Adaptive review · ') &&
        !line.startsWith('_Fix it, or resolve') &&
        !line.startsWith('_Assess this finding;'),
    )
    .join(' ')
    .trim();
}

/** Records the observed state of every thread the reviewer opened. */
export function observeThreads(
  threads: readonly ReviewThread[],
  appLogin: string,
): RecordedFinding[] {
  const findings: RecordedFinding[] = [];
  for (const thread of threads) {
    if (!isReviewerThread(thread, appLogin)) continue;
    const [first, ...replies] = thread.comments.nodes;
    const marker = parseFindingMarker(first?.body ?? '');
    if (!first || !marker) continue;
    const reply = replies
      .filter(
        (comment) =>
          comment.author && !sameLogin(comment.author.login, appLogin),
      )
      .at(-1);
    findings.push({
      key: marker.key,
      lane: marker.key.split(':')[0] ?? 'unknown',
      path: thread.path,
      threadId: thread.id,
      url: first.url || null,
      reviewedHead: first.originalCommit?.oid ?? null,
      runUrl: marker.runUrl ?? null,
      correlationId: marker.correlationId ?? null,
      concern: shorten(concernText(first.body), MAX_CONCERN),
      resolved: thread.isResolved,
      outdated: thread.isOutdated,
      resolvedBy: thread.resolvedBy?.login ?? null,
      reply: reply ? shorten(reply.body, MAX_REPLY) : null,
      adjudication: 'unverified',
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
  const count = (test: (finding: RecordedFinding) => boolean) =>
    outcomes.findings.filter(test).length;
  return [
    `Adaptive review threads for ${outcomes.repo}#${outcomes.pr} at close (${outcomes.merged ? 'merged' : 'closed without merge'} at ${outcomes.head.slice(0, 7)}, ${outcomes.closedAt}).`,
    '',
    `Threads: ${outcomes.findings.length}. Resolved: ${count((f) => f.resolved)}. Outdated by a later commit: ${count((f) => f.outdated)}. Still open: ${count((f) => !f.resolved && !f.outdated)}.`,
    '',
    'These are GitHub thread states, not verdicts. Every finding is unverified until someone confirms whether it was a true positive.',
    '',
    '```json',
    JSON.stringify({ version: 1, ...outcomes }, null, 2),
    '```',
  ].join('\n');
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
  | {
      recorded: false;
      reason: 'superseded' | 'no-findings' | 'already-recorded';
    };

type PullState = {
  state: string;
  closed_at: string | null;
  head: { sha: string };
};

/**
 * Writes one diary entry per closed PR with the state of every thread the
 * reviewer opened. A queued run only records the closure that triggered it:
 * if the PR was reopened, pushed to, or closed again since, the run that
 * belongs to the latest closure records instead. A PR with no threads writes
 * nothing, and a PR closed again after a reopen keeps its first entry.
 */
export async function recordReviewOutcomes(
  pull: ClosedPull,
  deps: {
    request: (path: string) => Promise<unknown>;
    graphql: GraphQL;
    entries: OutcomeEntries;
    appLogin: string;
  },
): Promise<RecordResult> {
  const current = (await deps.request(
    `/repos/${pull.repo}/pulls/${pull.pr}`,
  )) as PullState;
  if (
    current.state !== 'closed' ||
    current.closed_at !== pull.closedAt ||
    current.head.sha !== pull.head
  )
    return { recorded: false, reason: 'superseded' };
  const threads = await fetchReviewThreads(deps.graphql, pull.repo, pull.pr);
  const findings = observeThreads(threads, deps.appLogin);
  if (!findings.length) return { recorded: false, reason: 'no-findings' };
  const outcomes: PullRequestOutcomes = { ...pull, findings };
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
    tags: outcomeTags(outcomes),
    entryType: 'episodic',
    importance: 4,
  });
  return { recorded: true, entryId: entry.id, findings: findings.length };
}

/** Reads the closed PR from the GitHub Actions event payload. */
export function closedPullFromEvent(
  path = required('GITHUB_EVENT_PATH'),
): ClosedPull {
  const event = JSON.parse(readFileSync(path, 'utf8')) as {
    repository?: { full_name?: string };
    pull_request?: {
      number?: number;
      merged?: boolean;
      closed_at?: string | null;
      head?: { sha?: string };
    };
  };
  const repo = event.repository?.full_name;
  const pr = event.pull_request?.number;
  const head = event.pull_request?.head?.sha;
  const closedAt = event.pull_request?.closed_at;
  if (!repo || !Number.isSafeInteger(pr) || !head || !closedAt)
    throw new Error('the event is not a closed pull request event');
  return {
    repo,
    pr: pr as number,
    merged: event.pull_request?.merged === true,
    head,
    closedAt,
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
  const graphql = createGraphQL(token, source.GITHUB_GRAPHQL_URL || undefined);
  const api = new GitHubApi({ token, apiUrl: source.GITHUB_API_URL });
  const agent = await connect();
  const entries: OutcomeEntries = {
    async exists(tags) {
      const page = await agent.entries.list(diaryId, { tags, limit: 1 });
      return page.items.length > 0;
    },
    create: (body) => agent.entries.createSigned(diaryId, body, privateKey),
  };
  const result = await recordReviewOutcomes(closedPullFromEvent(), {
    request: (path) => api.request(path),
    graphql,
    entries,
    appLogin,
  });
  process.stdout.write(
    result.recorded
      ? `Recorded the state of ${result.findings} review threads in entry ${result.entryId}.\n`
      : `No outcomes entry written: ${result.reason}.\n`,
  );
}
