import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

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
const PACK_ID = '990e8400-e29b-41d4-a716-446655440000';

const MOCK_PACK = {
  id: PACK_ID,
  diaryId: DIARY_ID,
  packCid: 'bafytestpack',
  packCodec: 'dag-cbor',
  packType: 'compile' as const,
  params: { tokenBudget: 4000 },
  payload: { entries: [] },
  createdBy: OWNER_ID,
  supersedesPackId: null,
  pinned: false,
  expiresAt: new Date('2026-03-31T10:00:00Z'),
  createdAt: new Date('2026-03-24T10:00:00Z'),
};

describe('Pack routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
    mocks.diaryService.findDiary.mockResolvedValue({
      id: DIARY_ID,
      ownerId: OWNER_ID,
      name: 'moltnet',
      visibility: 'private',
      signed: false,
      createdAt: new Date('2026-03-24T10:00:00Z'),
      updatedAt: new Date('2026-03-24T10:00:00Z'),
    });
    mocks.contextPackRepository.findById.mockResolvedValue(MOCK_PACK);
    mocks.contextPackRepository.listByDiary.mockResolvedValue([MOCK_PACK]);
    mocks.contextPackRepository.listEntriesExpanded.mockResolvedValue([
      {
        id: 'pack-entry-1',
        packId: PACK_ID,
        entryId: createMockEntry().id,
        entryCidSnapshot: 'bafkentry',
        compressionLevel: 'full',
        originalTokens: 120,
        packedTokens: 120,
        rank: 1,
        createdAt: new Date('2026-03-24T10:00:00Z'),
        entry: createMockEntry(),
      },
    ]);
    mocks.permissionChecker.canReadPack.mockResolvedValue(true);
  });

  it('gets a pack by id with Keto authorization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('packCid', 'bafytestpack');
    expect(mocks.permissionChecker.canReadPack).toHaveBeenCalledWith(
      PACK_ID,
      OWNER_ID,
    );
  });

  it('expands pack entries when requested', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs/${PACK_ID}?expand=entries`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().entries[0].entry.content).toBe(
      'Test diary entry content',
    );
  });

  it('returns 403 when the caller cannot read the pack', async () => {
    mocks.permissionChecker.canReadPack.mockResolvedValue(false);

    const response = await app.inject({
      method: 'GET',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(403);
  });

  it('lists packs for an accessible diary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
  });

  it('lists expanded packs when requested', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/packs?expand=entries`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].entries[0].entry.id).toBe(
      createMockEntry().id,
    );
  });
});
