import { describe, expect, it, vi } from 'vitest';

import { publishAdaptiveReport } from './publish.js';
import { ADAPTIVE_REVIEW_MARKER } from './report.js';
import type { AdaptiveReport } from './workflow.js';

const HEAD = 'a'.repeat(40);
const BASE = 'b'.repeat(40);
const PR_PATH = '/repos/getlarge/themoltnet/pulls/42';
const COMMENTS_PATH = '/repos/getlarge/themoltnet/issues/42/comments';
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
      expect(bodies[0]).toContain('adaptive review: stale');
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
    expect(patches[0]).toContain('Experimental adaptive review\n');
    expect(patches[1]).toContain('adaptive review: stale');
  });

  it('requires an App login before making any GitHub request', async () => {
    const request = vi.fn(() => Promise.resolve({}));

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, appLogin: '', request }),
    ).rejects.toThrow('GitHub App login is required');
    expect(request).not.toHaveBeenCalled();
  });
});
