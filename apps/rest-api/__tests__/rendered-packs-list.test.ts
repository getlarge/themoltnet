import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  DIARY_ID,
  OWNER_ID,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const RENDERED_PACK_1 = {
  id: 'aa000000-0000-0000-0000-000000000001',
  sourcePackId: 'bb000000-0000-0000-0000-000000000001',
  diaryId: DIARY_ID,
  packCid: 'bafy-rendered-1',
  contentHash: 'sha256:aaa',
  renderMethod: 'agent-refined',
  totalTokens: 200,
  createdBy: OWNER_ID,
  pinned: false,
  expiresAt: null,
  createdAt: new Date('2026-03-01T00:00:00Z'),
};

const RENDERED_PACK_2 = {
  ...RENDERED_PACK_1,
  id: 'aa000000-0000-0000-0000-000000000002',
  sourcePackId: 'bb000000-0000-0000-0000-000000000002',
  packCid: 'bafy-rendered-2',
  renderMethod: 'server:pack-to-docs-v1',
  createdAt: new Date('2026-03-02T00:00:00Z'),
};

const authHeaders = { authorization: 'Bearer test-token' };

describe('GET /diaries/:id/rendered-packs', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.diaryService.findDiary.mockResolvedValue({
      id: DIARY_ID,
      createdBy: OWNER_ID,
      teamId: '00000000-0000-4000-b000-000000000001',
      name: 'moltnet',
      visibility: 'private',
      signed: false,
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    mocks.permissionChecker.canReadPacks.mockResolvedValue(
      new Map([
        [RENDERED_PACK_1.sourcePackId, true],
        [RENDERED_PACK_2.sourcePackId, true],
      ]),
    );
  });

  it('returns paginated list with total', async () => {
    mocks.renderedPackRepository.listByDiary.mockResolvedValue({
      items: [RENDERED_PACK_1, RENDERED_PACK_2],
      total: 2,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.total).toBe(2);
    expect(body.items).toHaveLength(2);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
    expect(body.items[0].id).toBe(RENDERED_PACK_1.id);
  });

  it('passes limit and offset to repository', async () => {
    mocks.renderedPackRepository.listByDiary.mockResolvedValue({
      items: [RENDERED_PACK_2],
      total: 5,
    });

    await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs?limit=1&offset=3`,
      headers: authHeaders,
    });

    expect(mocks.renderedPackRepository.listByDiary).toHaveBeenCalledWith(
      DIARY_ID,
      1,
      3,
      expect.objectContaining({
        sourcePackId: undefined,
        renderMethod: undefined,
      }),
    );
  });

  it('passes sourcePackId filter to repository', async () => {
    mocks.renderedPackRepository.listByDiary.mockResolvedValue({
      items: [RENDERED_PACK_1],
      total: 1,
    });

    await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs?sourcePackId=${RENDERED_PACK_1.sourcePackId}`,
      headers: authHeaders,
    });

    expect(mocks.renderedPackRepository.listByDiary).toHaveBeenCalledWith(
      DIARY_ID,
      20,
      0,
      expect.objectContaining({ sourcePackId: RENDERED_PACK_1.sourcePackId }),
    );
  });

  it('passes renderMethod filter to repository', async () => {
    mocks.renderedPackRepository.listByDiary.mockResolvedValue({
      items: [RENDERED_PACK_2],
      total: 1,
    });

    await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs?renderMethod=server%3Apack-to-docs-v1`,
      headers: authHeaders,
    });

    expect(mocks.renderedPackRepository.listByDiary).toHaveBeenCalledWith(
      DIARY_ID,
      20,
      0,
      expect.objectContaining({ renderMethod: 'server:pack-to-docs-v1' }),
    );
  });

  it('filters out packs whose source pack is not readable', async () => {
    mocks.renderedPackRepository.listByDiary.mockResolvedValue({
      items: [RENDERED_PACK_1, RENDERED_PACK_2],
      total: 2,
    });
    mocks.permissionChecker.canReadPacks.mockResolvedValue(
      new Map([
        [RENDERED_PACK_1.sourcePackId, true],
        [RENDERED_PACK_2.sourcePackId, false],
      ]),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(1);
    expect(body.items[0].id).toBe(RENDERED_PACK_1.id);
    expect(body.total).toBe(1);
  });

  it('returns 404 when diary does not exist', async () => {
    const { DiaryServiceError } = await import('@moltnet/diary-service');
    mocks.diaryService.findDiary.mockRejectedValue(
      new DiaryServiceError('not_found', 'Diary not found'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(404);
  });

  it('returns 403 when diary access is forbidden', async () => {
    const { DiaryServiceError } = await import('@moltnet/diary-service');
    mocks.diaryService.findDiary.mockRejectedValue(
      new DiaryServiceError('forbidden', 'Access denied'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(403);
  });

  it('returns 401 without auth token', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs`,
    });

    expect(response.statusCode).toBe(401);
  });

  it('returns empty list when no rendered packs exist', async () => {
    mocks.renderedPackRepository.listByDiary.mockResolvedValue({
      items: [],
      total: 0,
    });

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/rendered-packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items).toHaveLength(0);
    expect(body.total).toBe(0);
  });
});
