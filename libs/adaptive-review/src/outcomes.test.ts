import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  classifyThreads,
  closedPullFromEvent,
  fetchReviewThreads,
  type OutcomeEntries,
  OUTCOMES_TAG,
  recordReviewOutcomes,
  type ReviewThread,
} from './outcomes.js';
import { renderFindingComment } from './report.js';

const APP = 'legreffier[bot]';
const PULL = {
  repo: 'getlarge/themoltnet',
  pr: 42,
  merged: true,
  head: 'f'.repeat(40),
};

function finding(lane: 'tests' | 'conventions', line: number) {
  return renderFindingComment({
    lane,
    path: 'src/a.ts',
    side: 'new',
    line,
    concern: `${lane} concern at ${line}`,
    action: 'Do the thing',
  });
}

function thread(
  body: string,
  state: { isResolved?: boolean; isOutdated?: boolean },
  replies: Array<{ login: string; body: string }> = [],
  author = 'legreffier',
): ReviewThread {
  return {
    isResolved: state.isResolved ?? false,
    isOutdated: state.isOutdated ?? false,
    path: 'src/a.ts',
    comments: {
      nodes: [
        {
          author: { login: author },
          body,
          originalCommit: { oid: 'a'.repeat(40) },
        },
        ...replies.map((reply) => ({
          author: { login: reply.login },
          body: reply.body,
          originalCommit: null,
        })),
      ],
    },
  };
}

describe('classifyThreads', () => {
  it('classifies fixed, dismissed, and ignored findings from thread state', () => {
    // Arrange
    const threads = [
      thread(finding('tests', 1), { isOutdated: true, isResolved: true }),
      thread(finding('tests', 2), { isResolved: true }, [
        {
          login: 'getlarge',
          body: 'Intentional: the guard moved to the caller.',
        },
        { login: 'legreffier', body: 'Noted.' },
      ]),
      thread(finding('conventions', 3), {}),
    ];

    // Act
    const findings = classifyThreads(threads, APP);

    // Assert
    expect(findings).toEqual([
      expect.objectContaining({
        key: 'tests:new:1:src%2Fa.ts',
        lane: 'tests',
        outcome: 'fixed',
        reason: null,
        reviewedHead: 'a'.repeat(40),
        concern: 'tests concern at 1 Suggested action: Do the thing',
      }),
      expect.objectContaining({
        key: 'tests:new:2:src%2Fa.ts',
        outcome: 'dismissed',
        reason: 'Intentional: the guard moved to the caller.',
      }),
      expect.objectContaining({
        key: 'conventions:new:3:src%2Fa.ts',
        lane: 'conventions',
        outcome: 'ignored',
      }),
    ]);
  });

  it('ignores threads opened by people or without a finding marker', () => {
    // Arrange
    const threads = [
      thread(finding('tests', 1), {}, [], 'getlarge'),
      thread('A plain review comment', {}),
    ];

    // Act
    const findings = classifyThreads(threads, APP);

    // Assert
    expect(findings).toEqual([]);
  });
});

describe('fetchReviewThreads', () => {
  it('follows pages until the last one', async () => {
    // Arrange
    const page = (nodes: ReviewThread[], endCursor: string | null) => ({
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: endCursor !== null, endCursor },
            nodes,
          },
        },
      },
    });
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page([thread(finding('tests', 1), {})], 'c1'))
      .mockResolvedValueOnce(page([thread(finding('tests', 2), {})], null));

    // Act
    const threads = await fetchReviewThreads(graphql, PULL.repo, PULL.pr);

    // Assert
    expect(threads).toHaveLength(2);
    expect(graphql.mock.calls[0][1]).toEqual({
      owner: 'getlarge',
      repo: 'themoltnet',
      pr: 42,
      cursor: null,
    });
    expect(graphql.mock.calls[1][1]).toMatchObject({ cursor: 'c1' });
  });

  it('fails when the pull request is missing', async () => {
    // Arrange
    const graphql = vi.fn().mockResolvedValue({ repository: null });

    // Act
    const fetched = fetchReviewThreads(graphql, PULL.repo, PULL.pr);

    // Assert
    await expect(fetched).rejects.toThrow('was not found');
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

describe('recordReviewOutcomes', () => {
  it('writes one tagged episodic entry with every finding outcome', async () => {
    // Arrange
    const graphql = threadsResponse([
      thread(finding('tests', 1), { isOutdated: true }),
      thread(finding('conventions', 3), {}),
    ]);
    const { entries, exists, created } = fakeEntries();

    // Act
    const result = await recordReviewOutcomes(PULL, {
      graphql,
      entries,
      appLogin: APP,
    });

    // Assert
    expect(result).toEqual({ recorded: true, entryId: 'entry-1', findings: 2 });
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
      'Findings: 2. Fixed: 1. Dismissed: 0. Ignored: 1.',
    );
    const json = created[0].content.split('```json\n')[1].split('\n```')[0];
    expect(JSON.parse(json)).toMatchObject({
      version: 1,
      repo: 'getlarge/themoltnet',
      pr: 42,
      merged: true,
      findings: [
        { key: 'tests:new:1:src%2Fa.ts', outcome: 'fixed' },
        { key: 'conventions:new:3:src%2Fa.ts', outcome: 'ignored' },
      ],
    });
  });

  it('writes nothing when the reviewer opened no threads', async () => {
    // Arrange
    const { entries, exists, create } = fakeEntries();

    // Act
    const result = await recordReviewOutcomes(PULL, {
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
      graphql: threadsResponse([thread(finding('tests', 1), {})]),
      entries,
      appLogin: APP,
    });

    // Assert
    expect(result).toEqual({ recorded: false, reason: 'already-recorded' });
    expect(create).not.toHaveBeenCalled();
  });
});

describe('closedPullFromEvent', () => {
  it('reads the closed pull request from the event payload', () => {
    // Arrange
    const path = join(mkdtempSync(join(tmpdir(), 'outcomes-')), 'event.json');
    writeFileSync(
      path,
      JSON.stringify({
        repository: { full_name: 'getlarge/themoltnet' },
        pull_request: {
          number: 42,
          merged: false,
          head: { sha: 'f'.repeat(40) },
        },
      }),
    );

    // Act
    const pull = closedPullFromEvent(path);

    // Assert
    expect(pull).toEqual({ ...PULL, merged: false });
  });

  it('rejects an event without a pull request', () => {
    // Arrange
    const path = join(mkdtempSync(join(tmpdir(), 'outcomes-')), 'event.json');
    writeFileSync(path, JSON.stringify({ repository: { full_name: 'a/b' } }));

    // Act
    const read = () => closedPullFromEvent(path);

    // Assert
    expect(read).toThrow('not a pull request event');
  });
});
