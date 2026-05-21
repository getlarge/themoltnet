import { DiaryServiceError } from '@moltnet/diary-service';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

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
  creatorAgentId: OWNER_ID,
  creatorHumanId: null,
  teamId: '00000000-0000-4000-b000-000000000001',
  name: 'private',
  visibility: 'private' as const,
  signed: false,
  createdAt: new Date('2026-01-30T10:00:00Z'),
  updatedAt: new Date('2026-01-30T10:00:00Z'),
};

describe('Diary entry routes - tags and entry item routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.diaryService.findDiary.mockResolvedValue(MOCK_DIARY);
    mocks.diaryService.findOwnedDiary.mockResolvedValue(MOCK_DIARY);
  });

  afterEach(async () => {
    await app.close();
  });

  describe(`GET /diaries/${DIARY_ID}/tags`, () => {
    const MOCK_TAGS = [
      { tag: 'source:scan', count: 30 },
      { tag: 'accountable-commit', count: 20 },
      { tag: 'decision', count: 10 },
    ];

    it('returns tags with counts', async () => {
      mocks.diaryService.listTags.mockResolvedValue(MOCK_TAGS);

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tags).toEqual(MOCK_TAGS);
      expect(body.total).toBe(3);
    });

    it('passes prefix filter', async () => {
      mocks.diaryService.listTags.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags?prefix=source:`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listTags).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID, prefix: 'source:' }),
        OWNER_ID,
        'Agent',
      );
    });

    it('passes minCount filter', async () => {
      mocks.diaryService.listTags.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags?minCount=5`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listTags).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID, minCount: 5 }),
        OWNER_ID,
        'Agent',
      );
    });

    it('passes entryTypes filter', async () => {
      mocks.diaryService.listTags.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags?entryTypes=semantic&entryTypes=episodic`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listTags).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          entryTypes: ['semantic', 'episodic'],
        }),
        OWNER_ID,
        'Agent',
      );
    });

    it('returns 404 when diary not found', async () => {
      mocks.diaryService.listTags.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary not found'),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns empty array when no tags exist', async () => {
      mocks.diaryService.listTags.mockResolvedValue([]);

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.tags).toEqual([]);
      expect(body.total).toBe(0);
    });

    it('rejects invalid entryTypes', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags?entryTypes=invalid`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/tags`,
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('GET /entries/:id', () => {
    it('returns entry when found', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(createMockEntry());

      const response = await app.inject({
        method: 'GET',
        url: `/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(ENTRY_ID);
      expect(response.json().creator).toEqual(
        expect.objectContaining({ kind: 'agent', identityId: OWNER_ID }),
      );
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getEntryById.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary entry not found'),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('NOT_FOUND');
    });

    it('does not include embedding in response', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).not.toHaveProperty('embedding');
    });
  });

  describe('PATCH /entries/:id', () => {
    it('updates entry without diaryId path coupling', async () => {
      const updated = createMockEntry({ title: 'Updated by id' });
      mocks.diaryService.updateEntry.mockResolvedValue(updated);

      const response = await app.inject({
        method: 'PATCH',
        url: `/entries/${ENTRY_ID}`,
        headers: authHeaders,
        payload: { title: 'Updated by id' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.updateEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        'Agent',
        { title: 'Updated by id' },
      );
    });
  });

  describe('DELETE /entries/:id', () => {
    it('deletes entry without diaryId path coupling', async () => {
      mocks.diaryService.deleteEntry.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.deleteEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        'Agent',
      );
    });
  });
});
