import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { LANES } from '../src/policy.js';
import { renderFindingComment } from '../src/report.js';
import type { ReviewThread } from '../src/threads.js';
import {
  guidanceAt,
  isTrustedRecorder,
  MAX_COMMAND_LENGTH,
  MAX_REASON_LENGTH,
  parseReviewCommand,
  recordReviewCommand,
  REJECTION_MESSAGES,
  type ReviewCommentEvent,
  reviewCommentFromEvent,
  VERDICT_TAG,
  type VerdictEntries,
} from '../src/verdicts.js';

const APP = 'legreffier[bot]';
const RUN = 'https://github.com/getlarge/themoltnet/actions/runs/9';
const BASE = 'b'.repeat(40);
const REVIEWED = 'a'.repeat(40);
const LATER = 'c'.repeat(40);
const REASON = 'The guard moved to the caller in this PR.';

function event(
  body: string,
  overrides: Partial<ReviewCommentEvent['comment']> = {},
): ReviewCommentEvent {
  return {
    repo: 'getlarge/themoltnet',
    pr: 42,
    base: BASE,
    comment: {
      id: 900,
      url: 'https://github.com/getlarge/themoltnet/pull/42#discussion_r900',
      body,
      login: 'getlarge',
      userType: 'User',
      association: 'OWNER',
      path: 'src/a.ts',
      line: 12,
      startLine: null,
      side: 'RIGHT',
      commitId: LATER,
      inReplyToId: null,
      subjectType: 'line',
      ...overrides,
    },
  };
}

const findingBody = renderFindingComment(
  {
    lane: 'tests',
    path: 'src/a.ts',
    side: 'new',
    line: 7,
    concern: 'The new branch has no test.',
    action: 'Add a test',
  },
  { runUrl: RUN, correlationId: 'review-42' },
);

function root(overrides: object = {}) {
  return {
    id: 700,
    body: findingBody,
    html_url: 'https://github.com/getlarge/themoltnet/pull/42#discussion_r700',
    path: 'src/a.ts',
    line: null,
    original_line: 7,
    start_line: null,
    original_start_line: null,
    side: 'RIGHT',
    original_commit_id: REVIEWED,
    user: { login: APP },
    ...overrides,
  };
}

function graphqlWith(threads: Array<Partial<ReviewThread>>) {
  return vi.fn().mockResolvedValue({
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes: threads,
        },
      },
    },
  });
}

type EntryBody = Parameters<VerdictEntries['create']>[0];

function deps(
  options: {
    existing?: boolean;
    rootComment?: object;
    guidance?: () => Array<{ path: string; digest: string }>;
  } = {},
) {
  const created: EntryBody[] = [];
  const exists = vi.fn((_tags: string[]) =>
    Promise.resolve(options.existing ?? false),
  );
  const create = vi.fn((body: EntryBody) => {
    created.push(body);
    return Promise.resolve({ id: 'entry-1' });
  });
  const request = vi.fn((_path: string) =>
    Promise.resolve(options.rootComment ?? root()),
  );
  const graphql = graphqlWith([
    {
      id: 'PRRT_other',
      comments: { nodes: [{ databaseId: 1 } as never] },
    },
    {
      id: 'PRRT_finding',
      comments: { nodes: [{ databaseId: 700 } as never] },
    },
  ]);
  const guidance = vi.fn(
    options.guidance ?? (() => [{ path: 'REVIEW.md', digest: 'd'.repeat(64) }]),
  );
  return {
    created,
    exists,
    create,
    request,
    graphql,
    guidance,
    deps: {
      request,
      graphql,
      entries: { exists, create },
      appLogin: APP,
      guidance,
      now: () => new Date('2026-11-01T10:00:00Z'),
    },
  };
}

describe('parseReviewCommand', () => {
  it('reads a verdict and a missed-finding report', () => {
    // Act
    const verdict = parseReviewCommand(`/review-verdict incorrect ${REASON}`);
    const missed = parseReviewCommand(
      `/review-missed security\n${REASON}\nSecond line.`,
    );

    // Assert
    expect(verdict).toEqual({
      command: { kind: 'verdict', verdict: 'incorrect', reason: REASON },
    });
    expect(missed).toEqual({
      command: {
        kind: 'missed',
        lane: 'security',
        reason: `${REASON}\nSecond line.`,
      },
    });
  });

  it('accepts every adaptive review lane', () => {
    for (const lane of LANES)
      expect(parseReviewCommand(`/review-missed ${lane} ${REASON}`)).toEqual({
        command: { kind: 'missed', lane, reason: REASON },
      });
  });

  it.each([
    ['Looks good to me', null],
    ['/review', null],
    ['/review-verdicts correct whatever reason', null],
    ['please /review-verdict correct this', null],
  ])('ignores %j', (body, expected) => {
    expect(parseReviewCommand(body)).toBe(expected);
  });

  it.each([
    ['/review-verdict', 'malformed'],
    ['/review-verdict correct', 'malformed'],
    ['/review-verdict\ncorrect long enough reason', 'malformed'],
    ['/review-verdict wrong long enough reason', 'unknown-verdict'],
    ['/review-verdict Correct long enough reason', 'unknown-verdict'],
    ['/review-verdict correct short', 'reason-length'],
    [
      `/review-verdict correct ${'x'.repeat(MAX_REASON_LENGTH + 1)}`,
      'reason-length',
    ],
    [`/review-verdict correct ${'x'.repeat(MAX_COMMAND_LENGTH)}`, 'too-long'],
    ['/review-missed style long enough reason', 'unknown-lane'],
    ['/review-missed tests', 'malformed'],
  ])('rejects %j as %s', (body, rejected) => {
    expect(parseReviewCommand(body)).toEqual({ rejected });
  });

  it('never quotes the comment in a rejection reply', () => {
    for (const message of Object.values(REJECTION_MESSAGES))
      expect(message).toMatch(/^Not recorded/);
  });
});

describe('isTrustedRecorder', () => {
  it.each([
    [{}, true],
    [{ association: 'MEMBER' }, true],
    [{ association: 'COLLABORATOR' }, true],
    [{ association: 'CONTRIBUTOR' }, false],
    [{ association: 'NONE' }, false],
    [{ userType: 'Bot', association: 'COLLABORATOR' }, false],
    [{ userType: 'Bot', login: APP }, false],
    [{ login: 'legreffier' }, false],
  ])('treats %j as trusted=%s', (overrides, trusted) => {
    expect(isTrustedRecorder(event('', overrides).comment, APP)).toBe(trusted);
  });
});

describe('recordReviewCommand', () => {
  it('records a verdict on the finding thread it replies to', async () => {
    // Arrange
    const fake = deps();
    const command = event(`/review-verdict incorrect ${REASON}`, {
      inReplyToId: 700,
    });

    // Act
    const result = await recordReviewCommand(command, fake.deps);

    // Assert
    expect(result).toMatchObject({ status: 'recorded', entryId: 'entry-1' });
    expect(fake.request).toHaveBeenCalledWith(
      '/repos/getlarge/themoltnet/pulls/comments/700',
    );
    expect(fake.guidance).toHaveBeenCalledWith(BASE, ['src/a.ts']);
    const [entry] = fake.created;
    expect(entry).toMatchObject({
      title: 'Adaptive review verdict incorrect: getlarge/themoltnet#42',
      entryType: 'episodic',
      tags: [
        VERDICT_TAG,
        'repo:getlarge/themoltnet',
        'pr:42',
        'lane:tests',
        'verdict:incorrect',
        'comment:900',
      ],
    });
    const json = JSON.parse(
      /```json\n([\s\S]+)\n```/.exec(entry.content)?.[1] ?? '{}',
    );
    expect(json).toEqual({
      version: 1,
      kind: 'verdict',
      verdict: 'incorrect',
      repo: 'getlarge/themoltnet',
      pr: 42,
      base: BASE,
      head: REVIEWED,
      path: 'src/a.ts',
      side: 'new',
      line: 7,
      startLine: null,
      lane: 'tests',
      reason: REASON,
      recorder: { login: 'getlarge', actorKind: 'human', association: 'OWNER' },
      comment: {
        id: 900,
        url: 'https://github.com/getlarge/themoltnet/pull/42#discussion_r900',
      },
      finding: {
        key: 'tests:new:7:src%2Fa.ts',
        commentId: 700,
        url: 'https://github.com/getlarge/themoltnet/pull/42#discussion_r700',
        threadId: 'PRRT_finding',
        runUrl: RUN,
        correlationId: 'review-42',
        concern: 'The new branch has no test. Suggested action: Add a test',
      },
      guidance: [{ path: 'REVIEW.md', digest: 'd'.repeat(64) }],
      guidanceError: null,
      recordedAt: '2026-11-01T10:00:00.000Z',
    });
  });

  it('records a missed finding on the commented line', async () => {
    // Arrange
    const fake = deps();
    const command = event(`/review-missed security ${REASON}`, {
      startLine: 10,
    });

    // Act
    const result = await recordReviewCommand(command, fake.deps);

    // Assert
    expect(result).toMatchObject({
      status: 'recorded',
      record: {
        kind: 'missed',
        verdict: 'missed',
        lane: 'security',
        head: LATER,
        path: 'src/a.ts',
        side: 'new',
        line: 12,
        startLine: 10,
        finding: null,
      },
    });
    expect(fake.request).not.toHaveBeenCalled();
    expect(fake.created[0]).toMatchObject({
      title: 'Adaptive review missed security: getlarge/themoltnet#42',
      tags: expect.arrayContaining(['lane:security', 'verdict:missed']),
    });
  });

  it('ignores ordinary comments and untrusted authors without side effects', async () => {
    // Arrange
    const fake = deps();

    // Act
    const results = await Promise.all([
      recordReviewCommand(event('Nice catch'), fake.deps),
      recordReviewCommand(
        event(`/review-missed tests ${REASON}`, {
          userType: 'Bot',
          login: 'claude[bot]',
          association: 'COLLABORATOR',
        }),
        fake.deps,
      ),
      recordReviewCommand(
        event(`/review-missed tests ${REASON}`, { association: 'NONE' }),
        fake.deps,
      ),
    ]);

    // Assert
    expect(results).toEqual([
      { status: 'ignored', reason: 'not-a-command' },
      { status: 'ignored', reason: 'untrusted-author' },
      { status: 'ignored', reason: 'untrusted-author' },
    ]);
    expect(fake.exists).not.toHaveBeenCalled();
    expect(fake.create).not.toHaveBeenCalled();
  });

  it.each([
    [`/review-verdict correct ${REASON}`, {}, undefined, 'not-a-reply'],
    [
      `/review-verdict correct ${REASON}`,
      { inReplyToId: 700 },
      root({ user: { login: 'getlarge' } }),
      'not-a-finding-thread',
    ],
    [
      `/review-verdict correct ${REASON}`,
      { inReplyToId: 700 },
      root({ body: 'A plain review comment' }),
      'not-a-finding-thread',
    ],
    [
      `/review-missed tests ${REASON}`,
      { inReplyToId: 700 },
      undefined,
      'reply-not-allowed',
    ],
    [
      `/review-missed tests ${REASON}`,
      { subjectType: 'file', line: null },
      undefined,
      'not-on-a-line',
    ],
    ['/review-missed lint long enough reason', {}, undefined, 'unknown-lane'],
  ])('rejects %j with %j', async (body, overrides, rootComment, rejection) => {
    // Arrange
    const fake = deps({ rootComment });

    // Act
    const result = await recordReviewCommand(event(body, overrides), fake.deps);

    // Assert
    expect(result).toEqual({ status: 'rejected', rejection });
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('writes nothing when the comment was already recorded', async () => {
    // Arrange
    const fake = deps({ existing: true });

    // Act
    const result = await recordReviewCommand(
      event(`/review-missed tests ${REASON}`),
      fake.deps,
    );

    // Assert
    expect(result).toEqual({ status: 'already-recorded' });
    expect(fake.exists).toHaveBeenCalledWith([
      VERDICT_TAG,
      'repo:getlarge/themoltnet',
      'comment:900',
    ]);
    expect(fake.create).not.toHaveBeenCalled();
  });

  it('still records the verdict when guidance cannot be read', async () => {
    // Arrange
    const fake = deps({
      guidance: () => {
        throw new Error('review guidance exceeds 16 KiB per file: REVIEW.md');
      },
    });

    // Act
    const result = await recordReviewCommand(
      event(`/review-missed tests ${REASON}`),
      fake.deps,
    );

    // Assert
    expect(result).toMatchObject({
      status: 'recorded',
      record: {
        guidance: null,
        guidanceError: 'review guidance exceeds 16 KiB per file: REVIEW.md',
      },
    });
  });

  it('keeps the verdict when the thread cannot be matched', async () => {
    // Arrange
    const fake = deps({ rootComment: root({ id: 701 }) });

    // Act
    const result = await recordReviewCommand(
      event(`/review-verdict correct ${REASON}`, { inReplyToId: 701 }),
      fake.deps,
    );

    // Assert
    expect(result).toMatchObject({
      status: 'recorded',
      record: { finding: { threadId: null, commentId: 701 } },
    });
  });
});

describe('reviewCommentFromEvent', () => {
  function write(payload: object): string {
    const dir = mkdtempSync(join(tmpdir(), 'verdict-event-'));
    const path = join(dir, 'event.json');
    writeFileSync(path, JSON.stringify(payload));
    return path;
  }

  const payload = {
    action: 'created',
    repository: { full_name: 'getlarge/themoltnet' },
    pull_request: { number: 42, base: { sha: BASE } },
    comment: {
      id: 900,
      html_url:
        'https://github.com/getlarge/themoltnet/pull/42#discussion_r900',
      body: `/review-missed tests ${REASON}`,
      user: { login: 'getlarge', type: 'User' },
      author_association: 'OWNER',
      path: 'src/a.ts',
      line: 12,
      original_line: 12,
      start_line: null,
      original_start_line: null,
      side: 'RIGHT',
      commit_id: LATER,
      original_commit_id: LATER,
      subject_type: 'line',
    },
  };

  it('reads the comment, its anchor, and its author', () => {
    expect(reviewCommentFromEvent(write(payload))).toEqual(
      event(`/review-missed tests ${REASON}`),
    );
  });

  it.each([
    [{ action: 'edited' }],
    [{ pull_request: { number: 42, base: { sha: 'main' } } }],
    [{ comment: { ...payload.comment, original_commit_id: undefined } }],
    [{ comment: { ...payload.comment, body: undefined } }],
  ])('refuses an unexpected event %j', (override) => {
    expect(() =>
      reviewCommentFromEvent(write({ ...payload, ...override })),
    ).toThrow('the event is not a created pull request review comment');
  });
});

describe('guidanceAt', () => {
  function git(cwd: string, ...args: string[]): string {
    return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  }

  it('digests the base REVIEW.md files that apply to the path', () => {
    // Arrange
    const repo = mkdtempSync(join(tmpdir(), 'verdict-guidance-'));
    try {
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'config', 'user.name', 'Test');
      git(repo, 'config', 'user.email', 'test@example.invalid');
      execFileSync('mkdir', ['-p', join(repo, 'src'), join(repo, 'docs')]);
      writeFileSync(join(repo, 'REVIEW.md'), 'root\n');
      writeFileSync(join(repo, 'src', 'REVIEW.md'), 'src\n');
      writeFileSync(join(repo, 'docs', 'REVIEW.md'), 'docs\n');
      git(repo, 'add', '.');
      git(repo, 'commit', '-q', '-m', 'guidance');
      const base = git(repo, 'rev-parse', 'HEAD');

      // Act
      const guidance = guidanceAt(repo)(base, ['src/a.ts']);

      // Assert
      expect(guidance.map(({ path }) => path)).toEqual([
        'REVIEW.md',
        'src/REVIEW.md',
      ]);
      expect(guidance[0].digest).toMatch(/^[0-9a-f]{64}$/);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('fails when the base was not checked out', () => {
    const empty = mkdtempSync(join(tmpdir(), 'verdict-empty-'));
    try {
      expect(() => guidanceAt(empty)(BASE, ['src/a.ts'])).toThrow(
        'the base revision was not checked out',
      );
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
