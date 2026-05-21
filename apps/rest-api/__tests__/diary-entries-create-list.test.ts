import { DiaryServiceError } from '@moltnet/diary-service';
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

describe('Diary entry routes - create and list', () => {
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

  describe(`POST /diaries/${DIARY_ID}/entries`, () => {
    it('creates an entry', async () => {
      const mockEntry = createMockEntry();
      mocks.diaryService.createEntry.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: 'Test diary entry content' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().content).toBe('Test diary entry content');
      const body = response.json();
      expect(body.creator).toEqual(
        expect.objectContaining({ kind: 'agent', identityId: OWNER_ID }),
      );
      expect(mocks.diaryService.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          content: 'Test diary entry content',
          contentHash: expect.stringMatching(/^bafk/),
          creator: { kind: 'agent', id: OWNER_ID },
        }),
        OWNER_ID,
        'Agent',
      );
    });

    it('creates entry with all optional fields', async () => {
      const mockEntry = createMockEntry({
        title: 'My Title',
        tags: ['test'],
      });
      mocks.diaryService.createEntry.mockResolvedValue(mockEntry);

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

    it('accepts 128-character tag values', async () => {
      const longTag = 'a'.repeat(128);
      const mockEntry = createMockEntry({ tags: [longTag] });
      mocks.diaryService.createEntry.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: {
          content: 'Test content',
          tags: [longTag],
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mocks.diaryService.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [longTag],
        }),
        OWNER_ID,
        'Agent',
      );
    });

    it('rejects tags longer than 128 characters', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: {
          content: 'Test content',
          tags: ['a'.repeat(129)],
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.diaryService.createEntry).not.toHaveBeenCalled();
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
      expect(response.headers['content-type']).toContain('application/json');
      expect(response.json().code).toBe('UNAUTHORIZED');
    });

    it('returns 404 when diary not found', async () => {
      mocks.diaryService.createEntry.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary not found'),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: 'test' },
      });

      expect(response.statusCode).toBe(404);
    });

    it('does not include embedding in response', async () => {
      const mockEntry = createMockEntry({ embedding: [0.1, 0.2, 0.3] });
      mocks.diaryService.createEntry.mockResolvedValue(mockEntry);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
        payload: { content: 'Test content' },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).not.toHaveProperty('embedding');
    });
  });

  describe(`GET /diaries/${DIARY_ID}/entries`, () => {
    it('lists entries for authenticated user', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      mocks.diaryService.listEntries.mockResolvedValue({
        items: entries,
        total: 5,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.items).toHaveLength(2);
      expect(body.total).toBe(5);
      expect(body.items[0].creator).toEqual(
        expect.objectContaining({ kind: 'agent', identityId: OWNER_ID }),
      );
    });

    it('passes query parameters through', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?limit=10&offset=5`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID, limit: 10, offset: 5 }),
      );
    });

    it('passes tags filter from query string', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=accountable-commit&tags=high-risk`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          tags: ['accountable-commit', 'high-risk'],
        }),
      );
    });

    it('passes single tag from query string', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=deploy`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          tags: ['deploy'],
        }),
      );
    });

    it('passes excludeTags filter from query string', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?excludeTags=incident&excludeTags=staging`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          excludeTags: ['incident', 'staging'],
        }),
      );
    });

    it('passes ids filter from query string', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      const idA = '11111111-1111-1111-1111-111111111111';
      const idB = '22222222-2222-2222-2222-222222222222';

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?ids=${idA}&ids=${idB}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          ids: [idA, idB],
        }),
      );
    });

    it('rejects invalid uuid in ids filter', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?ids=not-a-uuid`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.diaryService.listEntries).not.toHaveBeenCalled();
    });

    it('rejects more than 50 ids', async () => {
      const tooMany = Array.from(
        { length: 51 },
        (_, i) =>
          `${i.toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`,
      )
        .map((id) => `ids=${id}`)
        .join('&');

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?${tooMany}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.diaryService.listEntries).not.toHaveBeenCalled();
    });

    it('rejects legacy comma-separated tags syntax', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=deploy,staging`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('accepts tag filters up to 128 characters', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });
      const longTag = 'a'.repeat(128);

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=${longTag}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: [longTag],
        }),
      );
    });

    it('rejects tag filters longer than 128 characters', async () => {
      const longTag = 'a'.repeat(129);
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=${longTag}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('rejects more than 20 tags', async () => {
      const tags = Array.from({ length: 21 }, (_, i) => `tags=tag-${i}`).join(
        '&',
      );
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?${tags}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('omits tags when not in query string', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          tags: undefined,
        }),
      );
    });

    it('passes multiple entryType values as entryTypes array', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?entryType=identity&entryType=soul&entryType=semantic`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          entryTypes: ['identity', 'soul', 'semantic'],
        }),
      );
    });

    it('passes single entryType value as entryTypes array', async () => {
      mocks.diaryService.listEntries.mockResolvedValue({
        items: [],
        total: 0,
      });

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?entryType=episodic`,
        headers: authHeaders,
      });

      expect(mocks.diaryService.listEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          entryTypes: ['episodic'],
        }),
      );
    });

    it('rejects invalid entryType value', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?entryType=invalid`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });

    it('does not include embedding in response', async () => {
      const entries = [
        createMockEntry({ embedding: [0.1, 0.2, 0.3] }),
        createMockEntry({ id: 'other-id', embedding: [0.4, 0.5, 0.6] }),
      ];
      mocks.diaryService.listEntries.mockResolvedValue({
        items: entries,
        total: 2,
      });

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      for (const item of response.json().items) {
        expect(item).not.toHaveProperty('embedding');
      }
    });
  });
});
