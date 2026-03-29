import { computeContentCid } from '@moltnet/crypto-service';
import { describe, expect, it, vi } from 'vitest';

import {
  ContextPackService,
  type ContextPackServiceDeps,
} from '../src/context-pack.service.js';

const ENTRY_CID = computeContentCid('semantic', 'Test', 'Test content', [
  'test',
]);

function makeDeps(
  overrides?: Partial<ContextPackServiceDeps>,
): ContextPackServiceDeps {
  const createdPack = {
    id: 'pack-uuid',
    diaryId: 'diary-uuid',
    packCid: 'bafyr-computed',
    packCodec: 'dag-cbor',
    packType: 'custom' as const,
    params: {},
    payload: {},
    createdBy: 'identity-uuid',
    supersedesPackId: null,
    sourcePackId: null,
    pinned: false,
    expiresAt: new Date('2026-04-05'),
    createdAt: new Date('2026-03-29'),
    creator: null,
  };

  return {
    contextPackRepository: {
      createPack: vi.fn().mockResolvedValue(createdPack),
      addEntries: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(null),
      findByCid: vi.fn().mockResolvedValue(null),
      findRenderedBySourcePackId: vi.fn().mockResolvedValue(null),
      clearSourcePackId: vi.fn().mockResolvedValue(undefined),
      listByDiary: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listEntriesExpanded: vi.fn().mockResolvedValue([]),
    },
    entryFetcher: {
      fetchEntries: vi.fn().mockResolvedValue([
        {
          id: 'entry-1',
          content: 'Test content',
          contentHash: ENTRY_CID,
          importance: 5,
          createdAt: new Date('2026-01-01'),
        },
      ]),
    },
    runTransaction: vi.fn().mockImplementation((fn) => fn()),
    grantPackParent: vi.fn().mockResolvedValue(undefined),
    ttlDays: 7,
    ...overrides,
  };
}

describe('ContextPackService', () => {
  describe('createCustomPack', () => {
    it('creates a pack with entries in a transaction', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      const result = await service.createCustomPack({
        diaryId: 'diary-uuid',
        entries: [{ entryId: 'entry-1', rank: 1 }],
        params: { recipe: 'test' },
        createdBy: 'identity-uuid',
      });

      expect(result.packCid).toMatch(/^bafyr/);
      expect(deps.runTransaction).toHaveBeenCalledOnce();
      expect(deps.contextPackRepository.createPack).toHaveBeenCalledOnce();
      expect(deps.contextPackRepository.addEntries).toHaveBeenCalledOnce();
      expect(deps.grantPackParent).toHaveBeenCalledOnce();
    });

    it('returns existing pack when CID already exists', async () => {
      const existingPack = {
        id: 'existing-pack',
        diaryId: 'diary-uuid',
        packCid: 'bafyr-existing',
        packCodec: 'dag-cbor',
        packType: 'custom' as const,
        params: {},
        payload: {},
        createdBy: 'identity-uuid',
        supersedesPackId: null,
        sourcePackId: null,
        pinned: false,
        expiresAt: null,
        createdAt: new Date(),
        creator: null,
      };
      const deps = makeDeps({
        contextPackRepository: {
          ...makeDeps().contextPackRepository,
          findByCid: vi.fn().mockResolvedValue(existingPack),
        },
      });
      const service = new ContextPackService(deps);

      const result = await service.createCustomPack({
        diaryId: 'diary-uuid',
        entries: [{ entryId: 'entry-1', rank: 1 }],
        params: { recipe: 'test' },
        createdBy: 'identity-uuid',
      });

      expect(result.packCid).toBeDefined();
      expect(deps.runTransaction).not.toHaveBeenCalled();
    });
  });

  describe('createRenderedPack', () => {
    it('creates a rendered pack linked to source', async () => {
      const sourcePack = {
        id: 'source-pack-id',
        diaryId: 'diary-uuid',
        packCid: 'bafyr-source',
        packCodec: 'dag-cbor',
        packType: 'compile' as const,
        params: { tokenBudget: 4000 },
        payload: {},
        createdBy: 'identity-uuid',
        supersedesPackId: null,
        sourcePackId: null,
        pinned: true,
        expiresAt: null,
        createdAt: new Date(),
        creator: null,
      };
      const sourceEntries = [
        {
          id: 'cpe-1',
          packId: 'source-pack-id',
          entryId: 'entry-1',
          entryCidSnapshot: ENTRY_CID,
          compressionLevel: 'full' as const,
          originalTokens: 50,
          packedTokens: 50,
          rank: 1,
          createdAt: new Date(),
          entry: {
            id: 'entry-1',
            diaryId: 'diary-uuid',
            title: 'Test',
            content: 'Test content',
            tags: ['test'],
            injectionRisk: false,
            importance: 5,
            accessCount: 0,
            lastAccessedAt: null,
            entryType: 'semantic' as const,
            contentHash: ENTRY_CID,
            contentSignature: null,
            createdAt: new Date(),
            updatedAt: new Date(),
            creator: null,
          },
        },
      ];
      const deps = makeDeps({
        contextPackRepository: {
          ...makeDeps().contextPackRepository,
          findById: vi.fn().mockResolvedValue(sourcePack),
          listEntriesExpanded: vi.fn().mockResolvedValue(sourceEntries),
        },
      });
      const service = new ContextPackService(deps);

      const result = await service.createRenderedPack({
        sourcePackId: 'source-pack-id',
        renderedMarkdown: '# Rendered docs\n\nContent here.',
        renderMethod: 'pack-to-docs-v1',
        createdBy: 'identity-uuid',
      });

      expect(result.sourcePackId).toBe('source-pack-id');
      expect(result.sourcePackCid).toBe('bafyr-source');
      expect(result.renderMethod).toBe('pack-to-docs-v1');
      expect(result.packCid).toMatch(/^bafyr/);
      expect(deps.runTransaction).toHaveBeenCalledOnce();
      expect(deps.grantPackParent).toHaveBeenCalledOnce();
    });

    it('throws when source pack does not exist', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      await expect(
        service.createRenderedPack({
          sourcePackId: 'nonexistent',
          renderedMarkdown: '# Docs',
          renderMethod: 'pack-to-docs-v1',
          createdBy: 'identity-uuid',
        }),
      ).rejects.toThrow(/not found/i);
    });
  });
});
