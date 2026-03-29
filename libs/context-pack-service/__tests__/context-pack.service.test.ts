import { computeContentCid, computePackCid } from '@moltnet/crypto-service';
import { describe, expect, it, vi } from 'vitest';

import {
  ContextPackService,
  type ContextPackServiceDeps,
  PackServiceError,
} from '../src/context-pack.service.js';

const ENTRY_CID = computeContentCid('semantic', 'Test', 'Test content', [
  'test',
]);

const SOURCE_PACK_CID = computePackCid({
  diaryId: 'diary-uuid',
  packType: 'custom',
  params: {},
  entries: [{ cid: ENTRY_CID, compressionLevel: 'full', rank: 1 }],
});

function makeRenderedPackRow(overrides?: Record<string, unknown>) {
  return {
    id: 'rendered-uuid',
    packCid: 'bafyr-rendered',
    sourcePackId: 'pack-uuid',
    diaryId: 'diary-uuid',
    content: '# Rendered',
    contentHash:
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    renderMethod: 'pack-to-docs-v1',
    totalTokens: 42,
    createdBy: 'identity-uuid',
    pinned: false,
    expiresAt: new Date('2026-04-05'),
    createdAt: new Date('2026-03-29'),
    updatedAt: new Date('2026-03-29'),
    ...overrides,
  };
}

function makeDeps(
  overrides?: Partial<ContextPackServiceDeps>,
): ContextPackServiceDeps {
  const createdPack = {
    id: 'pack-uuid',
    diaryId: 'diary-uuid',
    packCid: SOURCE_PACK_CID,
    packCodec: 'dag-cbor',
    packType: 'custom' as const,
    params: {},
    payload: {},
    createdBy: 'identity-uuid',
    supersedesPackId: null,
    pinned: false,
    expiresAt: new Date('2026-04-05'),
    createdAt: new Date('2026-03-29'),
    creator: null,
  };

  return {
    contextPackRepository: {
      createPack: vi.fn().mockResolvedValue(createdPack),
      addEntries: vi.fn().mockResolvedValue([]),
      findById: vi.fn().mockResolvedValue(createdPack),
      findByCid: vi.fn().mockResolvedValue(null),
      listByDiary: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listEntriesExpanded: vi.fn().mockResolvedValue([]),
    },
    renderedPackRepository: {
      create: vi.fn().mockResolvedValue(makeRenderedPackRow()),
      findByCid: vi.fn().mockResolvedValue(null),
      findLatestBySourcePackId: vi.fn().mockResolvedValue(null),
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
    removePackRelations: vi.fn().mockResolvedValue(undefined),
    deleteMany: vi.fn().mockResolvedValue(0),
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
    it('creates a rendered pack with CID and token estimate', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      const result = await service.createRenderedPack({
        sourcePackId: 'pack-uuid',
        renderedMarkdown: '# Hello\n\nThis is rendered content.',
        renderMethod: 'pack-to-docs-v1',
        createdBy: 'identity-uuid',
      });

      expect(result.packCid).toMatch(/^bafyr/);
      expect(result.sourcePackId).toBe('pack-uuid');
      expect(result.sourcePackCid).toBe(SOURCE_PACK_CID);
      expect(result.diaryId).toBe('diary-uuid');
      expect(result.renderMethod).toBe('pack-to-docs-v1');
      expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(deps.renderedPackRepository.create).toHaveBeenCalledOnce();
    });

    it('throws not_found when source pack does not exist', async () => {
      const deps = makeDeps({
        contextPackRepository: {
          ...makeDeps().contextPackRepository,
          findById: vi.fn().mockResolvedValue(null),
        },
      });
      const service = new ContextPackService(deps);

      await expect(
        service.createRenderedPack({
          sourcePackId: 'nonexistent',
          renderedMarkdown: '# Hello',
          renderMethod: 'pack-to-docs-v1',
          createdBy: 'identity-uuid',
        }),
      ).rejects.toThrow(PackServiceError);
    });

    it('returns existing rendered pack when CID matches', async () => {
      const deps = makeDeps({
        renderedPackRepository: {
          ...makeDeps().renderedPackRepository,
          create: vi.fn(),
          findByCid: vi.fn().mockResolvedValue({
            id: 'existing-rendered',
            packCid: 'bafyr-existing-rendered',
            totalTokens: 10,
            pinned: false,
          }),
          findLatestBySourcePackId: vi.fn().mockResolvedValue(null),
        },
      });
      const service = new ContextPackService(deps);

      const result = await service.createRenderedPack({
        sourcePackId: 'pack-uuid',
        renderedMarkdown: '# Hello',
        renderMethod: 'pack-to-docs-v1',
        createdBy: 'identity-uuid',
      });

      expect(result.id).toBe('existing-rendered');
      expect(deps.renderedPackRepository.create).not.toHaveBeenCalled();
    });

    it('respects pinned flag', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      await service.createRenderedPack({
        sourcePackId: 'pack-uuid',
        renderedMarkdown: '# Pinned content',
        renderMethod: 'pack-to-docs-v1',
        createdBy: 'identity-uuid',
        pinned: true,
      });

      const createCall = vi.mocked(deps.renderedPackRepository.create).mock
        .calls[0][0] as Record<string, unknown>;
      expect(createCall.pinned).toBe(true);
      expect(createCall.expiresAt).toBeNull();
    });
  });
});
