import { computeContentCid } from '@moltnet/crypto-service';
import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
const PACK_ID_2 = '990e8400-e29b-41d4-a716-446655440001';
const PACK_CID = 'bafytestpack';
const MOCK_CREATOR = {
  identityId: OWNER_ID,
  fingerprint: VALID_AUTH_CONTEXT.fingerprint,
  publicKey: VALID_AUTH_CONTEXT.publicKey,
};

const MOCK_PACK = {
  id: PACK_ID,
  diaryId: DIARY_ID,
  packCid: PACK_CID,
  packCodec: 'dag-cbor',
  packType: 'compile' as const,
  params: { tokenBudget: 4000 },
  payload: { entries: [] },
  createdBy: OWNER_ID,
  creator: MOCK_CREATOR,
  supersedesPackId: PACK_ID_2,
  pinned: false,
  expiresAt: new Date('2026-03-31T10:00:00Z'),
  createdAt: new Date('2026-03-24T10:00:00Z'),
};

const MOCK_PACK_2 = {
  ...MOCK_PACK,
  id: PACK_ID_2,
  packCid: 'bafytestpack2',
};

const LONG_ENTRY_CONTENT =
  'Alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu. '.repeat(
    6,
  );
const ENTRY_1_HASH = computeContentCid('semantic', '', LONG_ENTRY_CONTENT, [
  'entry-1',
]);
const ENTRY_2_HASH = computeContentCid('semantic', '', LONG_ENTRY_CONTENT, [
  'entry-2',
]);

describe('Pack routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

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
      createdAt: new Date('2026-03-24T10:00:00Z'),
      updatedAt: new Date('2026-03-24T10:00:00Z'),
    });
    mocks.contextPackRepository.findById.mockImplementation(async (id) => {
      if (id === PACK_ID) return MOCK_PACK;
      if (id === PACK_ID_2) return MOCK_PACK_2;
      return null;
    });
    mocks.contextPackRepository.findByCid.mockResolvedValue(MOCK_PACK);
    mocks.contextPackRepository.listByDiary.mockResolvedValue({
      items: [MOCK_PACK, MOCK_PACK_2],
      total: 2,
    });
    mocks.contextPackService.listPacksByEntry.mockResolvedValue({
      items: [MOCK_PACK, MOCK_PACK_2],
      total: 2,
      renderedPacks: [
        {
          id: 'rendered-1',
          packCid: 'bafyrendered1',
          sourcePackId: PACK_ID,
          diaryId: DIARY_ID,
          contentHash: 'hash-1',
          renderMethod: 'server:pack-to-docs-v1',
          totalTokens: 42,
          createdBy: OWNER_ID,
          pinned: false,
          expiresAt: new Date('2026-03-31T10:00:00Z'),
          createdAt: new Date('2026-03-24T10:00:00Z'),
        },
      ],
    });
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
        entry: {
          ...createMockEntry(),
          creator: MOCK_CREATOR,
        },
      },
    ]);
    mocks.contextPackRepository.listEntriesExpandedByPackIds.mockResolvedValue(
      new Map([
        [
          PACK_ID,
          [
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
              entry: {
                ...createMockEntry(),
                creator: MOCK_CREATOR,
              },
            },
          ],
        ],
        [PACK_ID_2, []],
      ]),
    );
    mocks.permissionChecker.canReadPack.mockResolvedValue(true);
    mocks.permissionChecker.canReadPacks.mockResolvedValue(
      new Map([
        [PACK_ID, true],
        [PACK_ID_2, true],
      ]),
    );
    mocks.diaryEntryRepository.list.mockResolvedValue({
      items: [
        createMockEntry({
          id: '11111111-1111-4111-8111-111111111111',
          content: LONG_ENTRY_CONTENT,
          contentHash: ENTRY_1_HASH,
        }),
        createMockEntry({
          id: '22222222-2222-4222-8222-222222222222',
          content: LONG_ENTRY_CONTENT,
          contentHash: ENTRY_2_HASH,
        }),
      ],
      total: 2,
    });
    mocks.contextPackRepository.createPack.mockImplementation(
      async (input) => ({
        id: PACK_ID,
        packCodec: 'dag-cbor',
        supersedesPackId: null,
        ...input,
        expiresAt: input.expiresAt ?? new Date('2026-03-31T10:00:00Z'),
        createdAt: input.createdAt ?? new Date('2026-03-24T10:00:00Z'),
      }),
    );
    mocks.contextPackRepository.addEntries.mockResolvedValue([]);
  });

  it('gets a pack by id with Keto authorization', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs/${PACK_ID}`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toHaveProperty('packCid', 'bafytestpack');
    expect(response.json()).toHaveProperty(
      'creator.fingerprint',
      VALID_AUTH_CONTEXT.fingerprint,
    );
    expect(mocks.permissionChecker.canReadPack).toHaveBeenCalledWith(
      PACK_ID,
      OWNER_ID,
      'Agent',
    );
  });

  it('lists packs containing an entry', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs?containsEntry=${createMockEntry().id}`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(mocks.contextPackService.listPacksByEntry).toHaveBeenCalledWith({
      entryId: createMockEntry().id,
      actor: { identityId: OWNER_ID, subjectNs: 'Agent' },
      limit: 20,
      offset: 0,
      includeRendered: undefined,
    });
  });

  it('lists packs containing an entry with rendered packs when requested', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs?containsEntry=${createMockEntry().id}&includeRendered=true`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().renderedPacks).toHaveLength(1);
  });

  it('returns 400 when diaryId and containsEntry are both provided', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs?diaryId=${DIARY_ID}&containsEntry=${createMockEntry().id}`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(400);
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
    expect(response.json().entries[0].entry.creator.fingerprint).toBe(
      VALID_AUTH_CONTEXT.fingerprint,
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

  it('returns a pack provenance graph by id', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs/${PACK_ID}/provenance?depth=1`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().metadata.rootPackId).toBe(PACK_ID);
    expect(response.json().nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: `pack:${PACK_ID}`, kind: 'pack' }),
        expect.objectContaining({
          id: `entry:${createMockEntry().id}`,
          kind: 'entry',
        }),
      ]),
    );
    expect(
      mocks.contextPackRepository.listEntriesExpandedByPackIds,
    ).toHaveBeenCalledWith([PACK_ID, PACK_ID_2]);
  });

  it('returns a pack provenance graph by cid', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/packs/by-cid/${PACK_CID}/provenance`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.contextPackRepository.findByCid).toHaveBeenCalledWith(
      PACK_CID,
    );
    expect(response.json().metadata.rootPackId).toBe(PACK_ID);
  });

  it('lists packs for an accessible diary', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(2);
    expect(response.json().total).toBe(2);
    expect(response.json().offset).toBe(0);
    expect(mocks.permissionChecker.canReadPacks).toHaveBeenCalledWith(
      [PACK_ID, PACK_ID_2],
      OWNER_ID,
      'Agent',
    );
  });

  it('lists expanded packs when requested without N+1 pack entry queries', async () => {
    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/packs?expand=entries`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items[0].entries[0].entry.id).toBe(
      createMockEntry().id,
    );
    expect(
      mocks.contextPackRepository.listEntriesExpandedByPackIds,
    ).toHaveBeenCalledWith([PACK_ID, PACK_ID_2]);
    expect(
      mocks.contextPackRepository.listEntriesExpanded,
    ).not.toHaveBeenCalled();
  });

  it('filters unauthorized packs from diary pack listings', async () => {
    mocks.permissionChecker.canReadPacks.mockResolvedValue(
      new Map([
        [PACK_ID, true],
        [PACK_ID_2, false],
      ]),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().items).toHaveLength(1);
    expect(response.json().items[0].id).toBe(PACK_ID);
    // total adjusted: 2 DB rows - 1 denied on page = 1
    expect(response.json().total).toBe(1);
  });

  it('returns 500 when batch pack authorization fails', async () => {
    mocks.permissionChecker.canReadPacks.mockRejectedValue(
      new Error('Keto unavailable'),
    );

    const response = await app.inject({
      method: 'GET',
      url: `/diaries/${DIARY_ID}/packs`,
      headers: authHeaders,
    });

    expect(response.statusCode).toBe(500);
  });

  it('previews a custom pack without persistence and compresses lower-ranked entries first', async () => {
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/packs/preview`,
      headers: authHeaders,
      payload: {
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
          taskPrompt: 'Keto authorization debugging',
        },
        entries: [
          { entryId: '11111111-1111-4111-8111-111111111111', rank: 1 },
          { entryId: '22222222-2222-4222-8222-222222222222', rank: 2 },
        ],
        tokenBudget: 300,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      packType: 'custom',
      params: {
        recipe: 'ax-agent-selected',
        taskPrompt: 'Keto authorization debugging',
      },
    });
    expect(response.json().entries).toHaveLength(2);
    expect(response.json().entries[0]).toMatchObject({
      entryId: '11111111-1111-4111-8111-111111111111',
      rank: 1,
      compressionLevel: 'full',
    });
    expect(response.json().entries[1]).toMatchObject({
      entryId: '22222222-2222-4222-8222-222222222222',
      rank: 2,
      compressionLevel: 'summary',
    });
    expect(mocks.contextPackRepository.createPack).not.toHaveBeenCalled();
    expect(mocks.contextPackRepository.addEntries).not.toHaveBeenCalled();
    expect(mocks.relationshipWriter.grantPackParent).not.toHaveBeenCalled();
  });

  it('creates and persists a custom pack', async () => {
    // findByCid returns null so the idempotency check doesn't short-circuit
    mocks.contextPackRepository.findByCid.mockResolvedValueOnce(null);
    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/packs`,
      headers: authHeaders,
      payload: {
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
          selectionMethod: 'rag-multi-query',
        },
        entries: [
          { entryId: '11111111-1111-4111-8111-111111111111', rank: 1 },
          { entryId: '22222222-2222-4222-8222-222222222222', rank: 2 },
        ],
        pinned: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.contextPackRepository.createPack).toHaveBeenCalledWith(
      expect.objectContaining({
        diaryId: DIARY_ID,
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
          selectionMethod: 'rag-multi-query',
        },
        createdBy: OWNER_ID,
        pinned: true,
        expiresAt: null,
      }),
    );
    expect(mocks.contextPackRepository.addEntries).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          packId: PACK_ID,
          entryId: '11111111-1111-4111-8111-111111111111',
          rank: 1,
        }),
        expect.objectContaining({
          packId: PACK_ID,
          entryId: '22222222-2222-4222-8222-222222222222',
          rank: 2,
        }),
      ]),
    );
    expect(mocks.relationshipWriter.grantPackParent).toHaveBeenCalledWith(
      PACK_ID,
      DIARY_ID,
    );
  });

  it('cleans up a persisted custom pack if Keto parent grant fails', async () => {
    // findByCid returns null so idempotency check doesn't short-circuit
    mocks.contextPackRepository.findByCid.mockResolvedValueOnce(null);
    mocks.relationshipWriter.grantPackParent.mockRejectedValue(
      new Error('Keto unavailable'),
    );
    mocks.contextPackRepository.deleteMany = vi.fn().mockResolvedValue(1);
    mocks.diaryEntryRepository.list.mockResolvedValue({
      items: [
        createMockEntry({
          id: '11111111-1111-4111-8111-111111111111',
          contentHash: ENTRY_1_HASH,
        }),
      ],
      total: 1,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/packs`,
      headers: authHeaders,
      payload: {
        packType: 'custom',
        params: {
          recipe: 'ax-agent-selected',
        },
        entries: [{ entryId: '11111111-1111-4111-8111-111111111111', rank: 1 }],
      },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.relationshipWriter.removePackRelations).toHaveBeenCalledWith(
      PACK_ID,
    );
    expect(mocks.contextPackRepository.deleteMany).toHaveBeenCalledWith([
      PACK_ID,
    ]);
  });

  it('rejects custom pack selections that include entries outside the diary', async () => {
    mocks.diaryEntryRepository.list.mockResolvedValue({
      items: [
        createMockEntry({
          id: '11111111-1111-4111-8111-111111111111',
          contentHash: ENTRY_1_HASH,
        }),
      ],
      total: 1,
    });

    const response = await app.inject({
      method: 'POST',
      url: `/diaries/${DIARY_ID}/packs/preview`,
      headers: authHeaders,
      payload: {
        packType: 'custom',
        params: { recipe: 'ax-agent-selected' },
        entries: [
          { entryId: '11111111-1111-4111-8111-111111111111', rank: 1 },
          { entryId: '22222222-2222-4222-8222-222222222222', rank: 2 },
        ],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.contextPackRepository.createPack).not.toHaveBeenCalled();
  });
});
