import { KetoNamespace } from '@moltnet/auth';
import { describe, expect, it, vi } from 'vitest';

import {
  ContextPackService,
  type ContextPackServiceDeps,
  PackServiceError,
} from '../src/context-pack.service.js';

const PACK_A_CID = 'bafyreiapack-a';
const PACK_B_CID = 'bafyreiapack-b';

function makePackRow(overrides?: Record<string, unknown>) {
  return {
    id: 'pack-a-uuid',
    diaryId: 'diary-uuid',
    packCid: PACK_A_CID,
    packCodec: 'dag-cbor',
    packType: 'compile' as const,
    params: {},
    payload: { compileStats: { totalTokens: 100 } },
    createdBy: 'identity-uuid',
    supersedesPackId: null,
    pinned: false,
    expiresAt: null,
    createdAt: new Date('2026-01-01'),
    creator: null,
    ...overrides,
  };
}

function makeDeps(
  overrides?: Partial<ContextPackServiceDeps>,
): ContextPackServiceDeps {
  const packA = makePackRow({ id: 'pack-a-uuid', packCid: PACK_A_CID });
  const packB = makePackRow({
    id: 'pack-b-uuid',
    packCid: PACK_B_CID,
    payload: { compileStats: { totalTokens: 120 } },
  });

  return {
    contextPackRepository: {
      createPack: vi.fn(),
      addEntries: vi.fn(),
      findById: vi.fn().mockImplementation((id: string) => {
        if (id === 'pack-a-uuid') return Promise.resolve(packA);
        if (id === 'pack-b-uuid') return Promise.resolve(packB);
        return Promise.resolve(null);
      }),
      findByCid: vi.fn().mockImplementation((cid: string) => {
        if (cid === PACK_A_CID) return Promise.resolve(packA);
        if (cid === PACK_B_CID) return Promise.resolve(packB);
        return Promise.resolve(null);
      }),
      findByEntryId: vi.fn(),
      listByDiary: vi.fn(),
      listEntriesExpanded: vi.fn(),
      listEntriesExpandedByPackIds: vi.fn(),
      diffPacks: vi.fn().mockResolvedValue([]),
    },
    renderedPackRepository: {
      create: vi.fn(),
      findById: vi.fn(),
      findByCid: vi.fn(),
      findLatestBySourcePackId: vi.fn(),
      listByDiary: vi.fn(),
      listBySourcePackIds: vi.fn(),
    },
    diaryEntryRepository: {
      findById: vi.fn(),
    },
    permissionChecker: {
      canViewEntry: vi.fn(),
      canReadPack: vi.fn().mockResolvedValue(true),
      canReadPacks: vi.fn(),
    },
    assertDiaryReadable: vi.fn().mockResolvedValue(undefined),
    entryFetcher: { fetchEntries: vi.fn() },
    runTransaction: vi
      .fn()
      .mockImplementation((fn: () => Promise<unknown>) => fn()),
    grantPackParent: vi.fn().mockResolvedValue(undefined),
    removePackRelations: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(0),
    ttlDays: 7,
    ...overrides,
  };
}

const actor = { identityId: 'identity-uuid', subjectNs: KetoNamespace.Agent };

describe('ContextPackService.diffPacks', () => {
  it('returns empty diff when packs share the same CID', async () => {
    const deps = makeDeps();
    const packA = makePackRow({ id: 'pack-a-uuid', packCid: PACK_A_CID });
    const packB = makePackRow({
      id: 'pack-b-uuid',
      packCid: PACK_A_CID,
      payload: { compileStats: { totalTokens: 100 } },
    });
    deps.contextPackRepository.findById = vi
      .fn()
      .mockImplementation((id: string) => {
        if (id === 'pack-a-uuid') return Promise.resolve(packA);
        if (id === 'pack-b-uuid') return Promise.resolve(packB);
        return Promise.resolve(null);
      });

    const service = new ContextPackService(deps);
    const result = await service.diffPacks({
      packAId: 'pack-a-uuid',
      packBId: 'pack-b-uuid',
      actor,
    });

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.reordered).toHaveLength(0);
    expect(result.changed).toHaveLength(0);
    expect(deps.contextPackRepository.diffPacks).not.toHaveBeenCalled();
    expect(result.stats.tokenDelta).toBe(0);
  });

  it('returns empty diff when repository returns no different rows', async () => {
    const deps = makeDeps();
    const service = new ContextPackService(deps);

    const result = await service.diffPacks({
      packAId: 'pack-a-uuid',
      packBId: 'pack-b-uuid',
      actor,
    });

    expect(result.added).toHaveLength(0);
    expect(result.removed).toHaveLength(0);
    expect(result.stats.tokenDelta).toBe(20);
    expect(result.stats.packA.totalTokens).toBe(100);
    expect(result.stats.packB.totalTokens).toBe(120);
  });

  it('classifies added entries correctly', async () => {
    const deps = makeDeps({
      contextPackRepository: {
        ...makeDeps().contextPackRepository,
        diffPacks: vi.fn().mockResolvedValue([
          {
            entryId: 'entry-new',
            title: 'New Entry',
            kind: 'added',
            rankA: null,
            rankB: 3,
            cidA: null,
            cidB: 'bafyreib-new',
            compressionA: null,
            compressionB: 'full',
            tokensA: null,
            tokensB: 50,
          },
        ]),
      },
    });
    const service = new ContextPackService(deps);

    const result = await service.diffPacks({
      packAId: 'pack-a-uuid',
      packBId: 'pack-b-uuid',
      actor,
    });

    expect(result.added).toHaveLength(1);
    expect(result.added[0]).toMatchObject({
      entryId: 'entry-new',
      title: 'New Entry',
      rank: 3,
      entryCidSnapshot: 'bafyreib-new',
      compressionLevel: 'full',
      packedTokens: 50,
    });
    expect(result.stats.addedCount).toBe(1);
  });

  it('classifies removed entries correctly', async () => {
    const deps = makeDeps({
      contextPackRepository: {
        ...makeDeps().contextPackRepository,
        diffPacks: vi.fn().mockResolvedValue([
          {
            entryId: 'entry-gone',
            title: 'Gone Entry',
            kind: 'removed',
            rankA: 2,
            rankB: null,
            cidA: 'bafyreib-old',
            cidB: null,
            compressionA: 'summary',
            compressionB: null,
            tokensA: 30,
            tokensB: null,
          },
        ]),
      },
    });
    const service = new ContextPackService(deps);

    const result = await service.diffPacks({
      packAId: 'pack-a-uuid',
      packBId: 'pack-b-uuid',
      actor,
    });

    expect(result.removed).toHaveLength(1);
    expect(result.removed[0]).toMatchObject({
      entryId: 'entry-gone',
      rank: 2,
      entryCidSnapshot: 'bafyreib-old',
      compressionLevel: 'summary',
      packedTokens: 30,
    });
    expect(result.stats.removedCount).toBe(1);
  });

  it('classifies reordered entries correctly', async () => {
    const deps = makeDeps({
      contextPackRepository: {
        ...makeDeps().contextPackRepository,
        diffPacks: vi.fn().mockResolvedValue([
          {
            entryId: 'entry-moved',
            title: 'Moved Entry',
            kind: 'reordered',
            rankA: 5,
            rankB: 2,
            cidA: 'bafyreib-same',
            cidB: 'bafyreib-same',
            compressionA: 'full',
            compressionB: 'full',
            tokensA: 40,
            tokensB: 40,
          },
        ]),
      },
    });
    const service = new ContextPackService(deps);

    const result = await service.diffPacks({
      packAId: 'pack-a-uuid',
      packBId: 'pack-b-uuid',
      actor,
    });

    expect(result.reordered).toHaveLength(1);
    expect(result.reordered[0]).toMatchObject({
      entryId: 'entry-moved',
      oldRank: 5,
      newRank: 2,
      entryCidSnapshot: 'bafyreib-same',
    });
    expect(result.stats.reorderedCount).toBe(1);
  });

  it('classifies changed entries with correct tokenDelta', async () => {
    const deps = makeDeps({
      contextPackRepository: {
        ...makeDeps().contextPackRepository,
        diffPacks: vi.fn().mockResolvedValue([
          {
            entryId: 'entry-changed',
            title: 'Changed Entry',
            kind: 'changed',
            rankA: 1,
            rankB: 1,
            cidA: 'bafyreib-old',
            cidB: 'bafyreib-new',
            compressionA: 'full',
            compressionB: 'summary',
            tokensA: 80,
            tokensB: 30,
          },
        ]),
      },
    });
    const service = new ContextPackService(deps);

    const result = await service.diffPacks({
      packAId: 'pack-a-uuid',
      packBId: 'pack-b-uuid',
      actor,
    });

    expect(result.changed).toHaveLength(1);
    expect(result.changed[0]).toMatchObject({
      entryId: 'entry-changed',
      rank: 1,
      oldEntryCidSnapshot: 'bafyreib-old',
      newEntryCidSnapshot: 'bafyreib-new',
      oldCompressionLevel: 'full',
      newCompressionLevel: 'summary',
      oldPackedTokens: 80,
      newPackedTokens: 30,
      tokenDelta: -50,
    });
    expect(result.stats.changedCount).toBe(1);
  });

  it('resolves packs by CID when IDs not provided', async () => {
    const deps = makeDeps();
    const service = new ContextPackService(deps);

    await service.diffPacks({
      packACid: PACK_A_CID,
      packBCid: PACK_B_CID,
      actor,
    });

    expect(deps.contextPackRepository.findByCid).toHaveBeenCalledWith(
      PACK_A_CID,
    );
    expect(deps.contextPackRepository.findByCid).toHaveBeenCalledWith(
      PACK_B_CID,
    );
  });

  it('throws not_found when pack A does not exist', async () => {
    const deps = makeDeps({
      contextPackRepository: {
        ...makeDeps().contextPackRepository,
        findById: vi.fn().mockResolvedValue(null),
      },
    });
    const service = new ContextPackService(deps);

    await expect(
      service.diffPacks({ packAId: 'unknown', packBId: 'pack-b-uuid', actor }),
    ).rejects.toThrow(PackServiceError);
  });

  it('throws validation error when packs belong to different diaries', async () => {
    const deps = makeDeps({
      contextPackRepository: {
        ...makeDeps().contextPackRepository,
        findById: vi.fn().mockImplementation((id: string) => {
          if (id === 'pack-a-uuid')
            return Promise.resolve(
              makePackRow({ id: 'pack-a-uuid', diaryId: 'diary-1' }),
            );
          if (id === 'pack-b-uuid')
            return Promise.resolve(
              makePackRow({
                id: 'pack-b-uuid',
                packCid: PACK_B_CID,
                diaryId: 'diary-2',
              }),
            );
          return Promise.resolve(null);
        }),
      },
    });
    const service = new ContextPackService(deps);

    await expect(
      service.diffPacks({
        packAId: 'pack-a-uuid',
        packBId: 'pack-b-uuid',
        actor,
      }),
    ).rejects.toThrow(expect.objectContaining({ code: 'validation' }));
  });

  it('throws validation error when pack A identifier is missing', async () => {
    const deps = makeDeps();
    const service = new ContextPackService(deps);

    await expect(
      service.diffPacks({ packBId: 'pack-b-uuid', actor }),
    ).rejects.toThrow(expect.objectContaining({ code: 'validation' }));
  });

  it('throws validation error when pack B identifier is missing', async () => {
    const deps = makeDeps();
    const service = new ContextPackService(deps);

    await expect(
      service.diffPacks({ packAId: 'pack-a-uuid', actor }),
    ).rejects.toThrow(expect.objectContaining({ code: 'validation' }));
  });
});
