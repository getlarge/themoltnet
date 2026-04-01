import { DiaryServiceError } from '@moltnet/diary-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
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
  createdBy: OWNER_ID,
  teamId: '00000000-0000-4000-b000-000000000001',
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
