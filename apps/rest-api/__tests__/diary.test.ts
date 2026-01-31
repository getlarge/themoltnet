import { describe, it, expect, beforeEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  createMockServices,
  createTestApp,
  createMockEntry,
  VALID_AUTH_CONTEXT,
  OWNER_ID,
  ENTRY_ID,
  OTHER_AGENT_ID,
  type MockServices,
} from './helpers.js';

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
        payload: { content: '' },
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 401 without auth', async () => {
      const noAuthApp = await createTestApp(mocks, null);

      const response = await noAuthApp.inject({
        method: 'POST',
        url: '/diary/entries',
        payload: { content: 'test' },
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /diary/entries', () => {
    it('lists entries for authenticated user', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      mocks.diaryService.list.mockResolvedValue(entries);

      const response = await app.inject({
        method: 'GET',
        url: '/diary/entries',
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
      });

      expect(mocks.diaryService.list).toHaveBeenCalledWith(
        expect.objectContaining({ limit: 10, offset: 5 }),
      );
    });
  });

  describe('GET /diary/entries/:id', () => {
    it('returns entry when found', async () => {
      mocks.diaryService.getById.mockResolvedValue(createMockEntry());

      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(ENTRY_ID);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/diary/entries/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PATCH /diary/entries/:id', () => {
    it('updates entry', async () => {
      const updated = createMockEntry({ title: 'Updated' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}`,
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
        payload: { title: 'Updated' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /diary/entries/:id', () => {
    it('deletes entry', async () => {
      mocks.diaryService.delete.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diary/entries/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.delete.mockResolvedValue(false);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diary/entries/${ENTRY_ID}`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /diary/search', () => {
    it('searches with query', async () => {
      mocks.diaryService.search.mockResolvedValue([createMockEntry()]);

      const response = await app.inject({
        method: 'POST',
        url: '/diary/search',
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
        payload: {},
      });

      expect(response.statusCode).toBe(200);
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
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().periodDays).toBe(7);
    });
  });

  describe('POST /diary/entries/:id/share', () => {
    it('shares entry with another agent', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue({
        identityId: OTHER_AGENT_ID,
        moltbookName: 'Pith',
      });
      mocks.diaryService.share.mockResolvedValue(true);

      const response = await app.inject({
        method: 'POST',
        url: `/diary/entries/${ENTRY_ID}/share`,
        payload: { sharedWith: 'Pith' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when target agent not found', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue(null);

      const response = await app.inject({
        method: 'POST',
        url: `/diary/entries/${ENTRY_ID}/share`,
        payload: { sharedWith: 'NonExistent' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 403 when share is not allowed', async () => {
      mocks.agentRepository.findByMoltbookName.mockResolvedValue({
        identityId: OTHER_AGENT_ID,
        moltbookName: 'Pith',
      });
      mocks.diaryService.share.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: `/diary/entries/${ENTRY_ID}/share`,
        payload: { sharedWith: 'Pith' },
      });

      expect(response.statusCode).toBe(403);
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
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().entries).toHaveLength(1);
    });
  });

  describe('PATCH /diary/entries/:id/visibility', () => {
    it('updates visibility', async () => {
      const updated = createMockEntry({ visibility: 'public' });
      mocks.diaryService.update.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}/visibility`,
        payload: { visibility: 'public' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().visibility).toBe('public');
    });

    it('rejects invalid visibility', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/diary/entries/${ENTRY_ID}/visibility`,
        payload: { visibility: 'secret' },
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
