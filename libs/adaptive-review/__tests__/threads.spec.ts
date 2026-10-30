import { describe, expect, it, vi } from 'vitest';

import {
  fetchReviewThreads,
  isReviewerThread,
  type ReviewThread,
  sameLogin,
} from '../src/threads.js';

function page(ids: string[], next: string | null) {
  return {
    repository: {
      pullRequest: {
        reviewThreads: {
          pageInfo: { hasNextPage: next !== null, endCursor: next },
          nodes: ids.map((id) => ({ id })),
        },
      },
    },
  };
}

describe('fetchReviewThreads', () => {
  it('follows the cursor until the last page', async () => {
    // Arrange
    const graphql = vi
      .fn()
      .mockResolvedValueOnce(page(['T1'], 'c1'))
      .mockResolvedValueOnce(page(['T2'], null));

    // Act
    const threads = await fetchReviewThreads(graphql, 'getlarge/themoltnet', 7);

    // Assert
    expect(threads.map((thread) => thread.id)).toEqual(['T1', 'T2']);
    expect(graphql).toHaveBeenLastCalledWith(expect.any(String), {
      owner: 'getlarge',
      repo: 'themoltnet',
      pr: 7,
      cursor: 'c1',
    });
  });

  it('fails when the pull request is not visible to the token', async () => {
    // Arrange
    const graphql = vi.fn().mockResolvedValue({ repository: null });

    // Act
    const fetched = fetchReviewThreads(graphql, 'getlarge/themoltnet', 7);

    // Assert
    await expect(fetched).rejects.toThrow(
      'getlarge/themoltnet#7 was not found',
    );
  });
});

describe('reviewer identity', () => {
  it('matches REST and GraphQL logins of the same App, case-insensitively', () => {
    // Arrange
    const thread = {
      comments: { nodes: [{ author: { login: 'LeGreffier' } }] },
    } as ReviewThread;

    // Act
    const own = isReviewerThread(thread, 'legreffier[bot]');
    const other = isReviewerThread(thread, 'legreffier-evil[bot]');

    // Assert
    expect(own).toBe(true);
    expect(other).toBe(false);
    expect(sameLogin('a[bot]', 'b')).toBe(false);
  });

  it('ignores a thread whose author was deleted', () => {
    // Arrange
    const thread = {
      comments: { nodes: [{ author: null }] },
    } as unknown as ReviewThread;

    // Act
    const own = isReviewerThread(thread, 'legreffier[bot]');

    // Assert
    expect(own).toBe(false);
  });
});
