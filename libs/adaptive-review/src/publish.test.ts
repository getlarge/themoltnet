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

    expect(headReads).toBe(2);
    expect(request).toHaveBeenLastCalledWith(
      '/repos/getlarge/themoltnet/issues/comments/101',
      'PATCH',
      expect.any(Object),
    );
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

    expect(request).toHaveBeenLastCalledWith(
      COMMENTS_PATH,
      'POST',
      expect.any(Object),
    );
  });

  it('requires an App login before making any GitHub request', async () => {
    const request = vi.fn(() => Promise.resolve({}));

    await expect(
      publishAdaptiveReport(report(), { ...OPTIONS, appLogin: '', request }),
    ).rejects.toThrow('GitHub App login is required');
    expect(request).not.toHaveBeenCalled();
  });
});
