import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockEntry,
  createMockServices,
  createTestApp,
  DIARY_ID,
  ENTRY_ID,
  type MockServices,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

const MOCK_DIARY = {
  id: DIARY_ID,
  ownerId: OWNER_ID,
  name: 'private',
  visibility: 'private' as const,
  signed: false,
  createdAt: new Date('2026-01-30T10:00:00Z'),
  updatedAt: new Date('2026-01-30T10:00:00Z'),
};

describe('Diary routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    // Default: diary is found and owned by the authenticated agent
    mocks.diaryCatalogRepository.findById.mockResolvedValue(MOCK_DIARY);
    mocks.diaryCatalogRepository.findOwnedById.mockResolvedValue(MOCK_DIARY);
    // Default: write/read permission is granted
    mocks.permissionChecker.canWriteDiary.mockResolvedValue(true);
    mocks.permissionChecker.canReadDiary.mockResolvedValue(true);
    mocks.permissionChecker.canManageDiary.mockResolvedValue(true);
  });

  describe(`POST /diaries/${DIARY_ID}/entries`, () => {
    it('creates an entry', async () => {
      const mockEntry = createMockEntry();
      mocks.diaryService.create.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: 'Test diary entry content' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().content).toBe('Test diary entry content');
      expect(mocks.diaryService.create).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        diaryId: DIARY_ID,
        diaryVisibility: 'private',
        content: 'Test diary entry content',
        title: undefined,
        tags: undefined,
        importance: undefined,
        entryType: undefined,
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
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: {
          content: 'Test content',
          title: 'My Title',
          tags: ['test'],
        },
      });

      expect(response.statusCode).toBe(201);
    });

    it('rejects empty content', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        payload: { content: 'test' },
      });

      expect(response.statusCode).toBe(401);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('UNAUTHORIZED');
    });
  });

  describe(`GET /diaries/${DIARY_ID}/entries`, () => {
    it('lists entries for authenticated user', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      mocks.diaryService.list.mockResolvedValue(entries);

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries`,
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
        url: `/diaries/${DIARY_ID}/entries?limit=10&offset=5`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID, limit: 10, offset: 5 }),
      );
    });

    it('passes tags filter from query string', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=accountable-commit,high-risk`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          tags: ['accountable-commit', 'high-risk'],
        }),
      );
    });

    it('passes single tag from query string', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=deploy`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          tags: ['deploy'],
        }),
      );
    });

    it('rejects empty tag in comma-separated list', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=deploy,,staging`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects tag longer than 50 characters', async () => {
      const longTag = 'a'.repeat(51);
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=${longTag}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects more than 20 tags', async () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tag-${i}`).join(',');
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=${tags}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('omits tags when not in query string', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          tags: undefined,
        }),
      );
    });
  });

  describe(`GET /diaries/${DIARY_ID}/entries/:id`, () => {
    it('returns entry when found', async () => {
      mocks.diaryService.getById.mockResolvedValue(createMockEntry());

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(ENTRY_ID);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe(`PATCH /diaries/${DIARY_ID}/entries/:id`, () => {
    it('updates entry', async () => {
      mocks.diaryService.getById.mockResolvedValue(createMockEntry());
      const updated = createMockEntry({ title: 'Updated' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().title).toBe('Updated');
    });

    it('returns 404 when not found or not owner', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
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

  describe(`DELETE /diaries/${DIARY_ID}/entries/:id`, () => {
    it('deletes entry', async () => {
      mocks.diaryService.getById.mockResolvedValue(createMockEntry());
      mocks.diaryService.delete.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain(
        'application/problem+json',
      );
      expect(response.json().code).toBe('NOT_FOUND');
    });
  });

  describe('POST /diaries/search', () => {
    it('searches with query', async () => {
      mocks.diaryService.search.mockResolvedValue([createMockEntry()]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
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
        url: '/diaries/search',
        headers: authHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes tags filter to service', async () => {
      mocks.diaryService.search.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
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
        url: '/diaries/search',
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
        url: '/diaries/search',
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

  describe('GET /diaries/reflect', () => {
    it('returns reflection digest', async () => {
      mocks.diaryService.reflect.mockResolvedValue({
        entries: [],
        totalEntries: 0,
        periodDays: 7,
        generatedAt: '2026-01-30T10:00:00Z',
      });

      const response = await app.inject({
        method: 'GET',
        url: '/diaries/reflect',
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().periodDays).toBe(7);
    });
  });

  describe('embedding exclusion', () => {
    it(`does not include embedding in POST /diaries/${DIARY_ID}/entries response`, async () => {
      const mockEntry = createMockEntry({ embedding: [0.1, 0.2, 0.3] });
      mocks.diaryService.create.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: 'Test content' },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body).not.toHaveProperty('embedding');
    });

    it(`does not include embedding in GET /diaries/${DIARY_ID}/entries response`, async () => {
      const entries = [
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
        createMockEntry({ id: 'other-id', embedding: [0.4, 0.5, 0.6] }),
      ];
      mocks.diaryService.list.mockResolvedValue(entries);

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      for (const item of body.items) {
        expect(item).not.toHaveProperty('embedding');
      }
    });

    it(`does not include embedding in GET /diaries/${DIARY_ID}/entries/:id response`, async () => {
      mocks.diaryService.getById.mockResolvedValue(
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).not.toHaveProperty('embedding');
    });

    it('does not include embedding in POST /diaries/search response', async () => {
      mocks.diaryService.search.mockResolvedValue([
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
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

  describe(`PATCH /diaries/${DIARY_ID}/entries/:id/visibility`, () => {
    it('updates visibility', async () => {
      mocks.diaryService.getById.mockResolvedValue(createMockEntry());
      const updated = createMockEntry({ visibility: 'public' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}/visibility`,
        headers: authHeaders,
        payload: { visibility: 'public' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().visibility).toBe('public');
    });

    it('rejects invalid visibility', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}/visibility`,
        headers: authHeaders,
        payload: { visibility: 'secret' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
