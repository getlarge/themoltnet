import { DiaryServiceError } from '@moltnet/diary-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockEntry,
  createMockServices,
  createTestApp,
  DIARY_ID,
  ENTRY_ID,
  type MockServices,
  OTHER_AGENT_ID,
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
    // Default: diary is found and accessible
    mocks.diaryService.findDiary.mockResolvedValue(MOCK_DIARY);
    mocks.diaryService.findOwnedDiary.mockResolvedValue(MOCK_DIARY);
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
      expect(mocks.diaryService.createEntry).toHaveBeenCalledWith(
        {
          diaryId: DIARY_ID,
          content: 'Test diary entry content',
          title: undefined,
          tags: undefined,
          importance: undefined,
          entryType: undefined,
        },
        OWNER_ID,
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
  });

  describe(`GET /diaries/${DIARY_ID}/entries`, () => {
    it('lists entries for authenticated user', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      mocks.diaryService.listEntries.mockResolvedValue(entries);

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
      mocks.diaryService.listEntries.mockResolvedValue([]);

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
      mocks.diaryService.listEntries.mockResolvedValue([]);

      await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries?tags=accountable-commit,high-risk`,
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
      mocks.diaryService.listEntries.mockResolvedValue([]);

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
      mocks.diaryService.listEntries.mockResolvedValue([]);

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
  });

  describe(`GET /diaries/${DIARY_ID}/entries/:id`, () => {
    it('returns entry when found', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(createMockEntry());

      const response = await app.inject({
        method: 'GET',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(ENTRY_ID);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getEntryById.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary entry not found'),
      );

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
      mocks.diaryService.getEntryById.mockResolvedValue(createMockEntry());
      const updated = createMockEntry({ title: 'Updated' });
      mocks.diaryService.updateEntry.mockResolvedValue(updated);

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
      mocks.diaryService.getEntryById.mockResolvedValue(null);

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
      mocks.diaryService.getEntryById.mockResolvedValue(createMockEntry());
      mocks.diaryService.deleteEntry.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}/entries/${ENTRY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
    });

    it('returns 404 when not found', async () => {
      mocks.diaryService.getEntryById.mockResolvedValue(null);

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
      mocks.diaryService.searchEntries.mockResolvedValue([createMockEntry()]);

      const response = await app.inject({
        method: 'POST',
        url: '/diaries/search',
        headers: authHeaders,
        payload: { diaryId: DIARY_ID, query: 'test query' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().results).toHaveLength(1);
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
      );
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
        url: `/diaries/reflect?diaryId=${DIARY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().periodDays).toBe(7);
    });
  });

  // ── Sharing & invitation routes ──────────────────────────────────────────

  describe(`POST /diaries/${DIARY_ID}/share`, () => {
    const MOCK_SHARE = {
      id: '990e8400-e29b-41d4-a716-446655440005',
      diaryId: DIARY_ID,
      sharedWith: OTHER_AGENT_ID,
      role: 'reader' as const,
      status: 'pending' as const,
      invitedAt: new Date(),
      respondedAt: null,
    };

    it('creates a share invitation and returns 201', async () => {
      mocks.diaryService.shareDiary.mockResolvedValue(MOCK_SHARE);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/share`,
        headers: authHeaders,
        payload: { fingerprint: 'A1B2-C3D4-E5F6-07A8' },
      });

      expect(response.statusCode).toBe(201);
      expect(mocks.diaryService.shareDiary).toHaveBeenCalledWith(
        expect.objectContaining({ diaryId: DIARY_ID }),
      );
    });

    it('returns 409 when agent is already invited', async () => {
      mocks.diaryService.shareDiary.mockRejectedValue(
        new DiaryServiceError('already_shared', 'Already invited'),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/share`,
        headers: authHeaders,
        payload: { fingerprint: 'A1B2-C3D4-E5F6-07A8' },
      });

      expect(response.statusCode).toBe(409);
    });

    it('returns 404 when diary not found', async () => {
      mocks.diaryService.shareDiary.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary not found'),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/share`,
        headers: authHeaders,
        payload: { fingerprint: 'A1B2-C3D4-E5F6-07A8' },
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /diaries/invitations/:id/accept', () => {
    const INVITATION_ID = 'aa0e8400-e29b-41d4-a716-446655440006';
    const ACCEPTED_SHARE = {
      id: INVITATION_ID,
      diaryId: DIARY_ID,
      sharedWith: OWNER_ID,
      role: 'reader' as const,
      status: 'accepted' as const,
      invitedAt: new Date(),
      respondedAt: new Date(),
    };

    it('accepts an invitation and returns 200', async () => {
      mocks.diaryService.acceptInvitation.mockResolvedValue(ACCEPTED_SHARE);

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/invitations/${INVITATION_ID}/accept`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.acceptInvitation).toHaveBeenCalledWith(
        INVITATION_ID,
        OWNER_ID,
      );
    });

    it('returns 404 when invitation not found', async () => {
      mocks.diaryService.acceptInvitation.mockRejectedValue(
        new DiaryServiceError('not_found', 'Invitation not found'),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/invitations/${INVITATION_ID}/accept`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });

    it('returns 400 when invitation already responded', async () => {
      mocks.diaryService.acceptInvitation.mockRejectedValue(
        new DiaryServiceError(
          'wrong_status',
          'Invitation has already been accepted',
        ),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/invitations/${INVITATION_ID}/accept`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe(`DELETE /diaries/${DIARY_ID}/share/:fingerprint`, () => {
    it('revokes a share and returns 200', async () => {
      mocks.diaryService.revokeShare.mockResolvedValue(undefined);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}/share/A1B2-C3D4-E5F6-07A8`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.diaryService.revokeShare).toHaveBeenCalledWith(
        DIARY_ID,
        'A1B2-C3D4-E5F6-07A8',
        OWNER_ID,
      );
    });

    it('returns 404 when share not found', async () => {
      mocks.diaryService.revokeShare.mockRejectedValue(
        new DiaryServiceError('not_found', 'Share not found'),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}/share/A1B2-C3D4-E5F6-07A8`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe(`DELETE /diaries/${DIARY_ID}`, () => {
    it('deletes a diary and returns 200', async () => {
      mocks.diaryService.deleteDiary.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(200);
    });

    it('returns 404 when diary not found', async () => {
      mocks.diaryService.deleteDiary.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary not found'),
      );

      const response = await app.inject({
        method: 'DELETE',
        url: `/diaries/${DIARY_ID}`,
        headers: authHeaders,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('embedding exclusion', () => {
    it(`does not include embedding in POST /diaries/${DIARY_ID}/entries response`, async () => {
      const mockEntry = createMockEntry({ embedding: [0.1, 0.2, 0.3] });
      mocks.diaryService.createEntry.mockResolvedValue(mockEntry);

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
      mocks.diaryService.listEntries.mockResolvedValue(entries);

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
      mocks.diaryService.getEntryById.mockResolvedValue(
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
      const body = response.json();
      for (const result of body.results) {
        expect(result).not.toHaveProperty('embedding');
      }
    });
  });
});
