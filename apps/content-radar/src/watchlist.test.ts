import { describe, expect, it } from 'vitest';

import { parseWatchlist, watchlistSha256 } from './watchlist.js';

const VALID = {
  version: 1,
  repos: [
    {
      slug: 'themoltnet',
      repository: 'getlarge/themoltnet',
      sinceDays: 30,
      diaryId: '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396',
    },
  ],
  segments: [
    {
      slug: 'agent-runtimes',
      title: 'Agent runtimes',
      organisations: ['Anthropic', 'OpenAI'],
      queries: ['headless agent orchestration'],
      sinceDays: 21,
    },
  ],
};

function watchlist(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...VALID, ...overrides });
}

describe('parseWatchlist', () => {
  it('accepts a well-formed watchlist', () => {
    // Arrange / Act
    const parsed = parseWatchlist(watchlist());

    // Assert
    expect(parsed.repos).toHaveLength(1);
    expect(parsed.repos[0].repository).toBe('getlarge/themoltnet');
    expect(parsed.segments[0].organisations).toEqual(['Anthropic', 'OpenAI']);
  });

  it.each([
    ['not json at all', 'must be strict JSON'],
    [JSON.stringify([]), 'must be a JSON object'],
    [watchlist({ version: 2 }), 'watchlist.version must be 1'],
    [watchlist({ repos: [] }), 'watchlist.repos must be a non-empty array'],
    [
      watchlist({ segments: [] }),
      'watchlist.segments must be a non-empty array',
    ],
  ])('rejects %#', (source, message) => {
    expect(() => parseWatchlist(source)).toThrow(message);
  });

  it('rejects a repository that is not owner/name', () => {
    const source = watchlist({
      repos: [{ slug: 'x', repository: 'themoltnet', sinceDays: 5 }],
    });
    expect(() => parseWatchlist(source)).toThrow('must be owner/name');
  });

  it('rejects a non-kebab slug so signal ids stay stable', () => {
    const source = watchlist({
      repos: [
        {
          slug: 'The Moltnet',
          repository: 'getlarge/themoltnet',
          sinceDays: 5,
        },
      ],
    });
    expect(() => parseWatchlist(source)).toThrow('must be a kebab-case slug');
  });

  it('rejects duplicate slugs that would collide signal ids', () => {
    const source = watchlist({
      repos: [
        { slug: 'a', repository: 'getlarge/one', sinceDays: 5 },
        { slug: 'a', repository: 'getlarge/two', sinceDays: 5 },
      ],
    });
    expect(() => parseWatchlist(source)).toThrow('duplicate slug a');
  });

  it('rejects a lookback window beyond the supported range', () => {
    const source = watchlist({
      repos: [{ slug: 'a', repository: 'getlarge/one', sinceDays: 400 }],
    });
    expect(() => parseWatchlist(source)).toThrow('between 1 and 90');
  });
});

describe('watchlistSha256', () => {
  it('is stable across key order and organisation order', () => {
    // Arrange
    const first = parseWatchlist(watchlist());
    const second = parseWatchlist(
      JSON.stringify({
        segments: [
          {
            sinceDays: 21,
            queries: ['headless agent orchestration'],
            organisations: ['OpenAI', 'Anthropic'],
            title: 'Agent runtimes',
            slug: 'agent-runtimes',
          },
        ],
        repos: VALID.repos,
        version: 1,
      }),
    );

    // Act / Assert
    expect(watchlistSha256(first)).toBe(watchlistSha256(second));
  });

  it('changes when the scope changes', () => {
    const base = parseWatchlist(watchlist());
    const widened = parseWatchlist(
      watchlist({
        segments: [
          {
            ...VALID.segments[0],
            organisations: ['Anthropic', 'OpenAI', 'Google'],
          },
        ],
      }),
    );
    expect(watchlistSha256(base)).not.toBe(watchlistSha256(widened));
  });
});
