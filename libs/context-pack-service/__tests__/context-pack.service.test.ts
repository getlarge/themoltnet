import { KetoNamespace } from '@moltnet/auth';
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
      findByEntryId: vi
        .fn()
        .mockResolvedValue({ items: [createdPack], total: 1 }),
      listByDiary: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      listEntriesExpanded: vi.fn().mockResolvedValue([]),
    },
    renderedPackRepository: {
      create: vi.fn().mockResolvedValue(makeRenderedPackRow()),
      findByCid: vi.fn().mockResolvedValue(null),
      findLatestBySourcePackId: vi.fn().mockResolvedValue(null),
      listBySourcePackIds: vi.fn().mockResolvedValue([makeRenderedPackRow()]),
    },
    diaryEntryRepository: {
      findById: vi.fn().mockResolvedValue({
        id: 'entry-1',
        diaryId: 'diary-uuid',
      }),
    },
    permissionChecker: {
      canViewEntry: vi.fn().mockResolvedValue(true),
      canReadPacks: vi.fn().mockResolvedValue(new Map([['pack-uuid', true]])),
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
  describe('listPacksByEntry', () => {
    it('returns visible packs and optional rendered packs', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      const result = await service.listPacksByEntry({
        entryId: 'entry-1',
        actor: { identityId: 'identity-uuid', subjectNs: KetoNamespace.Agent },
        limit: 20,
        offset: 0,
        includeRendered: true,
      });

      expect(deps.diaryEntryRepository.findById).toHaveBeenCalledWith(
        'entry-1',
      );
      expect(deps.permissionChecker.canViewEntry).toHaveBeenCalledWith(
        'entry-1',
        'identity-uuid',
        KetoNamespace.Agent,
      );
      expect(deps.contextPackRepository.findByEntryId).toHaveBeenCalledWith(
        'entry-1',
        { diaryId: undefined, limit: 20, offset: 0 },
      );
      expect(result.items).toHaveLength(1);
      expect(result.renderedPacks).toHaveLength(1);
    });

    it('throws not_found when the entry does not exist', async () => {
      const deps = makeDeps({
        diaryEntryRepository: {
          findById: vi.fn().mockResolvedValue(null),
        },
      });
      const service = new ContextPackService(deps);

      await expect(
        service.listPacksByEntry({
          entryId: 'missing-entry',
          actor: {
            identityId: 'identity-uuid',
            subjectNs: KetoNamespace.Agent,
          },
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('throws forbidden when the actor cannot view the entry', async () => {
      const deps = makeDeps({
        permissionChecker: {
          canViewEntry: vi.fn().mockResolvedValue(false),
          canReadPacks: vi.fn(),
        },
      });
      const service = new ContextPackService(deps);

      await expect(
        service.listPacksByEntry({
          entryId: 'entry-1',
          actor: {
            identityId: 'identity-uuid',
            subjectNs: KetoNamespace.Agent,
          },
        }),
      ).rejects.toMatchObject({ code: 'forbidden' });
    });
  });

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
      expect(result.renderedMarkdown).toBe(
        '# Hello\n\nThis is rendered content.',
      );
      expect(result.contentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(deps.renderedPackRepository.create).toHaveBeenCalledOnce();
    });

    it('renders server methods from source pack entries', async () => {
      const deps = makeDeps({
        contextPackRepository: {
          ...makeDeps().contextPackRepository,
          listEntriesExpanded: vi.fn().mockResolvedValue([
            {
              id: 'pack-entry-1',
              packId: 'pack-uuid',
              entryId: 'entry-1',
              entryCidSnapshot: ENTRY_CID,
              compressionLevel: 'full',
              originalTokens: 12,
              packedTokens: 12,
              rank: 1,
              createdAt: new Date('2026-03-29'),
              entry: {
                id: 'entry-1',
                diaryId: 'diary-uuid',
                title: 'Auth middleware notes',
                content: 'Authentication middleware uses RS256 JWT tokens.',
                tags: ['auth'],
                injectionRisk: false,
                importance: 5,
                accessCount: 0,
                lastAccessedAt: null,
                entryType: 'semantic',
                contentHash: ENTRY_CID,
                contentSignature: null,
                createdAt: new Date('2026-03-29'),
                updatedAt: new Date('2026-03-29'),
                creator: null,
              },
            },
          ]),
        },
      });
      const service = new ContextPackService(deps);

      const createResult = await service.createRenderedPack({
        sourcePackId: 'pack-uuid',
        renderMethod: 'server:pack-to-docs-v1',
        createdBy: 'identity-uuid',
      });

      expect(
        deps.contextPackRepository.listEntriesExpanded,
      ).toHaveBeenCalledWith('pack-uuid');
      expect(createResult.renderedMarkdown).toContain(
        '# Context Pack pack-uuid',
      );
      expect(createResult.renderedMarkdown).toContain('Auth middleware notes');
      const createCall = vi.mocked(deps.renderedPackRepository.create).mock
        .calls[0][0] as Record<string, unknown>;
      expect(createCall.content).toContain('# Context Pack pack-uuid');
      expect(createCall.content).toContain('Auth middleware notes');
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

    it('rejects renderedMarkdown for server render methods', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      await expect(
        service.createRenderedPack({
          sourcePackId: 'pack-uuid',
          renderedMarkdown: '# Hello',
          renderMethod: 'server:pack-to-docs-v1',
          createdBy: 'identity-uuid',
        }),
      ).rejects.toMatchObject({
        code: 'validation',
        message:
          'renderedMarkdown must not be provided for server render methods',
      });
    });

    it('requires renderedMarkdown for non-server render methods', async () => {
      const deps = makeDeps();
      const service = new ContextPackService(deps);

      await expect(
        service.createRenderedPack({
          sourcePackId: 'pack-uuid',
          renderMethod: 'agent-refined',
          createdBy: 'identity-uuid',
        }),
      ).rejects.toMatchObject({
        code: 'validation',
        message: 'renderedMarkdown is required for non-server render methods',
      });
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

    it('previews server-rendered markdown without persisting', async () => {
      const deps = makeDeps({
        contextPackRepository: {
          ...makeDeps().contextPackRepository,
          listEntriesExpanded: vi.fn().mockResolvedValue([
            {
              id: 'pack-entry-1',
              packId: 'pack-uuid',
              entryId: 'entry-1',
              entryCidSnapshot: ENTRY_CID,
              compressionLevel: 'summary',
              originalTokens: 12,
              packedTokens: 6,
              rank: 1,
              createdAt: new Date('2026-03-29'),
              entry: {
                id: 'entry-1',
                diaryId: 'diary-uuid',
                title: null,
                content: 'Keto permission checks use relation tuples.',
                tags: ['auth'],
                injectionRisk: false,
                importance: 5,
                accessCount: 0,
                lastAccessedAt: null,
                entryType: 'semantic',
                contentHash: ENTRY_CID,
                contentSignature: null,
                createdAt: new Date('2026-03-29'),
                updatedAt: new Date('2026-03-29'),
                creator: null,
              },
            },
          ]),
        },
      });
      const service = new ContextPackService(deps);

      const result = await service.previewRenderedPack({
        sourcePackId: 'pack-uuid',
        renderMethod: 'server:pack-to-docs-v1',
      });

      expect(result.renderedMarkdown).toContain('# Context Pack pack-uuid');
      expect(result.renderedMarkdown).toContain('Keto permission checks');
      expect(deps.renderedPackRepository.create).not.toHaveBeenCalled();
    });
  });
});
