import { describe, expect, it, vi } from 'vitest';

import { publishAdaptiveReport } from '../src/publish.js';
import {
  ADAPTIVE_FINDING_MARKER,
  ADAPTIVE_REVIEW_MARKER,
} from '../src/report.js';
import type { AdaptiveReport, LaneResult } from '../src/workflow.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const PR_PATH = '/repos/getlarge/themoltnet/pulls/42';
const COMMENTS_PATH = '/repos/getlarge/themoltnet/issues/42/comments';
const REVIEWS_PATH = '/repos/getlarge/themoltnet/pulls/42/reviews';
const OPTIONS = {
  runUrl: 'https://github.com/getlarge/themoltnet/actions/runs/1',
  appLogin: 'moltnet-review[bot]',
  expected: {
    repo: 'getlarge/themoltnet',
    pr: 42,
    base: BASE,
    head: HEAD,
    correlationId: 'test',
    policyDigest: 'd'.repeat(64),
    referenceDigests: {},
    runtimeSha: 'c'.repeat(40),
  },
};

function report(): AdaptiveReport {
  return {
    version: 1,
    mode: 'active',
    repo: 'getlarge/themoltnet',
    pr: 42,
    base: BASE,
    head: HEAD,
    correlationId: 'test',
    policyDigest: 'd'.repeat(64),
    referenceDigests: {},
    runtimeSha: 'c'.repeat(40),
    routing: {
      classifierFailed: false,
      scores: { 'code-complexity': null, 'review-effort': null },
      routes: [],
    },
    results: [],
    packetCount: 0,
    taskIds: [],
    gaps: [],
    durationMs: 0,
  };
}

function comment(id: number, login: string, body = ADAPTIVE_REVIEW_MARKER) {
  return { id, user: { login }, body };
}

function expectPublishedBody(body: object | undefined): void {
  if (!body || !('body' in body) || typeof body.body !== 'string') {
    throw new Error('Expected a comment body');
  }
  expect(body.body).toContain(ADAPTIVE_REVIEW_MARKER);
}

describe('publishAdaptiveReport', () => {
  it('publishes explicit prior assessments as advisory summary text without resolving or reopening threads', async () => {
    const value = report();
    value.priorFindingOutcomes = [
      {
        key: 'tests:new:1:file.ts',
        lane: 'tests',
        path: 'file.ts',
        url: 'https://github.com/getlarge/themoltnet/pull/42#discussion_r1',
        status: 'fixed',
        explanation: 'The caller now passes its timeout at file.ts:12.',
      },
    ];
    const graphql = vi.fn(() => {
      throw new Error('No thread mutation or lookup needed');
    });
    const request = vi.fn((url: string, method?: string, body?: object) => {
      if (url === PR_PATH)
        return Promise.resolve({ head: { sha: HEAD }, base: { sha: BASE } });
      if (url.startsWith(COMMENTS_PATH) && method !== 'POST')
        return Promise.resolve([]);
      if (url === COMMENTS_PATH && method === 'POST') {
        expect(body).toMatchObject({
          body: expect.stringContaining('**Fixed**'),
        });
        expect(body).toMatchObject({
          body: expect.stringContaining('The caller now passes its timeout'),
        });
        return Promise.resolve({ id: 100 });
      }
      throw new Error(`Unexpected write: ${method} ${url}`);
    });
    await publishAdaptiveReport(value, { ...OPTIONS, request, graphql });
    expect(graphql).not.toHaveBeenCalled();
    expect(
      request.mock.calls.filter(([, method]) => method === 'POST'),
    ).toHaveLength(1);
  });

  it('rejects malformed prior assessments before any GitHub access', async () => {
    const request = vi.fn();
    await expect(
      publishAdaptiveReport(
        {
          ...report(),
          priorFindingOutcomes: [{ key: 'k', status: 'fixed' }],
        } as unknown as AdaptiveReport,
        { ...OPTIONS, request },
      ),
    ).rejects.toThrow('invalid adaptive report');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects a report for another repository before an API request', async () => {
    const request = vi.fn();
    await expect(
      publishAdaptiveReport(
        { ...report(), repo: 'other/repo' },
        { ...OPTIONS, request },
      ),
    ).rejects.toThrow('repo does not match');
    expect(request).not.toHaveBeenCalled();
  });

  it('rejects changed policy provenance before an API request', async () => {
    const request = vi.fn();
    await expect(
      publishAdaptiveReport(
        { ...report(), policyDigest: 'e'.repeat(64) },
        { ...OPTIONS, request },
      ),
    ).rejects.toThrow('policyDigest does not match');
    expect(request).not.toHaveBeenCalled();
  });

  it('refuses a report whose head changed before reading comments', async () => {
    const request = vi.fn(() =>
      Promise.resolve({ head: { sha: 'c'.repeat(40) }, base: { sha: BASE } }),
    );

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, request }),
    ).rejects.toThrow('PR head changed');
    expect(request).toHaveBeenCalledExactlyOnceWith(PR_PATH);
  });

  it('refuses a report whose base changed before reading comments', async () => {
    const request = vi.fn(() =>
      Promise.resolve({ head: { sha: HEAD }, base: { sha: 'c'.repeat(40) } }),
    );

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, request }),
    ).rejects.toThrow('PR base changed');
    expect(request).toHaveBeenCalledExactlyOnceWith(PR_PATH);
  });

  it('updates only the configured App bot comment, including on later pages', async () => {
    const firstPage = [
      comment(1, 'human'),
      comment(2, 'another-app[bot]'),
      comment(3, OPTIONS.appLogin, 'Unrelated comment'),
      ...Array.from({ length: 97 }, (_, index) =>
        comment(index + 4, 'human', 'Unrelated comment'),
      ),
    ];
    let headReads = 0;
    const request = vi.fn((url: string, method = 'GET', body?: object) => {
      if (url === PR_PATH) {
        headReads++;
        return Promise.resolve({ head: { sha: HEAD }, base: { sha: BASE } });
      }
      if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
        return Promise.resolve(firstPage);
      if (url === `${COMMENTS_PATH}?per_page=100&page=2`)
        return Promise.resolve([comment(101, OPTIONS.appLogin)]);
      if (url === '/repos/getlarge/themoltnet/issues/comments/101') {
        expect(method).toBe('PATCH');
        expectPublishedBody(body);
        return Promise.resolve({});
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await publishAdaptiveReport(report(), { ...OPTIONS, request });

    expect(headReads).toBe(3);
    expect(request).toHaveBeenCalledWith(
      '/repos/getlarge/themoltnet/issues/comments/101',
      'PATCH',
      expect.any(Object),
    );
    expect(request).toHaveBeenLastCalledWith(PR_PATH);
  });

  it('refuses to publish when the head changes during comment lookup', async () => {
    let headReads = 0;
    const request = vi.fn((url: string) => {
      if (url === PR_PATH)
        return Promise.resolve({
          head: { sha: ++headReads === 1 ? HEAD : 'c'.repeat(40) },
          base: { sha: BASE },
        });
      if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
        return Promise.resolve([comment(7, OPTIONS.appLogin)]);
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, request }),
    ).rejects.toThrow('PR head changed before publishing review');
    expect(request).toHaveBeenCalledTimes(3);
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      PR_PATH,
      `${COMMENTS_PATH}?per_page=100&page=1`,
      PR_PATH,
    ]);
  });

  it('refuses to publish when the base changes during comment lookup', async () => {
    let baseReads = 0;
    const request = vi.fn((url: string) => {
      if (url === PR_PATH)
        return Promise.resolve({
          head: { sha: HEAD },
          base: { sha: ++baseReads === 1 ? BASE : 'c'.repeat(40) },
        });
      if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
        return Promise.resolve([comment(7, OPTIONS.appLogin)]);
      throw new Error(`Unexpected request: ${url}`);
    });

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, request }),
    ).rejects.toThrow('PR base changed before publishing review');
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      PR_PATH,
      `${COMMENTS_PATH}?per_page=100&page=1`,
      PR_PATH,
    ]);
  });

  it('posts a new comment when the marker belongs to another account', async () => {
    const request = vi.fn((url: string, method = 'GET', body?: object) => {
      if (url === PR_PATH)
        return Promise.resolve({ head: { sha: HEAD }, base: { sha: BASE } });
      if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
        return Promise.resolve([
          comment(1, 'human'),
          comment(2, 'another-app[bot]'),
        ]);
      if (url === COMMENTS_PATH) {
        expect(method).toBe('POST');
        expectPublishedBody(body);
        return Promise.resolve({});
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await publishAdaptiveReport(report(), { ...OPTIONS, request });

    expect(request).toHaveBeenCalledWith(
      COMMENTS_PATH,
      'POST',
      expect.any(Object),
    );
    expect(request).toHaveBeenLastCalledWith(PR_PATH);
  });

  it.each([
    {
      moved: 'head',
      after: { head: { sha: 'c'.repeat(40) }, base: { sha: BASE } },
      notice: 'head now points at `ccccccc`',
    },
    {
      moved: 'base',
      after: { head: { sha: HEAD }, base: { sha: 'c'.repeat(40) } },
      notice: 'base now points at `ccccccc`',
    },
  ])(
    'replaces a new comment with a stale notice when the $moved moves during publication',
    async ({ after, notice }) => {
      let prReads = 0;
      const bodies: string[] = [];
      const request = vi.fn((url: string, method = 'GET', body?: object) => {
        if (url === PR_PATH)
          return Promise.resolve(
            ++prReads <= 2
              ? { head: { sha: HEAD }, base: { sha: BASE } }
              : after,
          );
        if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
          return Promise.resolve([]);
        if (url === COMMENTS_PATH && method === 'POST')
          return Promise.resolve({ id: 55 });
        if (
          url === '/repos/getlarge/themoltnet/issues/comments/55' &&
          method === 'PATCH'
        ) {
          expectPublishedBody(body);
          bodies.push((body as { body: string }).body);
          return Promise.resolve({});
        }
        throw new Error(`Unexpected request: ${method} ${url}`);
      });

      await expect(
        publishAdaptiveReport(report(), { ...OPTIONS, request }),
      ).rejects.toThrow('replaced it with a stale notice');
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain('## Adaptive review: stale');
      expect(bodies[0]).toContain(notice);
      expect(bodies[0]).toContain(OPTIONS.runUrl);
    },
  );

  it('replaces an updated comment with a stale notice when the head moves after the update', async () => {
    let prReads = 0;
    const patches: string[] = [];
    const request = vi.fn((url: string, method = 'GET', body?: object) => {
      if (url === PR_PATH)
        return Promise.resolve({
          head: { sha: ++prReads <= 2 ? HEAD : 'c'.repeat(40) },
          base: { sha: BASE },
        });
      if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
        return Promise.resolve([comment(9, OPTIONS.appLogin)]);
      if (url === '/repos/getlarge/themoltnet/issues/comments/9') {
        expect(method).toBe('PATCH');
        patches.push((body as { body: string }).body);
        return Promise.resolve({});
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, request }),
    ).rejects.toThrow('replaced it with a stale notice');
    expect(patches).toHaveLength(2);
    expect(patches[0]).toContain('## Adaptive review\n');
    expect(patches[1]).toContain('## Adaptive review: stale');
  });

  it('requires an App login before making any GitHub request', async () => {
    const request = vi.fn(() => Promise.resolve({}));

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, appLogin: '', request }),
    ).rejects.toThrow('GitHub App login is required');
    expect(request).not.toHaveBeenCalled();
  });
});

function concern(
  lane: LaneResult['lane'],
  findings: LaneResult['findings'],
): LaneResult {
  return {
    lane,
    status: 'concern',
    summary: `${lane} summary`,
    taskIds: [],
    findings,
  };
}

const TESTS_FINDING = {
  path: 'src/a.ts',
  side: 'new' as const,
  line: 7,
  concern: 'No test covers the new branch',
  action: 'Add a case to a.test.ts',
};
const CONVENTIONS_FINDING = {
  path: 'src/b.ts',
  side: 'old' as const,
  line: 3,
  concern: 'Removed the config.ts indirection',
};
const TESTS_KEY = 'tests:new:7:src%2Fa.ts';

interface Calls {
  reviews: object[];
  summaries: string[];
  deleted: string[];
}

function calls(): Calls {
  return { reviews: [], summaries: [], deleted: [] };
}

interface ExistingThread {
  login: string;
  body: string;
  isResolved?: boolean;
}

/** GraphQL `reviewThreads` for the given threads, in one page. */
function threadsGraphQL(threads: ExistingThread[]) {
  return vi.fn(() =>
    Promise.resolve({
      repository: {
        pullRequest: {
          reviewThreads: {
            pageInfo: { hasNextPage: false, endCursor: null },
            nodes: threads.map((thread, index) => ({
              id: `T${index}`,
              isResolved: thread.isResolved ?? false,
              isOutdated: false,
              path: 'src/a.ts',
              resolvedBy: null,
              comments: {
                nodes: [
                  {
                    // GraphQL drops the [bot] suffix REST logins carry.
                    author: { login: thread.login.replace(/\[bot\]$/, '') },
                    body: thread.body,
                    url: `https://github.com/x/${index}`,
                    originalCommit: { oid: HEAD },
                  },
                ],
              },
            })),
          },
        },
      },
    }),
  );
}

/**
 * A PR that stays on the reviewed head, or moves to `movedHead` once the
 * summary is written.
 */
function stableRequest(
  recorded: Calls,
  reviewResponse: () => Promise<unknown> = () => Promise.resolve({ id: 1 }),
  movedHead?: string,
) {
  return vi.fn((url: string, method = 'GET', body?: object) => {
    if (url === PR_PATH)
      return Promise.resolve({
        head: {
          sha: movedHead && recorded.summaries.length ? movedHead : HEAD,
        },
        base: { sha: BASE },
      });
    if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
      return Promise.resolve([]);
    if (url === REVIEWS_PATH && method === 'POST') {
      recorded.reviews.push(body ?? {});
      return reviewResponse();
    }
    if (url === `${REVIEWS_PATH}/1/comments?per_page=100&page=1`)
      return Promise.resolve([{ id: 11 }, { id: 12 }]);
    if (method === 'DELETE') {
      recorded.deleted.push(url);
      return Promise.resolve(undefined);
    }
    if (url === COMMENTS_PATH && method === 'POST') {
      recorded.summaries.push((body as { body: string }).body);
      return Promise.resolve({ id: 9 });
    }
    if (url === '/repos/getlarge/themoltnet/issues/comments/9') {
      recorded.summaries.push((body as { body: string }).body);
      return Promise.resolve({});
    }
    throw new Error(`Unexpected request: ${method} ${url}`);
  });
}

function reviewComments(review: object): Array<{ path: string; body: string }> {
  return (review as { comments: Array<{ path: string; body: string }> })
    .comments;
}

describe('publishAdaptiveReport inline threads', () => {
  it('posts each cited finding as a review thread on the reviewed head', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const withFindings = {
      ...report(),
      results: [
        concern('tests', [TESTS_FINDING]),
        concern('conventions', [CONVENTIONS_FINDING]),
        concern('security', [
          {
            path: 'src/c.ts',
            side: 'new',
            line: 1,
            concern: 'Medium severity: guard bypass',
          },
        ]),
        concern('complexity', [{ path: '', concern: 'blast_radius: wide' }]),
      ],
    };

    // Act
    await publishAdaptiveReport(withFindings, {
      ...OPTIONS,
      request,
      graphql: threadsGraphQL([]),
    });

    // Assert
    expect(recorded.reviews).toHaveLength(1);
    expect(recorded.reviews[0]).toMatchObject({
      commit_id: HEAD,
      event: 'COMMENT',
      comments: [
        { path: 'src/a.ts', line: 7, side: 'RIGHT' },
        { path: 'src/b.ts', line: 3, side: 'LEFT' },
        { path: 'src/c.ts', line: 1, side: 'RIGHT' },
      ],
    });
    const [first] = reviewComments(recorded.reviews[0]);
    expect(
      first.body.startsWith(
        `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} run=${OPTIONS.runUrl} correlation=test -->`,
      ),
    ).toBe(true);
    expect(first.body).toContain('Suggested action: Add a case to a.test.ts');
    expect(first.body).toContain(
      'Assess this finding; fix confirmed problems or explain why no change is needed.',
    );
    expect(reviewComments(recorded.reviews[0])[2].body).toContain(
      '**Adaptive review · security**',
    );
    expect(recorded.summaries[0]).toContain(
      'Findings: 4 (3 posted as new review threads, 0 already open from an earlier run, 1 listed below)',
    );
    expect(recorded.summaries[0]).toContain('blast_radius: wide');
    expect(recorded.summaries[0]).not.toContain('src/a.ts:7');
  });

  it('does not repeat a finding the reviewer has an open thread for', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const graphql = threadsGraphQL([
      {
        login: OPTIONS.appLogin,
        body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} run=x correlation=y -->\nolder`,
      },
      {
        login: 'human',
        body: `${ADAPTIVE_FINDING_MARKER}conventions:old:3:src%2Fb.ts -->`,
      },
    ]);
    const withFindings = {
      ...report(),
      results: [
        concern('tests', [TESTS_FINDING]),
        concern('conventions', [CONVENTIONS_FINDING]),
      ],
    };

    // Act
    await publishAdaptiveReport(withFindings, {
      ...OPTIONS,
      request,
      graphql,
    });

    // Assert
    expect(reviewComments(recorded.reviews[0])).toHaveLength(1);
    expect(recorded.reviews[0]).toMatchObject({
      comments: [{ path: 'src/b.ts', line: 3, side: 'LEFT' }],
    });
    expect(recorded.summaries[0]).toContain(
      'Findings: 2 (1 posted as new review threads, 1 already open from an earlier run)',
    );
  });

  it('lists a finding whose earlier thread was resolved instead of reopening it', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const graphql = threadsGraphQL([
      {
        login: OPTIONS.appLogin,
        body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->\nan older concern`,
        isResolved: true,
      },
    ]);

    // Act
    await publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql },
    );

    // Assert
    expect(recorded.reviews).toHaveLength(0);
    expect(recorded.summaries[0]).toContain(
      'Findings: 1 (0 posted as new review threads, 0 already open from an earlier run, 1 listed below)',
    );
    expect(recorded.summaries[0]).toContain(
      'src/a.ts:7: No test covers the new branch _(an earlier thread on this line was resolved)_',
    );
  });

  it('treats a key as open when one of its threads is still open', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const body = `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->`;
    const graphql = threadsGraphQL([
      { login: OPTIONS.appLogin, body, isResolved: true },
      { login: OPTIONS.appLogin, body },
    ]);

    // Act
    await publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql },
    );

    // Assert
    expect(recorded.reviews).toHaveLength(0);
    expect(recorded.summaries[0]).toContain(
      '1 already open from an earlier run',
    );
    expect(recorded.summaries[0]).not.toContain('was resolved');
  });

  it('skips the review call when every finding already has a thread', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const graphql = threadsGraphQL([
      {
        login: OPTIONS.appLogin,
        body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->`,
      },
    ]);

    // Act
    await publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql },
    );

    // Assert
    expect(recorded.reviews).toHaveLength(0);
    expect(recorded.summaries[0]).toContain(
      'Findings: 1 (0 posted as new review threads, 1 already open from an earlier run)',
    );
  });

  it('lists every finding of a lane in the summary when GitHub rejects the threads', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded, () =>
      Promise.reject(
        Object.assign(new Error('Unprocessable'), { status: 422 }),
      ),
    );
    const write = vi
      .spyOn(process.stdout, 'write')
      .mockImplementation(() => true);
    const findings = [3, 5, 7, 9].map((line) => ({
      ...TESTS_FINDING,
      line,
      concern: `Untested branch at ${line}`,
    }));

    // Act
    await publishAdaptiveReport(
      { ...report(), results: [concern('tests', findings)] },
      { ...OPTIONS, request, graphql: threadsGraphQL([]) },
    );

    // Assert
    write.mockRestore();
    expect(recorded.reviews).toHaveLength(1);
    expect(recorded.summaries[0]).toContain(
      'Findings: 4 (0 posted as new review threads, 0 already open from an earlier run, 4 listed below)',
    );
    for (const line of [3, 5, 7, 9])
      expect(recorded.summaries[0]).toContain(
        `src/a.ts:${line}: Untested branch at ${line}`,
      );
  });

  it('caps the listed findings and points at the run for the rest', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const findings = Array.from({ length: 33 }, (_, index) => ({
      path: `src/f${index}.ts`,
      concern: `unanchored ${index}`,
    }));

    // Act
    await publishAdaptiveReport(
      { ...report(), results: [concern('tests', findings)] },
      { ...OPTIONS, request, graphql: threadsGraphQL([]) },
    );

    // Assert
    expect(recorded.summaries[0]).toContain('src/f29.ts: unanchored 29');
    expect(recorded.summaries[0]).not.toContain('src/f30.ts');
    expect(recorded.summaries[0]).toContain(
      `3 more findings are not shown here; the [workflow run](${OPTIONS.runUrl}) has the full report.`,
    );
  });

  it('fails on any other review error without writing the summary', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded, () =>
      Promise.reject(Object.assign(new Error('Forbidden'), { status: 403 })),
    );

    // Act
    const published = publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql: threadsGraphQL([]) },
    );

    // Assert
    await expect(published).rejects.toThrow('Forbidden');
    expect(recorded.summaries).toHaveLength(0);
  });

  it('opens no thread when the head moves before the last pre-write check', async () => {
    // Arrange
    const recorded = calls();
    let headReads = 0;
    const request = vi.fn((url: string, method = 'GET', body?: object) => {
      if (url === PR_PATH) {
        headReads++;
        return Promise.resolve({
          head: { sha: headReads === 1 ? HEAD : 'e'.repeat(40) },
          base: { sha: BASE },
        });
      }
      if (url === `${COMMENTS_PATH}?per_page=100&page=1`)
        return Promise.resolve([]);
      recorded.reviews.push(body ?? {});
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    const graphql = threadsGraphQL([]);

    // Act
    const published = publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql },
    );

    // Assert
    await expect(published).rejects.toThrow(
      'PR head changed before publishing',
    );
    expect(recorded.reviews).toHaveLength(0);
    expect(graphql).not.toHaveBeenCalled();
  });

  it('withdraws the threads it opened when the head moves after publishing', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(
      recorded,
      () => Promise.resolve({ id: 1 }),
      'e'.repeat(40),
    );

    // Act
    const published = publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql: threadsGraphQL([]) },
    );

    // Assert
    await expect(published).rejects.toThrow('replaced it with a stale notice');
    expect(recorded.reviews).toHaveLength(1);
    expect(recorded.summaries.at(-1)).toContain('stale');
    expect(recorded.deleted).toEqual([
      '/repos/getlarge/themoltnet/pulls/comments/11',
      '/repos/getlarge/themoltnet/pulls/comments/12',
    ]);
  });

  it('requires a GraphQL client before writing anything when findings exist', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);

    // Act
    const published = publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request },
    );

    // Assert
    await expect(published).rejects.toThrow('GraphQL client is required');
    expect(recorded.summaries).toHaveLength(0);
  });

  it('keeps every finding in the summary when inline threads are disabled', async () => {
    // Arrange
    const recorded = calls();
    const request = stableRequest(recorded);
    const graphql = threadsGraphQL([]);

    // Act
    await publishAdaptiveReport(
      { ...report(), results: [concern('tests', [TESTS_FINDING])] },
      { ...OPTIONS, request, graphql, inlineFindings: false },
    );

    // Assert
    expect(recorded.reviews).toHaveLength(0);
    expect(graphql).not.toHaveBeenCalled();
    expect(recorded.summaries[0]).toContain('Findings: 1.');
    expect(recorded.summaries[0]).toContain(
      'src/a.ts:7: No test covers the new branch',
    );
  });
});

describe('continuing focused findings', () => {
  it('reuses an open thread at another anchor while publishing an unrelated concern', async () => {
    const recorded = calls();
    await publishAdaptiveReport(
      {
        ...report(),
        results: [
          concern('tests', [
            { ...TESTS_FINDING, line: 9, existingFindingKey: TESTS_KEY },
            {
              ...TESTS_FINDING,
              line: 10,
              concern: 'A different changed branch needs coverage.',
            },
          ]),
        ],
      },
      {
        ...OPTIONS,
        request: stableRequest(recorded),
        graphql: threadsGraphQL([
          {
            login: OPTIONS.appLogin,
            body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->`,
          },
        ]),
      },
    );
    expect(recorded.reviews).toHaveLength(1);
    expect(reviewComments(recorded.reviews[0])).toHaveLength(1);
    expect(reviewComments(recorded.reviews[0])[0].body).toContain(
      'A different changed branch',
    );
    expect(recorded.summaries[0]).toContain('1 linked to open threads');
    expect(recorded.summaries[0]).toContain(TESTS_FINDING.concern);
    expect(recorded.summaries[0]).toContain('src/a.ts:9');
    expect(recorded.summaries[0]).toContain(
      '[Referenced earlier thread](https://github.com/x/0)',
    );
  });

  it('keeps a concern visible in the summary if its thread resolves during review', async () => {
    const recorded = calls();
    await publishAdaptiveReport(
      {
        ...report(),
        results: [
          concern('tests', [
            { ...TESTS_FINDING, line: 9, existingFindingKey: TESTS_KEY },
          ]),
        ],
      },
      {
        ...OPTIONS,
        request: stableRequest(recorded),
        graphql: threadsGraphQL([
          {
            login: OPTIONS.appLogin,
            isResolved: true,
            body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->`,
          },
        ]),
      },
    );
    expect(recorded.reviews).toEqual([]);
    expect(recorded.summaries[0]).toContain(TESTS_FINDING.concern);
    expect(recorded.summaries[0]).toContain('src/a.ts:9');
    expect(recorded.summaries[0]).toContain(
      'the referenced earlier thread was resolved',
    );
  });

  it.each([false, true])(
    'keeps a different current concern visible when it reuses an earlier key, including after summary overflow: %s',
    async (overflow) => {
      const recorded = calls();
      const differentConcern =
        'The changed retry path has no termination case in its tests.';
      await publishAdaptiveReport(
        {
          ...report(),
          results: [
            ...(overflow
              ? [
                  concern(
                    'complexity',
                    Array.from({ length: 31 }, (_, index) => ({
                      path: '',
                      concern: `Other concern ${index}`,
                    })),
                  ),
                ]
              : []),
            concern('tests', [
              {
                ...TESTS_FINDING,
                line: 12,
                concern: differentConcern,
                existingFindingKey: TESTS_KEY,
              },
            ]),
          ],
        },
        {
          ...OPTIONS,
          request: stableRequest(recorded),
          graphql: threadsGraphQL([
            {
              login: OPTIONS.appLogin,
              body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->\n${TESTS_FINDING.concern}`,
            },
          ]),
        },
      );
      expect(recorded.reviews).toEqual([]);
      expect(recorded.summaries[0]).toContain(
        `src/a.ts:12: ${differentConcern}`,
      );
      expect(recorded.summaries[0]).toContain(
        'also shown below for comparison',
      );
      expect(recorded.summaries[0]).toContain(
        '[Referenced earlier thread](https://github.com/x/0)',
      );
      if (overflow)
        expect(recorded.summaries[0]).toContain(
          '1 more findings are not shown here',
        );
    },
  );

  it.each(['human', 'wrong-path', 'wrong-lane', 'missing'])(
    'rejects %s references before publication',
    async (kind) => {
      const recorded = calls();
      const finding = {
        ...TESTS_FINDING,
        line: 9,
        existingFindingKey: TESTS_KEY,
        ...(kind === 'wrong-path' ? { path: 'other.ts' } : {}),
      };
      await expect(
        publishAdaptiveReport(
          {
            ...report(),
            results: [
              concern(kind === 'wrong-lane' ? 'conventions' : 'tests', [
                finding,
              ]),
            ],
          },
          {
            ...OPTIONS,
            request: stableRequest(recorded),
            graphql: threadsGraphQL(
              kind === 'missing'
                ? []
                : [
                    {
                      login: kind === 'human' ? 'human' : OPTIONS.appLogin,
                      body: `${ADAPTIVE_FINDING_MARKER}${TESTS_KEY} -->`,
                    },
                  ],
            ),
          },
        ),
      ).rejects.toThrow('unavailable prior review thread');
      expect(recorded.reviews).toEqual([]);
      expect(recorded.summaries).toEqual([]);
    },
  );
});
