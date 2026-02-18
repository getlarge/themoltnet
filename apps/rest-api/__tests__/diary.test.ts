import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockEntry,
  createMockServices,
  createTestApp,
  ENTRY_ID,
  type MockServices,
  OTHER_AGENT_ID,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

describe('Diary routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  describe('POST /diary/entries', () => {
    it('creates an entry', async () => {
      const mockEntry = createMockEntry();
      mocks.diaryService.create.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/entries',
        headers: authHeaders,
        payload: { content: 'Test diary entry content' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().content).toBe('Test diary entry content');
      expect(mocks.diaryService.create).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        content: 'Test diary entry content',
        title: undefined,
        visibility: undefined,
        tags: undefined,
      });
    });

    it('creates entry with all optional fields', async () => {
      const mockEntry = createMockEntry({
        title: 'My Title',
        visibility: 'moltnet',
        tags: ['test'],
      });
      mocks.diaryService.create.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/entries',
        headers: authHeaders,
        payload: {
          content: 'Test content',
          title: 'My Title',
          visibility: 'moltnet',
          tags: ['test'],
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('rejects empty content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/diary/entries',
        headers: authHeaders,
        payload: { content: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/diary/entries',
        payload: { content: 'test' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('UNAUTHORIZED');
    });
  });

  describe('GET /diary/entries', () => {
    it('lists entries for authenticated user', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      mocks.diaryService.list.mockResolvedValue(entries);

      const response = await app.inject({
        method: 'GET',
        url: '/diary/entries',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(2);
    });

    it('passes query parameters through', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/diary/entries?limit=10&offset=5',
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });

    it('passes tags filter from query string', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/diary/entries?tags=accountable-commit,high-risk',
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['accountable-commit', 'high-risk'],
        }),
      );
    });

    it('passes single tag from query string', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/diary/entries?tags=deploy',
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['deploy'],
        }),
      );
    });

    it('rejects empty tag in comma-separated list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/diary/entries?tags=deploy,,staging',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects tag longer than 50 characters', async () => {
      const longTag = 'a'.repeat(51);
      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries?tags=${longTag}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects more than 20 tags', async () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`).join(',');
      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries?tags=${tags}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('omits tags when not in query string', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: '/diary/entries',
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: undefined,
        }),
      );
    });
  });

  describe('GET /diary/entries/:id', () => {
    it('returns entry when found', async () => {
      mocks.diaryService.getById.mockResolvedValue(createMockEntry());

      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(ENTRY_ID);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe('PATCH /diary/entries/:id', () => {
    it('updates entry', async () => {
      const updated = createMockEntry({ title: 'Updated' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().title).toBe('Updated');
    });

    it('returns 404 when not found or not owner', async () => {
      mocks.diaryService.update.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe('DELETE /diary/entries/:id', () => {
    it('deletes entry', async () => {
      mocks.diaryService.delete.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.delete.mockResolvedValue(false);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe('POST /diary/search', () => {
    it('searches with query', async () => {
      mocks.diaryService.search.mockResolvedValue([createMockEntry()]);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/search',
        headers: authHeaders,
        payload: { query: 'test query' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().results).toHaveLength(1);
    });

    it('searches without query (lists all)', async () => {
      mocks.diaryService.search.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/search',
        headers: authHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes tags filter to service', async () => {
      mocks.diaryService.search.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/search',
        headers: authHeaders,
        payload: { query: 'test', tags: ['accountable-commit'] },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['accountable-commit'],
        }),
      );
    });

    it('passes multiple tags to service', async () => {
      mocks.diaryService.search.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/diary/search',
        headers: authHeaders,
        payload: { tags: ['tag-a', 'tag-b'] },
      });

      expect(mocks.diaryService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag-a', 'tag-b'],
        }),
      );
    });

    it('omits tags when not provided', async () => {
      mocks.diaryService.search.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/diary/search',
        headers: authHeaders,
        payload: { query: 'test' },
      });

      expect(mocks.diaryService.search).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: undefined,
        }),
      );
    });
  });

  describe('GET /diary/reflect', () => {
    it('returns reflection digest', async () => {
      mocks.diaryService.reflect.mockResolvedValue({
        entries: [],
        totalEntries: 0,
        periodDays: 7,
        generatedAt: '2026-01-30T10:00:00Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/diary/reflect',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().periodDays).toBe(7);
    });
  });

  describe('POST /diary/entries/:id/share', () => {
    it('shares entry with another agent', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue({
        identityId: OTHER_AGENT_ID,
        fingerprint: 'B2C3-D4E5-F607-A8B9',
      });
      mocks.diaryService.share.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: `/diary/entries/${ENTRY_ID}/share`,
        headers: authHeaders,
        payload: { sharedWith: 'B2C3-D4E5-F607-A8B9' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when target agent not found', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: `/diary/entries/${ENTRY_ID}/share`,
        headers: authHeaders,
        payload: { sharedWith: 'AAAA-BBBB-CCCC-DDDD' },
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('returns 403 when share is not allowed', async () => {
      mocks.agentRepository.findByFingerprint.mockResolvedValue({
        identityId: OTHER_AGENT_ID,
        fingerprint: 'B2C3-D4E5-F607-A8B9',
      });
      mocks.diaryService.share.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: `/diary/entries/${ENTRY_ID}/share`,
        headers: authHeaders,
        payload: { sharedWith: 'B2C3-D4E5-F607-A8B9' },
      });

      expect(response.statusCode).toBe(403);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('FORBIDDEN');
    });
  });

  describe('GET /diary/shared-with-me', () => {
    it('returns shared entries', async () => {
      mocks.diaryService.getSharedWithMe.mockResolvedValue([
        createMockEntry({ ownerId: OTHER_AGENT_ID }),
      ]);

      const response = await app.inject({
        method: 'GET',
        url: '/diary/shared-with-me',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().entries).toHaveLength(1);
    });
  });

  describe('embedding exclusion', () => {
    it('does not include embedding in POST /diary/entries response', async () => {
      const mockEntry = createMockEntry({ embedding: [0.1, 0.2, 0.3] });
      mocks.diaryService.create.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/entries',
        headers: authHeaders,
        payload: { content: 'Test content' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).not.toHaveProperty('embedding');
    });

    it('does not include embedding in GET /diary/entries response', async () => {
      const entries = [
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
        createMockEntry({ id: 'other-id', embedding: [0.4, 0.5, 0.6] }),
      ];
      mocks.diaryService.list.mockResolvedValue(entries);

      const response = await app.inject({
        method: 'GET',
        url: '/diary/entries',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      for (const item of body.items) {
        expect(item).not.toHaveProperty('embedding');
      }
    });

    it('does not include embedding in GET /diary/entries/:id response', async () => {
      mocks.diaryService.getById.mockResolvedValue(
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).not.toHaveProperty('embedding');
    });

    it('does not include embedding in POST /diary/search response', async () => {
      mocks.diaryService.search.mockResolvedValue([
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/search',
        headers: authHeaders,
        payload: { query: 'test' },
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      for (const result of body.results) {
        expect(result).not.toHaveProperty('embedding');
      }
    });
  });

  describe('PATCH /diary/entries/:id/visibility', () => {
    it('updates visibility', async () => {
      const updated = createMockEntry({ visibility: 'public' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}/visibility`,
        headers: authHeaders,
        payload: { visibility: 'public' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().visibility).toBe('public');
    });

    it('rejects invalid visibility', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}/visibility`,
        headers: authHeaders,
        payload: { visibility: 'secret' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
