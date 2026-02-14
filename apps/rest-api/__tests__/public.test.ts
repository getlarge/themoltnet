import type { PublicFeedEntry } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  ENTRY_ID,
  type MockServices,
} from './helpers.js';

function createMockPublicEntry(
  overrides: Partial<PublicFeedEntry> = {},
): PublicFeedEntry {
  return {
    id: ENTRY_ID,
    title: null,
    content: 'A public diary entry',
    tags: ['test'],
    createdAt: new Date('2026-02-10T10:00:00Z'),
    author: {
      fingerprint: 'C212-DAFA-27C5-6C57',
      publicKey: 'ed25519:bW9sdG5ldC10ZXN0LWtleS0xLWZvci11bml0LXRlc3Q=',
    },
    ...overrides,
  };
}

describe('Public feed routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    // No auth context — public routes don't require authentication
    app = await createTestApp(mocks, null);
  });

  describe('GET /public/feed', () => {
    it('returns paginated public entries', async () => {
      const entries = [
        createMockPublicEntry(),
        createMockPublicEntry({
          id: '880e8400-e29b-41d4-a716-446655440099',
          createdAt: new Date('2026-02-09T10:00:00Z'),
        }),
      ];
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: entries,
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      expect(body.nextCursor).toBeNull();
      expect(body.items[0].author.fingerprint).toBe('C212-DAFA-27C5-6C57');
    });

    it('returns nextCursor when more entries exist', async () => {
      const entries = [createMockPublicEntry()];
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: entries,
        hasMore: true,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed?limit=1',
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.nextCursor).toBeTruthy();
      expect(typeof body.nextCursor).toBe('string');
    });

    it('passes cursor to repository', async () => {
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      // Encode a valid cursor
      const cursor = Buffer.from(
        JSON.stringify({
          c: '2026-02-10T10:00:00.000Z',
          i: ENTRY_ID,
        }),
      ).toString('base64url');

      await app.inject({
        method: 'GET',
        url: `/public/feed?cursor=${cursor}`,
      });

      expect(mocks.diaryRepository.listPublic).toHaveBeenCalledWith({
        cursor: {
          createdAt: '2026-02-10T10:00:00.000Z',
          id: ENTRY_ID,
        },
        limit: 20,
        tag: undefined,
      });
    });

    it('passes tag filter to repository', async () => {
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      await app.inject({
        method: 'GET',
        url: '/public/feed?tag=reflection',
      });

      expect(mocks.diaryRepository.listPublic).toHaveBeenCalledWith({
        cursor: undefined,
        limit: 20,
        tag: 'reflection',
      });
    });

    it('returns 400 for invalid cursor', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/public/feed?cursor=not-valid-base64-json',
      });

      expect(response.statusCode).toBe(400);
    });

    it('does not require authentication', async () => {
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed',
      });

      expect(response.statusCode).toBe(200);
    });

    it('includes Cache-Control header', async () => {
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: [],
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed',
      });

      expect(response.headers['cache-control']).toBe('public, max-age=300');
    });

    it('does not include ownerId or embedding in response', async () => {
      mocks.diaryRepository.listPublic.mockResolvedValue({
        items: [createMockPublicEntry()],
        hasMore: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed',
      });

      const body = response.json();
      expect(body.items[0]).not.toHaveProperty('ownerId');
      expect(body.items[0]).not.toHaveProperty('embedding');
    });
  });

  describe('GET /public/feed/search', () => {
    it('should return search results with author info', async () => {
      const mockResults = [
        {
          id: ENTRY_ID,
          title: 'On Autonomy',
          content: 'Self-governance is the foundation...',
          tags: ['philosophy'],
          createdAt: new Date('2026-02-01T10:00:00Z'),
          author: {
            fingerprint: 'C212-DAFA-27C5-6C57',
            publicKey: 'ed25519:abc',
          },
          score: 0.032,
        },
      ];
      mocks.embeddingService.embedQuery.mockResolvedValue(
        new Array(384).fill(0.1),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue(mockResults);

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=agent+autonomy',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.query).toBe('agent autonomy');
      expect(body.items).toHaveLength(1);
      expect(body.items[0].author.fingerprint).toBe('C212-DAFA-27C5-6C57');
      // Score should NOT be in response
      expect(body.items[0].score).toBeUndefined();
    });

    it('should fall back to FTS when embedding fails', async () => {
      mocks.embeddingService.embedQuery.mockRejectedValue(
        new Error('ONNX failed'),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=test+query',
      });

      expect(response.statusCode).toBe(200);
      // Verify searchPublic was called without embedding
      expect(mocks.diaryRepository.searchPublic).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('should reject missing q parameter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject q shorter than 2 characters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=a',
      });
      expect(response.statusCode).toBe(400);
    });

    it('should reject q longer than 200 characters', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/public/feed/search?q=${'a'.repeat(201)}`,
      });
      expect(response.statusCode).toBe(400);
    });

    it('should respect custom limit', async () => {
      mocks.embeddingService.embedQuery.mockResolvedValue(
        new Array(384).fill(0.1),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=test&limit=5',
      });

      expect(mocks.diaryRepository.searchPublic).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 5 }),
      );
    });

    it('should pass tag filter to repository', async () => {
      mocks.embeddingService.embedQuery.mockResolvedValue(
        new Array(384).fill(0.1),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=test&tag=philosophy',
      });

      expect(mocks.diaryRepository.searchPublic).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['philosophy'] }),
      );
    });

    it('should return empty items for no matches', async () => {
      mocks.embeddingService.embedQuery.mockResolvedValue(
        new Array(384).fill(0.1),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=quantum+blockchain',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.items).toHaveLength(0);
      expect(body.query).toBe('quantum blockchain');
    });

    it('should set Cache-Control header', async () => {
      mocks.embeddingService.embedQuery.mockResolvedValue(
        new Array(384).fill(0.1),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=test',
      });

      expect(response.headers['cache-control']).toBe('public, max-age=60');
    });

    it('should not require authentication', async () => {
      mocks.embeddingService.embedQuery.mockResolvedValue(
        new Array(384).fill(0.1),
      );
      mocks.diaryRepository.searchPublic.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: '/public/feed/search?q=test',
        // No Authorization header
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe('GET /public/entry/:id', () => {
    it('returns a public entry', async () => {
      mocks.diaryRepository.findPublicById.mockResolvedValue(
        createMockPublicEntry(),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/public/entry/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.id).toBe(ENTRY_ID);
      expect(body.author.fingerprint).toBe('C212-DAFA-27C5-6C57');
    });

    it('returns 404 when entry not found', async () => {
      mocks.diaryRepository.findPublicById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/public/entry/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('does not require authentication', async () => {
      mocks.diaryRepository.findPublicById.mockResolvedValue(
        createMockPublicEntry(),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/public/entry/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(200);
    });

    it('includes Cache-Control header with longer TTL', async () => {
      mocks.diaryRepository.findPublicById.mockResolvedValue(
        createMockPublicEntry(),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/public/entry/${ENTRY_ID}`,
      });

      expect(response.headers['cache-control']).toBe('public, max-age=3600');
    });
  });
});
