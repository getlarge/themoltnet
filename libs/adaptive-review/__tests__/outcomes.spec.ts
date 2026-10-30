import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  closedPullFromEvent,
  observeThreads,
  type OutcomeEntries,
  OUTCOMES_TAG,
  recordReviewOutcomes,
} from '../src/outcomes.js';
import { renderFindingComment } from '../src/report.js';
import type { ReviewThread } from '../src/threads.js';

const APP = 'legreffier[bot]';
const RUN = 'https://github.com/getlarge/themoltnet/actions/runs/9';
const PULL = {
  repo: 'getlarge/themoltnet',
  pr: 42,
  merged: true,
  head: 'f'.repeat(40),
  closedAt: '2026-10-28T10:00:00Z',
};
const CURRENT = {
  state: 'closed',
  closed_at: PULL.closedAt,
  head: { sha: PULL.head },
};

function finding(lane: 'tests' | 'conventions', line: number) {
  return renderFindingComment(
    {
      lane,
      path: 'src/a.ts',
      side: 'new',
      line,
      concern: `${lane} concern at ${line}`,
      action: 'Do the thing',
    },
    { runUrl: RUN, correlationId: 'review-42' },
  );
}

function thread(
  body: string,
  state: { isResolved?: boolean; isOutdated?: boolean; resolvedBy?: string },
  replies: Array<{ login: string; body: string }> = [],
  author = 'legreffier',
): ReviewThread {
  return {
    id: `T-${body.length}-${replies.length}`,
    isResolved: state.isResolved ?? false,
    isOutdated: state.isOutdated ?? false,
    path: 'src/a.ts',
    resolvedBy: state.resolvedBy ? { login: state.resolvedBy } : null,
    comments: {
      nodes: [
        {
          author: { login: author },
          body,
          url: 'https://github.com/getlarge/themoltnet/pull/42#r1',
          originalCommit: { oid: 'a'.repeat(40) },
        },
        ...replies.map((reply) => ({
          author: { login: reply.login },
          body: reply.body,
          url: '',
          originalCommit: null,
        })),
      ],
    },
  };
}

describe('observeThreads', () => {
  it('records thread state as observed, without judging the finding', () => {
    // Arrange
    const threads = [
      thread(finding('tests', 1), {
        isOutdated: true,
        isResolved: true,
        resolvedBy: 'getlarge',
      }),
      thread(finding('tests', 2), { isResolved: true }, [
        {
          login: 'getlarge',
          body: 'Intentional: the guard moved to the caller.',
        },
        { login: 'legreffier', body: 'Noted.' },
      ]),
      thread(finding('conventions', 3), { isOutdated: true }),
      thread(finding('conventions', 4), {}),
    ];

    // Act
    const findings = observeThreads(threads, APP);

    // Assert
    expect(findings).toEqual([
      expect.objectContaining({
        key: 'tests:new:1:src%2Fa.ts',
        lane: 'tests',
        resolved: true,
        outdated: true,
        resolvedBy: 'getlarge',
        reply: null,
        reviewedHead: 'a'.repeat(40),
        runUrl: RUN,
        correlationId: 'review-42',
        url: 'https://github.com/getlarge/themoltnet/pull/42#r1',
        concern: 'tests concern at 1 Suggested action: Do the thing',
        adjudication: 'unverified',
      }),
      expect.objectContaining({
        key: 'tests:new:2:src%2Fa.ts',
        resolved: true,
        outdated: false,
        reply: 'Intentional: the guard moved to the caller.',
      }),
      expect.objectContaining({
        key: 'conventions:new:3:src%2Fa.ts',
        resolved: false,
        outdated: true,
      }),
      expect.objectContaining({
        key: 'conventions:new:4:src%2Fa.ts',
        resolved: false,
        outdated: false,
      }),
    ]);
    expect(findings[0]).not.toHaveProperty('outcome');
  });

  it('ignores threads opened by people, other apps, or without a marker', () => {
    // Arrange
    const threads = [
      thread(finding('tests', 1), {}, [], 'getlarge'),
      thread(finding('tests', 2), {}, [], 'legreffier-evil'),
      thread('A plain review comment', {}),
    ];

    // Act
    const findings = observeThreads(threads, APP);

    // Assert
    expect(findings).toEqual([]);
  });

  it('keeps threads from before markers carried their run', () => {
    // Arrange
    const legacy = '<!-- moltnet:adaptive-finding tests:new:5:src%2Fa.ts -->';

    // Act
    const [observed] = observeThreads([thread(legacy, {})], APP);

    // Assert
    expect(observed).toMatchObject({
      key: 'tests:new:5:src%2Fa.ts',
      runUrl: null,
      correlationId: null,
    });
  });
});

function threadsResponse(nodes: ReviewThread[]) {
  return vi.fn().mockResolvedValue({
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: false, endCursor: null },
          nodes,
        },
      },
    },
  });
}

type EntryBody = Parameters<OutcomeEntries['create']>[0];

function fakeEntries(existing = false) {
  const created: EntryBody[] = [];
  const exists = vi.fn((_tags: string[]) => Promise.resolve(existing));
  const create = vi.fn((body: EntryBody) => {
    created.push(body);
    return Promise.resolve({ id: 'entry-1' });
  });
  const entries: OutcomeEntries = { exists, create };
  return { entries, exists, create, created };
}

function pullRequest(state: object = CURRENT) {
  return vi.fn((_path: string) => Promise.resolve(state));
}

describe('recordReviewOutcomes', () => {
  it('writes one tagged episodic entry with every thread state', async () => {
    // Arrange
    const graphql = threadsResponse([
      thread(finding('tests', 1), { isOutdated: true }),
      thread(finding('conventions', 3), { isResolved: true }),
      thread(finding('conventions', 4), {}),
    ]);
    const request = pullRequest();
    const { entries, exists, created } = fakeEntries();

    // Act
    const result = await recordReviewOutcomes(PULL, {
      request,
      graphql,
      entries,
      appLogin: APP,
    });

    // Assert
    expect(result).toEqual({ recorded: true, entryId: 'entry-1', findings: 3 });
    expect(request).toHaveBeenCalledWith('/repos/getlarge/themoltnet/pulls/42');
    expect(exists).toHaveBeenCalledWith([
      OUTCOMES_TAG,
      'repo:getlarge/themoltnet',
      'pr:42',
    ]);
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      title: 'Adaptive review outcomes: getlarge/themoltnet#42',
      entryType: 'episodic',
      tags: [
        OUTCOMES_TAG,
        'repo:getlarge/themoltnet',
        'pr:42',
        'lane:conventions',
        'lane:tests',
      ],
    });
    expect(created[0].content).toContain(
      'Threads: 3. Resolved: 1. Outdated by a later commit: 1. Still open: 1.',
    );
    expect(created[0].content).toContain('not verdicts');
    const json = created[0].content.split('```json\n')[1].split('\n```')[0];
    expect(JSON.parse(json)).toMatchObject({
      version: 1,
      repo: 'getlarge/themoltnet',
      pr: 42,
      merged: true,
      closedAt: PULL.closedAt,
      findings: [
        {
          key: 'tests:new:1:src%2Fa.ts',
          outdated: true,
          adjudication: 'unverified',
        },
        { key: 'conventions:new:3:src%2Fa.ts', resolved: true },
        { key: 'conventions:new:4:src%2Fa.ts', resolved: false },
      ],
    });
  });

  it.each([
    ['the PR was reopened', { ...CURRENT, state: 'open', closed_at: null }],
    [
      'the PR was closed again later',
      { ...CURRENT, closed_at: '2026-10-28T11:00:00Z' },
    ],
    [
      'the PR moved to another head',
      { ...CURRENT, head: { sha: 'e'.repeat(40) } },
    ],
  ])('records nothing when %s before the run started', async (_case, state) => {
    // Arrange
    const graphql = threadsResponse([thread(finding('tests', 1), {})]);
    const { entries, exists, create } = fakeEntries();

    // Act
    const result = await recordReviewOutcomes(PULL, {
      request: pullRequest(state),
      graphql,
      entries,
      appLogin: APP,
    });

    // Assert
    expect(result).toEqual({ recorded: false, reason: 'superseded' });
    expect(graphql).not.toHaveBeenCalled();
    expect(exists).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('writes nothing when the reviewer opened no threads', async () => {
    // Arrange
    const { entries, exists, create } = fakeEntries();

    // Act
    const result = await recordReviewOutcomes(PULL, {
      request: pullRequest(),
      graphql: threadsResponse([]),
      entries,
      appLogin: APP,
    });

    // Assert
    expect(result).toEqual({ recorded: false, reason: 'no-findings' });
    expect(exists).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('keeps the first entry when a reopened PR closes again', async () => {
    // Arrange
    const { entries, create } = fakeEntries(true);

    // Act
    const result = await recordReviewOutcomes(PULL, {
      request: pullRequest(),
      graphql: threadsResponse([thread(finding('tests', 1), {})]),
      entries,
      appLogin: APP,
    });

    // Assert
    expect(result).toEqual({ recorded: false, reason: 'already-recorded' });
    expect(create).not.toHaveBeenCalled();
  });

  it('fails without writing when the threads cannot be read', async () => {
    // Arrange
    const { entries, create } = fakeEntries();
    const graphql = vi.fn().mockRejectedValue(new Error('GraphQL failed'));

    // Act
    const recorded = recordReviewOutcomes(PULL, {
      request: pullRequest(),
      graphql,
      entries,
      appLogin: APP,
    });

    // Assert
    await expect(recorded).rejects.toThrow('GraphQL failed');
    expect(create).not.toHaveBeenCalled();
  });
});

function eventFile(payload: object): string {
  const path = join(mkdtempSync(join(tmpdir(), 'outcomes-')), 'event.json');
  writeFileSync(path, JSON.stringify(payload));
  return path;
}

describe('closedPullFromEvent', () => {
  it('reads the closed pull request from the event payload', () => {
    // Arrange
    const path = eventFile({
      repository: { full_name: 'getlarge/themoltnet' },
      pull_request: {
        number: 42,
        merged: false,
        closed_at: PULL.closedAt,
        head: { sha: 'f'.repeat(40) },
      },
    });

    // Act
    const pull = closedPullFromEvent(path);

    // Assert
    expect(pull).toEqual({ ...PULL, merged: false });
  });

  it('rejects an event without a pull request', () => {
    // Arrange
    const path = eventFile({ repository: { full_name: 'a/b' } });

    // Act
    const read = () => closedPullFromEvent(path);

    // Assert
    expect(read).toThrow('not a closed pull request event');
  });

  it('rejects a pull request event that is not a closure', () => {
    // Arrange
    const path = eventFile({
      repository: { full_name: 'a/b' },
      pull_request: { number: 1, closed_at: null, head: { sha: 'f' } },
    });

    // Act
    const read = () => closedPullFromEvent(path);

    // Assert
    expect(read).toThrow('not a closed pull request event');
  });
});
