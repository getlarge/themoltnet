import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createGit, shorten } from '@moltnet/docs-impact-review';
import { GitHubApi } from '@moltnet/docs-impact-review/github-api';
import { connect } from '@themoltnet/sdk/node';

import { env, required } from './config.js';
import { applicableReviewGuidance, loadReviewGuidance } from './guidance.js';
import { concernText } from './outcomes.js';
import { type Lane, LANES } from './policy.js';
import { parseFindingMarker } from './report.js';
import {
  createGraphQL,
  fetchReviewThreads,
  type GraphQL,
  sameLogin,
} from './threads.js';

/*
 * Human verdicts on the adaptive reviewer, given as PR review comments:
 *
 *   /review-verdict correct|incorrect <reason>   (reply in a finding thread)
 *   /review-missed <lane> <reason>               (new comment on a diff line)
 *
 * Each accepted command becomes one signed diary entry. The close-time
 * outcomes entry records what GitHub showed; these entries record what a
 * person decided, and are the only source of misses.
 */

export const VERDICT_TAG = 'review:adaptive-verdict';
export const VERDICT_COMMAND = '/review-verdict';
export const MISSED_COMMAND = '/review-missed';
/** The `/review` rerun accepts the same associations. */
export const TRUSTED_ASSOCIATIONS: readonly string[] = [
  'OWNER',
  'MEMBER',
  'COLLABORATOR',
];
/** Longer comments are rejected before they are parsed. */
export const MAX_COMMAND_LENGTH = 2000;
export const MIN_REASON_LENGTH = 10;
export const MAX_REASON_LENGTH = 1000;

export type ReviewCommand =
  | { kind: 'verdict'; verdict: 'correct' | 'incorrect'; reason: string }
  | { kind: 'missed'; lane: Lane; reason: string };

export type Rejection =
  | 'malformed'
  | 'too-long'
  | 'reason-length'
  | 'unknown-verdict'
  | 'unknown-lane'
  | 'not-a-reply'
  | 'not-a-finding-thread'
  | 'reply-not-allowed'
  | 'not-on-a-line';

/**
 * Fixed replies for a rejected command. They never quote the comment, so a
 * rejection cannot be used to make the App repeat arbitrary text.
 */
export const REJECTION_MESSAGES: Record<Rejection, string> = {
  malformed: `Not recorded. Use \`${VERDICT_COMMAND} correct|incorrect <reason>\` or \`${MISSED_COMMAND} <lane> <reason>\`.`,
  'too-long': `Not recorded: the comment is longer than ${MAX_COMMAND_LENGTH} characters.`,
  'reason-length': `Not recorded: the reason must be ${MIN_REASON_LENGTH} to ${MAX_REASON_LENGTH} characters.`,
  'unknown-verdict': `Not recorded: the verdict must be \`correct\` or \`incorrect\`.`,
  'unknown-lane': `Not recorded: the lane must be one of ${LANES.map((lane) => `\`${lane}\``).join(', ')}.`,
  'not-a-reply': `Not recorded: post \`${VERDICT_COMMAND}\` as a reply in a thread the adaptive reviewer opened.`,
  'not-a-finding-thread': `Not recorded: this thread was not opened by the adaptive reviewer.`,
  'reply-not-allowed': `Not recorded: post \`${MISSED_COMMAND}\` as a new comment on a diff line, not as a reply.`,
  'not-on-a-line': `Not recorded: anchor \`${MISSED_COMMAND}\` to a diff line, not to the whole file.`,
};

export type ParsedCommand =
  | { command: ReviewCommand }
  | { rejected: Rejection }
  | null;

/**
 * Parses a comment body. Returns `null` when the comment is not a command,
 * so ordinary review comments are ignored without a reaction.
 */
export function parseReviewCommand(body: string): ParsedCommand {
  const text = body.replace(/\r\n?/g, '\n').trim();
  const name = text.split(/\s/, 1)[0];
  if (name !== VERDICT_COMMAND && name !== MISSED_COMMAND) return null;
  if (text.length > MAX_COMMAND_LENGTH) return { rejected: 'too-long' };
  const match = /^[ \t]+(\S+)\s+(\S[\s\S]*)$/.exec(text.slice(name.length));
  if (!match) return { rejected: 'malformed' };
  const [, argument, rawReason] = match;
  const reason = rawReason.trim();
  if (reason.length < MIN_REASON_LENGTH || reason.length > MAX_REASON_LENGTH)
    return { rejected: 'reason-length' };
  if (name === VERDICT_COMMAND) {
    if (argument !== 'correct' && argument !== 'incorrect')
      return { rejected: 'unknown-verdict' };
    return { command: { kind: 'verdict', verdict: argument, reason } };
  }
  if (!(LANES as readonly string[]).includes(argument))
    return { rejected: 'unknown-lane' };
  return { command: { kind: 'missed', lane: argument as Lane, reason } };
}

/** The review comment a `pull_request_review_comment` event carries. */
export interface ReviewCommentEvent {
  repo: string;
  pr: number;
  /** The pull request's base commit when the comment was posted. */
  base: string;
  comment: {
    id: number;
    url: string;
    body: string;
    login: string;
    /** GitHub account type: `User`, `Bot`, ... */
    userType: string;
    association: string;
    path: string;
    line: number | null;
    startLine: number | null;
    side: string | null;
    /** The commit the comment's line refers to. */
    commitId: string;
    inReplyToId: number | null;
    /** `line` or `file`. */
    subjectType: string | null;
  };
}

const SHA = /^[0-9a-f]{40}$/;

function optionalInteger(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) > 0
    ? (value as number)
    : null;
}

/** Reads the review comment from the GitHub Actions event payload. */
export function reviewCommentFromEvent(
  path = required('GITHUB_EVENT_PATH'),
): ReviewCommentEvent {
  const event = JSON.parse(readFileSync(path, 'utf8')) as {
    action?: string;
    repository?: { full_name?: string };
    pull_request?: { number?: number; base?: { sha?: string } };
    comment?: {
      id?: number;
      html_url?: string;
      body?: string;
      user?: { login?: string; type?: string } | null;
      author_association?: string;
      path?: string;
      line?: number | null;
      original_line?: number | null;
      start_line?: number | null;
      original_start_line?: number | null;
      side?: string | null;
      original_commit_id?: string;
      in_reply_to_id?: number;
      subject_type?: string;
    };
  };
  const repo = event.repository?.full_name;
  const pr = event.pull_request?.number;
  const base = event.pull_request?.base?.sha;
  const comment = event.comment;
  if (
    event.action !== 'created' ||
    !repo ||
    !Number.isSafeInteger(pr) ||
    !base ||
    !SHA.test(base) ||
    !comment ||
    !Number.isSafeInteger(comment.id) ||
    typeof comment.body !== 'string' ||
    !comment.html_url ||
    !comment.user?.login ||
    !comment.path ||
    !comment.original_commit_id ||
    !SHA.test(comment.original_commit_id)
  )
    throw new Error('the event is not a created pull request review comment');
  return {
    repo,
    pr: pr as number,
    base,
    comment: {
      id: comment.id as number,
      url: comment.html_url,
      body: comment.body,
      login: comment.user.login,
      userType: comment.user.type ?? '',
      association: comment.author_association ?? '',
      path: comment.path,
      // At creation `line` and `original_line` agree; `original_*` stays
      // meaningful for `commitId` after later pushes.
      line: optionalInteger(comment.original_line ?? comment.line),
      startLine: optionalInteger(
        comment.original_start_line ?? comment.start_line,
      ),
      side: comment.side ?? null,
      commitId: comment.original_commit_id,
      inReplyToId: optionalInteger(comment.in_reply_to_id),
      subjectType: comment.subject_type ?? null,
    },
  };
}

/**
 * A command counts only from a person with write-level standing in the
 * repository. Bot accounts are refused even as collaborators: an author's
 * agent disagreeing with a finding is a claim, recorded by the outcomes
 * entry as a reply, not a verdict.
 */
export function isTrustedRecorder(
  comment: ReviewCommentEvent['comment'],
  appLogin: string,
): boolean {
  return (
    comment.userType === 'User' &&
    TRUSTED_ASSOCIATIONS.includes(comment.association) &&
    !sameLogin(comment.login, appLogin)
  );
}

export interface GuidanceDigest {
  path: string;
  digest: string;
}

/** One human verdict or missed-finding report, as eval tooling reads it. */
export interface ReviewVerdictRecord {
  version: 1;
  kind: 'verdict' | 'missed';
  verdict: 'correct' | 'incorrect' | 'missed';
  repo: string;
  pr: number;
  /** The pull request's base when the command was posted. */
  base: string;
  /** The commit `line` refers to: the reviewed head for a verdict. */
  head: string;
  path: string;
  side: 'old' | 'new' | null;
  line: number | null;
  startLine: number | null;
  lane: string;
  reason: string;
  recorder: {
    login: string;
    /**
     * A GitHub `User` account with owner, member, or collaborator standing.
     * GitHub cannot show whether a person or a tool holding that person's
     * token wrote the comment.
     */
    actorKind: 'human';
    association: string;
  };
  comment: { id: number; url: string };
  /** The finding a verdict judges; `null` for a missed-finding report. */
  finding: {
    key: string;
    commentId: number;
    url: string;
    /** GraphQL thread node ID; `null` if the thread could not be matched. */
    threadId: string | null;
    runUrl: string | null;
    correlationId: string | null;
    concern: string;
  } | null;
  guidance: RecordedGuidance;
  recordedAt: string;
}

/**
 * The base `REVIEW.md` files that apply to `path`, read with the review's own
 * loader. `observedAt: 'command_base'` says they were read at the pull
 * request's base when the command ran. The review pins its base earlier and
 * does not publish it, so these may differ from the guidance the reviewer saw.
 */
export interface RecordedGuidance {
  base: string;
  observedAt: 'command_base';
  /** `null` when the files could not be read; `error` says why. */
  files: GuidanceDigest[] | null;
  error: string | null;
}

export interface VerdictEntries {
  exists(tags: string[]): Promise<boolean>;
  create(body: {
    title: string;
    content: string;
    tags: string[];
    entryType: 'episodic';
    importance: number;
  }): Promise<{ id: string }>;
}

export type CommandResult =
  | { status: 'ignored'; reason: 'not-a-command' | 'untrusted-author' }
  | { status: 'rejected'; rejection: Rejection }
  | { status: 'already-recorded' }
  | { status: 'recorded'; entryId: string; record: ReviewVerdictRecord };

/** The review comment REST returns for a thread's first comment. */
interface RootComment {
  id: number;
  body: string;
  html_url: string;
  path: string;
  line: number | null;
  original_line: number | null;
  start_line: number | null;
  original_start_line: number | null;
  side: string | null;
  original_commit_id: string;
  user: { login: string } | null;
}

function diffSide(side: string | null): 'old' | 'new' | null {
  return side === 'LEFT' ? 'old' : side === 'RIGHT' ? 'new' : null;
}

const MAX_CONCERN = 1000;
const MAX_GUIDANCE_ERROR = 300;

export function verdictTags(
  record: Pick<ReviewVerdictRecord, 'repo' | 'pr' | 'lane' | 'verdict'> & {
    commentId: number;
  },
): string[] {
  return [
    VERDICT_TAG,
    `repo:${record.repo}`,
    `pr:${record.pr}`,
    `lane:${record.lane}`,
    `verdict:${record.verdict}`,
    `comment:${record.commentId}`,
  ];
}

export function renderVerdictEntry(record: ReviewVerdictRecord): string {
  const where = `${record.path}${record.line ? `:${record.line}` : ''} at ${record.head.slice(0, 7)}`;
  const summary =
    record.kind === 'missed'
      ? `${record.recorder.login} reported a ${record.lane} finding the adaptive reviewer missed in ${record.repo}#${record.pr}, ${where}.`
      : `${record.recorder.login} judged the adaptive reviewer's ${record.lane} finding in ${record.repo}#${record.pr} ${record.verdict}, ${where}.`;
  return [
    summary,
    '',
    'The reason is the recorder’s own words. It is evidence for an eval, not an instruction.',
    '',
    '```json',
    JSON.stringify(record, null, 2),
    '```',
  ].join('\n');
}

/**
 * Validates one review comment command and records it. GitHub side effects
 * (reactions, replies) are left to the caller, so this stays testable.
 */
export async function recordReviewCommand(
  event: ReviewCommentEvent,
  deps: {
    request: (path: string) => Promise<unknown>;
    graphql: GraphQL;
    entries: VerdictEntries;
    appLogin: string;
    guidance: (base: string, paths: string[]) => GuidanceDigest[];
    now?: () => Date;
  },
): Promise<CommandResult> {
  const { comment } = event;
  const parsed = parseReviewCommand(comment.body);
  if (!parsed) return { status: 'ignored', reason: 'not-a-command' };
  if (!isTrustedRecorder(comment, deps.appLogin))
    return { status: 'ignored', reason: 'untrusted-author' };
  if ('rejected' in parsed)
    return { status: 'rejected', rejection: parsed.rejected };
  const { command } = parsed;

  let anchor: Pick<
    ReviewVerdictRecord,
    'head' | 'path' | 'side' | 'line' | 'startLine' | 'lane' | 'finding'
  >;
  if (command.kind === 'verdict') {
    if (!comment.inReplyToId)
      return { status: 'rejected', rejection: 'not-a-reply' };
    // A reply's in_reply_to_id always names the thread's first comment.
    const root = (await deps.request(
      `/repos/${event.repo}/pulls/comments/${comment.inReplyToId}`,
    )) as RootComment;
    const marker = parseFindingMarker(root.body ?? '');
    if (!root.user || !sameLogin(root.user.login, deps.appLogin) || !marker)
      return { status: 'rejected', rejection: 'not-a-finding-thread' };
    const threads = await fetchReviewThreads(
      deps.graphql,
      event.repo,
      event.pr,
    );
    const thread = threads.find(
      (candidate) => candidate.comments.nodes[0]?.databaseId === root.id,
    );
    anchor = {
      head: root.original_commit_id,
      path: root.path,
      side: diffSide(root.side),
      line: optionalInteger(root.original_line ?? root.line),
      startLine: optionalInteger(root.original_start_line ?? root.start_line),
      lane: marker.key.split(':')[0] || 'unknown',
      finding: {
        key: marker.key,
        commentId: root.id,
        url: root.html_url,
        threadId: thread?.id ?? null,
        runUrl: marker.runUrl ?? null,
        correlationId: marker.correlationId ?? null,
        concern: shorten(concernText(root.body), MAX_CONCERN),
      },
    };
  } else {
    if (comment.inReplyToId)
      return { status: 'rejected', rejection: 'reply-not-allowed' };
    if (comment.subjectType === 'file' || !comment.line)
      return { status: 'rejected', rejection: 'not-on-a-line' };
    anchor = {
      head: comment.commitId,
      path: comment.path,
      side: diffSide(comment.side),
      line: comment.line,
      startLine: comment.startLine,
      lane: command.lane,
      finding: null,
    };
  }

  const verdict = command.kind === 'verdict' ? command.verdict : 'missed';
  const tags = verdictTags({
    repo: event.repo,
    pr: event.pr,
    lane: anchor.lane,
    verdict,
    commentId: comment.id,
  });
  // A redelivered event must not write a second entry for one comment.
  if (
    await deps.entries.exists([
      VERDICT_TAG,
      `repo:${event.repo}`,
      `comment:${comment.id}`,
    ])
  )
    return { status: 'already-recorded' };

  const guidance: RecordedGuidance = {
    base: event.base,
    observedAt: 'command_base',
    files: null,
    error: null,
  };
  try {
    guidance.files = deps.guidance(event.base, [anchor.path]);
  } catch (error) {
    guidance.error = shorten(
      error instanceof Error ? error.message : String(error),
      MAX_GUIDANCE_ERROR,
    );
  }

  const record: ReviewVerdictRecord = {
    version: 1,
    kind: command.kind,
    verdict,
    repo: event.repo,
    pr: event.pr,
    base: event.base,
    ...anchor,
    reason: command.reason,
    recorder: {
      login: comment.login,
      actorKind: 'human',
      association: comment.association,
    },
    comment: { id: comment.id, url: comment.url },
    guidance,
    recordedAt: (deps.now?.() ?? new Date()).toISOString(),
  };
  const entry = await deps.entries.create({
    title:
      command.kind === 'missed'
        ? `Adaptive review missed ${anchor.lane}: ${event.repo}#${event.pr}`
        : `Adaptive review verdict ${verdict}: ${event.repo}#${event.pr}`,
    content: renderVerdictEntry(record),
    tags,
    entryType: 'episodic',
    importance: 6,
  });
  return { status: 'recorded', entryId: entry.id, record };
}

/**
 * Base `REVIEW.md` digests for `paths`, read from a checkout of `base` with
 * the review's own loader so they match what a review at that base sees.
 */
export function guidanceAt(
  checkout: string,
): (base: string, paths: string[]) => GuidanceDigest[] {
  return (base, paths) => {
    if (!existsSync(join(checkout, '.git')))
      throw new Error('the base revision was not checked out');
    const guidance = loadReviewGuidance(createGit(checkout), base);
    return applicableReviewGuidance(guidance, paths).map(
      ({ path, digest }) => ({ path, digest }),
    );
  };
}

/**
 * The workflow entry point: records the command and acknowledges it on the
 * comment, +1 when recorded and `confused` with a fixed reason when not.
 */
export async function recordReviewCommandFromEnv(): Promise<void> {
  const source = env();
  const token = required('GH_TOKEN', source);
  const appLogin = required('ADAPTIVE_APP_LOGIN', source);
  const diaryId = required('MOLTNET_DIARY_ID', source);
  const privateKey = required('MOLTNET_PRIVATE_KEY', source);
  const checkout = required('ADAPTIVE_BASE_CHECKOUT', source);
  const event = reviewCommentFromEvent();
  const graphql = createGraphQL(token, source.GITHUB_GRAPHQL_URL || undefined);
  const api = new GitHubApi({ token, apiUrl: source.GITHUB_API_URL });
  let agent: Awaited<ReturnType<typeof connect>> | undefined;
  const client = async () => (agent ??= await connect());
  const entries: VerdictEntries = {
    async exists(tags) {
      const page = await (
        await client()
      ).entries.list(diaryId, {
        tags,
        limit: 1,
      });
      return page.items.length > 0;
    },
    create: async (body) =>
      (await client()).entries.createSigned(diaryId, body, privateKey),
  };
  const result = await recordReviewCommand(event, {
    request: (path) => api.request(path),
    graphql,
    entries,
    appLogin,
    guidance: guidanceAt(checkout),
  });
  const react = (content: '+1' | 'confused') =>
    api.request(
      `/repos/${event.repo}/pulls/comments/${event.comment.id}/reactions`,
      { method: 'POST', body: JSON.stringify({ content }) },
    );
  switch (result.status) {
    case 'ignored':
      process.stdout.write(`Comment ignored: ${result.reason}.\n`);
      return;
    case 'rejected':
      await react('confused');
      await api.request(
        `/repos/${event.repo}/pulls/${event.pr}/comments/${event.comment.id}/replies`,
        {
          method: 'POST',
          body: JSON.stringify({
            body: REJECTION_MESSAGES[result.rejection],
          }),
        },
      );
      process.stdout.write(`Command rejected: ${result.rejection}.\n`);
      return;
    case 'already-recorded':
      await react('+1');
      process.stdout.write('Command already recorded.\n');
      return;
    case 'recorded':
      await react('+1');
      process.stdout.write(
        `Recorded ${result.record.verdict} (${result.record.lane}) in entry ${result.entryId}.\n`,
      );
  }
}
