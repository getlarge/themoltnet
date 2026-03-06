import { DiaryServiceError } from '@moltnet/diary-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock DBOS.startWorkflow — routes call DBOS.startWorkflow(fn, opts)(input) → handle → getResult()
const { mockGetResult, mockStartWorkflow } = vi.hoisted(() => {
  const mockGetResult = vi.fn();
  const mockStartWorkflow = vi
    .fn()
    .mockReturnValue(vi.fn().mockResolvedValue({ getResult: mockGetResult }));
  return { mockGetResult, mockStartWorkflow };
});

vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      startWorkflow: mockStartWorkflow,
    },
  };
});

vi.mock('../src/workflows/context-distill-workflows.js', () => ({
  contextDistillWorkflows: {
    get consolidate() {
      return vi.fn();
    },
    get compile() {
      return vi.fn();
    },
  },
  consolidateQueue: {},
  compileQueue: {},
}));

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
    mocks.diaryEntryRepository.list.mockResolvedValue([]);
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

  describe('POST /diaries/:id/consolidate', () => {
    beforeEach(() => {
      mockGetResult.mockResolvedValue({
        workflowId: 'wf-consolidate-123',
        clusters: [],
        stats: {
          inputCount: 0,
          clusterCount: 0,
          singletonRate: 0,
          clusterSizeDistribution: [0, 0, 0, 0, 0],
          elapsedMs: 1,
        },
        trace: { thresholdUsed: 0.15, strategyUsed: 'hybrid', embeddingDim: 0 },
      });
    });

    it('returns 200 with consolidation result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/consolidate`,
        headers: authHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('workflowId');
      expect(response.json()).toHaveProperty('clusters');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/consolidate`,
        payload: {},
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 404 when diary not found', async () => {
      mocks.diaryService.findDiary.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary not found'),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/consolidate`,
        headers: authHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /diaries/:id/compile', () => {
    beforeEach(() => {
      mockGetResult.mockResolvedValue({
        entries: [],
        stats: {
          totalTokens: 0,
          entriesIncluded: 0,
          entriesCompressed: 0,
          compressionRatio: 1,
          budgetUtilization: 0,
          elapsedMs: 1,
        },
        trace: { lambdaUsed: 0.5, embeddingDim: 0 },
      });
    });

    it('returns 200 with compile result', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/compile`,
        headers: authHeaders,
        payload: { tokenBudget: 4000 },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toHaveProperty('entries');
      expect(response.json()).toHaveProperty('stats');
    });

    it('returns 401 without auth', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/compile`,
        payload: { tokenBudget: 4000 },
      });

      expect(response.statusCode).toBe(401);
    });

    it('returns 400 when tokenBudget missing', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/compile`,
        headers: authHeaders,
        payload: {},
      });

      expect(response.statusCode).toBe(400);
    });

    it('returns 404 when diary not found', async () => {
      mocks.diaryService.findDiary.mockRejectedValue(
        new DiaryServiceError('not_found', 'Diary not found'),
      );

      const response = await app.inject({
        method: 'POST',
        url: `/diaries/${DIARY_ID}/compile`,
        headers: authHeaders,
        payload: { tokenBudget: 4000 },
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
