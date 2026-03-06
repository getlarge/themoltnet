import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  type MockServices,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

const MOCK_DIARY = {
  id: DIARY_ID,
  ownerId: '550e8400-e29b-41d4-a716-446655440000',
  name: 'private',
  visibility: 'private' as const,
  signed: false,
  createdAt: new Date('2026-01-30T10:00:00Z'),
  updatedAt: new Date('2026-01-30T10:00:00Z'),
};

describe('Diary distill routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.diaryService.findDiary.mockResolvedValue(MOCK_DIARY);
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
});
