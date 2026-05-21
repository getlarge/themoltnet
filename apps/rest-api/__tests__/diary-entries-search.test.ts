import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockEntry,
  createMockServices,
  createTestApp,
  DIARY_ID,
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

describe('Diary entry routes - search', () => {
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

  describe('POST /diaries/search', () => {
    it('searches with query', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([createMockEntry()]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: { diaryId: DIARY_ID, query: 'test query' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().results).toHaveLength(1);
      expect(response.json().results[0].creator).toEqual(
        expect.objectContaining({ kind: 'agent', identityId: OWNER_ID }),
      );
    });

    it('searches without query (lists all)', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: { diaryId: DIARY_ID },
      });

      expect(response.statusCode).toBe(200);
    });

    it('passes tags filter to service', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: {
          diaryId: DIARY_ID,
          query: 'test',
          tags: ['accountable-commit'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.searchEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['accountable-commit'],
        }),
        expect.any(String),
        'Agent',
      );
    });

    it('accepts 128-character search tag filters', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([]);
      const longTag = 'a'.repeat(128);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: {
          diaryId: DIARY_ID,
          tags: [longTag],
          excludeTags: [longTag],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.searchEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [longTag],
          excludeTags: [longTag],
        }),
        expect.any(String),
        'Agent',
      );
    });

    it('rejects search tag filters longer than 128 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: {
          diaryId: DIARY_ID,
          tags: ['a'.repeat(129)],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.diaryService.searchEntries).not.toHaveBeenCalled();
    });

    it('passes multiple tags to service', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: { diaryId: DIARY_ID, tags: ['tag-a', 'tag-b'] },
      });

      expect(mocks.diaryService.searchEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: ['tag-a', 'tag-b'],
        }),
        expect.any(String),
        'Agent',
      );
    });

    it('omits tags when not provided', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: { diaryId: DIARY_ID, query: 'test' },
      });

      expect(mocks.diaryService.searchEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: undefined,
        }),
        expect.any(String),
        'Agent',
      );
    });

    it('passes excludeTags filter to service', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([]);

      await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: {
          diaryId: DIARY_ID,
          query: 'test',
          excludeTags: ['incident'],
        },
      });

      expect(mocks.diaryService.searchEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeTags: ['incident'],
        }),
        expect.any(String),
        'Agent',
      );
    });

    it('does not include embedding in response', async () => {
      mocks.diaryService.searchEntries.mockResolvedValue([
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
      ]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: { diaryId: DIARY_ID, query: 'test' },
      });

      expect(response.statusCode).toBe(200);
      for (const result of response.json().results) {
        expect(result).not.toHaveProperty('embedding');
      }
    });
  });
});
