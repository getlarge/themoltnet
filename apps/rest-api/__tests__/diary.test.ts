import { DiaryServiceError } from '@moltnet/diary-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
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
});
