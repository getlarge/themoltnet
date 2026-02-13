import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handlePublicFeedBrowse,
  handlePublicFeedRead,
} from '../src/public-feed-tools.js';
import type { McpDeps } from '../src/types.js';
import {
  createMockDeps,
  ENTRY_ID,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  getPublicFeed: vi.fn(),
  getPublicEntry: vi.fn(),
}));

import { getPublicEntry, getPublicFeed } from '@moltnet/api-client';

describe('Public feed tools', () => {
  let deps: McpDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('public_feed_browse', () => {
    it('returns feed entries', async () => {
      const feedData = {
        items: [
          {
            id: ENTRY_ID,
            title: null,
            content: 'Hello world',
            tags: ['test'],
            createdAt: '2026-02-10T10:00:00Z',
            author: {
              fingerprint: 'C212-DAFA-27C5-6C57',
              publicKey: 'ed25519:test',
            },
          },
        ],
        nextCursor: null,
      };
      vi.mocked(getPublicFeed).mockResolvedValue(sdkOk(feedData) as never);

      const result = await handlePublicFeedBrowse({}, deps);

      expect(result.isError).toBeFalsy();
      const parsed = parseResult<typeof feedData>(result);
      expect(parsed.items).toHaveLength(1);
      expect(parsed.nextCursor).toBeNull();
    });

    it('passes limit, cursor, and tag to API', async () => {
      vi.mocked(getPublicFeed).mockResolvedValue(
        sdkOk({ items: [], nextCursor: null }) as never,
      );

      await handlePublicFeedBrowse(
        { limit: 5, cursor: 'abc123', tag: 'reflection' },
        deps,
      );

      expect(getPublicFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 5, cursor: 'abc123', tag: 'reflection' },
        }),
      );
    });

    it('uses default limit of 20', async () => {
      vi.mocked(getPublicFeed).mockResolvedValue(
        sdkOk({ items: [], nextCursor: null }) as never,
      );

      await handlePublicFeedBrowse({}, deps);

      expect(getPublicFeed).toHaveBeenCalledWith(
        expect.objectContaining({
          query: expect.objectContaining({ limit: 20 }),
        }),
      );
    });

    it('returns error on API failure', async () => {
      vi.mocked(getPublicFeed).mockResolvedValue(
        sdkErr({
          error: 'internal_error',
          message: 'Server error',
          statusCode: 500,
        }) as never,
      );

      const result = await handlePublicFeedBrowse({}, deps);

      expect(result.isError).toBe(true);
    });
  });

  describe('public_feed_read', () => {
    it('returns a single entry', async () => {
      const entry = {
        id: ENTRY_ID,
        title: 'My Reflection',
        content: 'Deep thoughts...',
        tags: ['reflection'],
        createdAt: '2026-02-10T10:00:00Z',
        author: {
          fingerprint: 'C212-DAFA-27C5-6C57',
          publicKey: 'ed25519:test',
        },
      };
      vi.mocked(getPublicEntry).mockResolvedValue(sdkOk(entry) as never);

      const result = await handlePublicFeedRead({ entry_id: ENTRY_ID }, deps);

      expect(result.isError).toBeFalsy();
      const parsed = parseResult<typeof entry>(result);
      expect(parsed.id).toBe(ENTRY_ID);
      expect(parsed.author.fingerprint).toBe('C212-DAFA-27C5-6C57');
    });

    it('returns "Entry not found" on 404', async () => {
      vi.mocked(getPublicEntry).mockResolvedValue(
        sdkErr({
          error: 'not_found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handlePublicFeedRead({ entry_id: ENTRY_ID }, deps);

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain('Entry not found');
    });

    it('surfaces upstream error message on non-404 failure', async () => {
      vi.mocked(getPublicEntry).mockResolvedValue(
        sdkErr({
          error: 'internal_error',
          message: 'Database connection failed',
          statusCode: 500,
        }) as never,
      );

      const result = await handlePublicFeedRead({ entry_id: ENTRY_ID }, deps);

      expect(result.isError).toBe(true);
      const text = (result.content as Array<{ text: string }>)[0].text;
      expect(text).toContain('Database connection failed');
    });

    it('passes entry_id as path parameter', async () => {
      vi.mocked(getPublicEntry).mockResolvedValue(
        sdkOk({ id: ENTRY_ID }) as never,
      );

      await handlePublicFeedRead({ entry_id: ENTRY_ID }, deps);

      expect(getPublicEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
        }),
      );
    });
  });
});
