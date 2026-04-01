import { KetoNamespace } from '@moltnet/auth';
import { computeContentCid } from '@moltnet/crypto-service';
import type { FastifyBaseLogger } from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
} as unknown as FastifyBaseLogger;

// Mock diary workflows before service import so the service uses the mock
vi.mock('../src/workflows/diary-workflows.js', () => ({
  diaryWorkflows: {
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
}));

import type { EntryRelationRepository } from '@moltnet/database';

import {
  buildEmbeddingText,
  createDiaryService,
  type DiaryService,
} from '../src/diary-service.js';
import type {
  DiaryEntry,
  DiaryEntryRepository,
  DiaryRepository,
  EmbeddingService,
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
  TransactionRunner,
} from '../src/index.js';
import { DiaryServiceError } from '../src/types.js';
import { diaryWorkflows } from '../src/workflows/diary-workflows.js';

const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';

const MOCK_EMBEDDING = Array.from({ length: 384 }, (_, i) => i * 0.001);

function createMockEntry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: ENTRY_ID,
    diaryId: DIARY_ID,
    createdBy: OWNER_ID,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    tags: null,
    injectionRisk: false,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    entryType: 'semantic' as const,
    contentHash: null,
    contentSignature: null,
    signingNonce: null,
    createdAt: new Date('2026-01-30T10:00:00Z'),
    updatedAt: new Date('2026-01-30T10:00:00Z'),
    ...overrides,
  };
}

function createMockDiaryEntryRepository(): {
  [K in keyof DiaryEntryRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getRecentForDigest: vi.fn(),
    countSignedByDiary: vi.fn(),
  };
}

function createMockPermissionChecker(): {
  [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
} {
  return {
    canViewEntry: vi.fn().mockResolvedValue(true),
    canEditEntry: vi.fn().mockResolvedValue(true),
    canDeleteEntry: vi.fn().mockResolvedValue(true),
    canEditAnyEntry: vi.fn().mockResolvedValue(false),
    canReadDiary: vi.fn().mockResolvedValue(true),
    canWriteDiary: vi.fn().mockResolvedValue(true),
    canManageDiary: vi.fn().mockResolvedValue(true),
    canReadPack: vi.fn().mockResolvedValue(false),
    canReadPacks: vi.fn().mockResolvedValue(new Map()),
    canManagePack: vi.fn().mockResolvedValue(false),
    canAccessTeam: vi.fn().mockResolvedValue(false),
    canWriteTeam: vi.fn().mockResolvedValue(false),
    canManageTeam: vi.fn().mockResolvedValue(false),
    canManageTeamMembers: vi.fn().mockResolvedValue(false),
  };
}

function createMockRelationshipReader(): {
  [K in keyof RelationshipReader]: ReturnType<typeof vi.fn>;
} {
  return {
    listTeamIdsBySubject: vi.fn().mockResolvedValue([]),
    listTeamIdsAndRolesBySubject: vi.fn().mockResolvedValue([]),
    listTeamMembers: vi.fn().mockResolvedValue([]),
    listGroupMembers: vi.fn().mockResolvedValue([]),
  };
}

function createMockRelationshipWriter(): {
  [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
} {
  return {
    grantEntryParent: vi.fn().mockResolvedValue(undefined),
    registerAgent: vi.fn().mockResolvedValue(undefined),
    registerHuman: vi.fn().mockResolvedValue(undefined),
    removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    grantDiaryTeam: vi.fn().mockResolvedValue(undefined),
    removeDiaryTeam: vi.fn().mockResolvedValue(undefined),
    removeDiaryRelations: vi.fn().mockResolvedValue(undefined),
    grantPackParent: vi.fn().mockResolvedValue(undefined),
    removePackRelations: vi.fn().mockResolvedValue(undefined),
    removePackRelationsBatch: vi.fn().mockResolvedValue(undefined),
    grantTeamOwners: vi.fn().mockResolvedValue(undefined),
    grantTeamManagers: vi.fn().mockResolvedValue(undefined),
    grantTeamMembers: vi.fn().mockResolvedValue(undefined),
    removeTeamMemberRelation: vi.fn().mockResolvedValue(undefined),
    grantGroupParent: vi.fn().mockResolvedValue(undefined),
    grantGroupMember: vi.fn().mockResolvedValue(undefined),
    removeGroupMember: vi.fn().mockResolvedValue(undefined),
    removeGroupRelations: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockEmbeddingService(): {
  [K in keyof EmbeddingService]: ReturnType<typeof vi.fn>;
} {
  return {
    embedPassage: vi.fn(),
    embedQuery: vi.fn(),
  };
}

function createMockDiaryRepository(): {
  [K in keyof DiaryRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByCreator: vi.fn(),
    listByIds: vi.fn(),
    listByCreator: vi.fn(),
    listByTeamIds: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockEntryRelationRepository(): {
  [K in keyof EntryRelationRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    createMany: vi.fn(),
    listByEntry: vi.fn(),
    updateStatus: vi.fn(),
    delete: vi.fn(),
    listSupersededTargetIds: vi.fn().mockResolvedValue([]),
  };
}

const TEAM_ID = '00000000-0000-4000-b000-000000000001';

const MOCK_DIARY = {
  id: DIARY_ID,
  createdBy: OWNER_ID,
  teamId: TEAM_ID,
  name: 'default',
  visibility: 'private' as const,
  signed: false,
  createdAt: new Date('2026-01-30T10:00:00Z'),
  updatedAt: new Date('2026-01-30T10:00:00Z'),
};

describe('DiaryService', () => {
  let service: DiaryService;
  let repo: ReturnType<typeof createMockDiaryEntryRepository>;
  let diaryRepo: ReturnType<typeof createMockDiaryRepository>;
  let permissions: ReturnType<typeof createMockPermissionChecker>;
  let reader: ReturnType<typeof createMockRelationshipReader>;
  let writer: ReturnType<typeof createMockRelationshipWriter>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;
  let entryRelationRepo: ReturnType<typeof createMockEntryRelationRepository>;
  let transactionRunner: {
    runInTransaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.mocked(diaryWorkflows.createEntry).mockReset();
    vi.mocked(diaryWorkflows.updateEntry).mockReset();
    vi.mocked(diaryWorkflows.deleteEntry).mockReset();

    repo = createMockDiaryEntryRepository();
    diaryRepo = createMockDiaryRepository();
    diaryRepo.findById.mockResolvedValue(MOCK_DIARY);
    permissions = createMockPermissionChecker();
    reader = createMockRelationshipReader();
    writer = createMockRelationshipWriter();
    embeddings = createMockEmbeddingService();
    entryRelationRepo = createMockEntryRelationRepository();
    transactionRunner = {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    };

    service = createDiaryService({
      logger,
      diaryRepository: diaryRepo as unknown as DiaryRepository,
      diaryEntryRepository: repo as unknown as DiaryEntryRepository,
      entryRelationRepository:
        entryRelationRepo as unknown as EntryRelationRepository,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipReader: reader as unknown as RelationshipReader,
      relationshipWriter: writer as unknown as RelationshipWriter,
      embeddingService: embeddings as unknown as EmbeddingService,
      transactionRunner: transactionRunner as unknown as TransactionRunner,
    });
  });

  describe('create', () => {
    it('delegates to diaryWorkflows.createEntry with a computed contentHash', async () => {
      const mockEntry = createMockEntry();
      vi.mocked(diaryWorkflows.createEntry).mockResolvedValue(mockEntry);

      const input = {
        diaryId: DIARY_ID,
        content: 'Test diary entry content',
        title: 'My Entry',
        tags: ['test'],
        importance: 8,
        entryType: 'identity' as const,
      };
      const result = await service.createEntry(
        input,
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(result).toEqual(mockEntry);
      expect(diaryWorkflows.createEntry).toHaveBeenCalledWith({
        ...input,
        contentHash: computeContentCid(
          input.entryType,
          input.title,
          input.content,
          input.tags,
        ),
        createdBy: OWNER_ID,
      });
    });

    it('rejects mismatched provided contentHash', async () => {
      await expect(
        service.createEntry(
          {
            diaryId: DIARY_ID,
            content: 'Test diary entry content',
            title: 'My Entry',
            tags: ['test'],
            contentHash: 'bafkreibadcid',
          },
          OWNER_ID,
          KetoNamespace.Agent,
        ),
      ).rejects.toThrow(DiaryServiceError);

      expect(diaryWorkflows.createEntry).not.toHaveBeenCalled();
    });

    it('propagates errors from the workflow', async () => {
      vi.mocked(diaryWorkflows.createEntry).mockRejectedValue(
        new Error('Failed to grant ownership after entry creation'),
      );

      await expect(
        service.createEntry(
          { diaryId: DIARY_ID, content: 'Test' },
          OWNER_ID,
          KetoNamespace.Agent,
        ),
      ).rejects.toThrow('Failed to grant ownership after entry creation');
    });
  });

  describe('createDiary', () => {
    it('compensates by deleting DB row when Keto grantDiaryTeam fails', async () => {
      const createdDiary = {
        ...MOCK_DIARY,
        id: 'new-diary-id',
        name: 'My Diary',
      };
      diaryRepo.create.mockResolvedValue(createdDiary);
      writer.grantDiaryTeam.mockRejectedValue(new Error('Keto unavailable'));
      diaryRepo.delete.mockResolvedValue(true);

      await expect(
        service.createDiary({
          createdBy: OWNER_ID,
          teamId: TEAM_ID,
          name: 'My Diary',
        }),
      ).rejects.toThrow('Keto unavailable');

      expect(diaryRepo.delete).toHaveBeenCalledWith('new-diary-id');
    });

    it('preserves original Keto error when compensation delete also fails', async () => {
      const createdDiary = {
        ...MOCK_DIARY,
        id: 'new-diary-id',
        name: 'My Diary',
      };
      diaryRepo.create.mockResolvedValue(createdDiary);
      writer.grantDiaryTeam.mockRejectedValue(new Error('Keto unavailable'));
      diaryRepo.delete.mockRejectedValue(new Error('DB also down'));

      await expect(
        service.createDiary({
          createdBy: OWNER_ID,
          teamId: TEAM_ID,
          name: 'My Diary',
        }),
      ).rejects.toThrow('Keto unavailable');
    });

    it('returns diary when Keto grant succeeds', async () => {
      const createdDiary = {
        ...MOCK_DIARY,
        id: 'new-diary-id',
        name: 'My Diary',
      };
      diaryRepo.create.mockResolvedValue(createdDiary);
      writer.grantDiaryTeam.mockResolvedValue(undefined);

      const result = await service.createDiary({
        createdBy: OWNER_ID,
        teamId: TEAM_ID,
        name: 'My Diary',
      });

      expect(result).toEqual(createdDiary);
      expect(diaryRepo.delete).not.toHaveBeenCalled();
    });
  });

  describe('listDiaries', () => {
    it('queries Keto for team IDs then fetches diaries by team IDs', async () => {
      reader.listTeamIdsBySubject.mockResolvedValue([TEAM_ID]);
      diaryRepo.listByTeamIds.mockResolvedValue([MOCK_DIARY]);

      const result = await service.listDiaries(OWNER_ID);

      expect(reader.listTeamIdsBySubject).toHaveBeenCalledWith(OWNER_ID);
      expect(diaryRepo.listByTeamIds).toHaveBeenCalledWith([TEAM_ID]);
      expect(result).toEqual([MOCK_DIARY]);
    });

    it('returns empty array when agent has no team relations', async () => {
      reader.listTeamIdsBySubject.mockResolvedValue([]);
      diaryRepo.listByTeamIds.mockResolvedValue([]);

      const result = await service.listDiaries(OWNER_ID);

      expect(diaryRepo.listByTeamIds).toHaveBeenCalledWith([]);
      expect(result).toEqual([]);
    });
  });

  describe('getById', () => {
    it('returns entry when Keto allows', async () => {
      const mockEntry = createMockEntry();
      repo.findById.mockResolvedValue(mockEntry);
      permissions.canViewEntry.mockResolvedValue(true);

      const result = await service.getEntryById(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
        { diaryId: DIARY_ID },
      );

      expect(result).toEqual(mockEntry);
      expect(repo.findById).toHaveBeenCalledWith(ENTRY_ID);
      expect(permissions.canViewEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );
    });

    it('throws forbidden when Keto denies', async () => {
      const mockEntry = createMockEntry();
      repo.findById.mockResolvedValue(mockEntry);
      permissions.canViewEntry.mockResolvedValue(false);

      await expect(
        service.getEntryById(ENTRY_ID, OTHER_AGENT_ID, KetoNamespace.Agent, {
          diaryId: DIARY_ID,
        }),
      ).rejects.toThrow(DiaryServiceError);
      expect(permissions.canViewEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OTHER_AGENT_ID,
        KetoNamespace.Agent,
      );
    });
  });

  describe('list', () => {
    it('lists entries for a diary', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      repo.list.mockResolvedValue({ items: entries, total: 5 });

      const result = await service.listEntries({ diaryId: DIARY_ID });

      expect(result).toEqual({ items: entries, total: 5 });
      expect(repo.list).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        excludeTags: undefined,
        entryTypes: undefined,
        limit: undefined,
        offset: undefined,
      });
    });

    it('passes filtering options through', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });

      await service.listEntries({
        diaryId: DIARY_ID,
        limit: 10,
        offset: 5,
      });

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          limit: 10,
          offset: 5,
        }),
      );
    });

    it('passes entryTypes filter to repository', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });

      await service.listEntries({
        diaryId: DIARY_ID,
        entryTypes: ['reflection'],
      });

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          entryTypes: ['reflection'],
        }),
      );
    });
  });

  describe('search', () => {
    it('searches with query and embedding', async () => {
      const entries = [createMockEntry()];
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue(entries);

      permissions.canReadDiary.mockResolvedValue(true);
      const result = await service.searchEntries(
        {
          diaryId: DIARY_ID,
          query: 'find relevant entries',
        },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(result).toEqual(entries);
      expect(embeddings.embedQuery).toHaveBeenCalledWith(
        'find relevant entries',
      );
      expect(repo.search).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        query: 'find relevant entries',
        embedding: MOCK_EMBEDDING,
        limit: undefined,
        offset: undefined,
      });
    });

    it('searches without embedding if no query provided', async () => {
      repo.search.mockResolvedValue([]);

      permissions.canReadDiary.mockResolvedValue(true);
      await service.searchEntries(
        { diaryId: DIARY_ID },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(embeddings.embedQuery).not.toHaveBeenCalled();
      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('passes weighted scoring params to repository', async () => {
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue([]);

      permissions.canReadDiary.mockResolvedValue(true);
      await service.searchEntries(
        {
          diaryId: DIARY_ID,
          query: 'important memories',
          wRelevance: 1.0,
          wRecency: 0.3,
          wImportance: 0.2,
          entryTypes: ['identity', 'reflection'],
          excludeSuperseded: true,
        },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({
          wRelevance: 1.0,
          wRecency: 0.3,
          wImportance: 0.2,
          entryTypes: ['identity', 'reflection'],
          excludeSuperseded: true,
        }),
      );
    });

    it('searches without embedding if embedding service fails', async () => {
      embeddings.embedQuery.mockRejectedValue(new Error('Embed failed'));
      repo.search.mockResolvedValue([]);

      permissions.canReadDiary.mockResolvedValue(true);
      await service.searchEntries(
        {
          diaryId: DIARY_ID,
          query: 'test query',
        },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test query',
          embedding: undefined,
        }),
      );
    });
  });

  describe('update', () => {
    it('throws forbidden when Keto denies edit', async () => {
      permissions.canEditEntry.mockResolvedValue(false);

      await expect(
        service.updateEntry(ENTRY_ID, OTHER_AGENT_ID, KetoNamespace.Agent, {
          title: 'Hacked',
        }),
      ).rejects.toThrow(DiaryServiceError);
      expect(diaryWorkflows.updateEntry).not.toHaveBeenCalled();
    });

    it('checks permission then delegates to diaryWorkflows.updateEntry', async () => {
      const existing = createMockEntry({ title: 'Old Title' });
      const updated = createMockEntry({ title: 'Updated Title' });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue(updated);

      const result = await service.updateEntry(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
        {
          title: 'Updated Title',
        },
      );

      expect(result).toEqual(updated);
      expect(permissions.canEditEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );
      expect(diaryWorkflows.updateEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({
          title: 'Updated Title',
          contentHash: expect.any(String),
        }),
        existing.content,
        existing.title,
        existing.tags,
      );
    });

    it('fetches existing entry when content, title, or tags change', async () => {
      const existing = createMockEntry();
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue(existing);

      await service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
        content: 'New content',
      });
      expect(repo.findById).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('allows metadata changes on unsigned entries', async () => {
      const existing = createMockEntry();
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue(
        createMockEntry({ importance: 9 }),
      );

      await service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
        importance: 9,
        entryType: 'soul',
      });

      expect(repo.findById).toHaveBeenCalledWith(ENTRY_ID);
      expect(diaryWorkflows.updateEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({
          importance: 9,
          entryType: 'soul',
          contentHash: expect.any(String),
        }),
        existing.content,
        existing.title,
        existing.tags,
      );
    });

    it('rejects content changes on signed entries', async () => {
      const signed = createMockEntry({
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);

      await expect(
        service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
          content: 'New content',
        }),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('rejects tags/importance changes on signed identity entries', async () => {
      const signed = createMockEntry({
        entryType: 'identity',
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);

      await expect(
        service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
          importance: 10,
        }),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('rejects title changes on signed entries', async () => {
      const signed = createMockEntry({
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);

      await expect(
        service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
          title: 'New title',
        }),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('rejects entryType changes on signed entries', async () => {
      const signed = createMockEntry({
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);

      await expect(
        service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
          entryType: 'reflection',
        }),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('rejects tags changes on signed semantic entries', async () => {
      const signed = createMockEntry({
        entryType: 'semantic',
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);

      await expect(
        service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
          tags: ['new-tag'],
        }),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('allows importance changes on signed semantic entries', async () => {
      const signed = createMockEntry({
        entryType: 'semantic',
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue(
        createMockEntry({ importance: 8 }),
      );

      await service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
        importance: 8,
      });

      expect(diaryWorkflows.updateEntry).toHaveBeenCalled();
    });

    it('rejects importance changes on signed reflection entries', async () => {
      const signed = createMockEntry({
        entryType: 'reflection',
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);

      await expect(
        service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
          importance: 10,
        }),
      ).rejects.toThrow(DiaryServiceError);
    });

    it('recomputes contentHash when content changes on unsigned entry', async () => {
      const unsigned = createMockEntry({
        contentHash: 'bafkreiold',
        contentSignature: null,
        content: 'old content',
        title: 'Old Title',
        entryType: 'semantic',
        tags: ['tag1'],
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(unsigned);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue({
        ...unsigned,
        content: 'new content',
        contentHash: 'bafkreinew',
      });

      await service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
        content: 'new content',
      });

      const updateCall = vi.mocked(diaryWorkflows.updateEntry).mock.calls[0]!;
      const updatesArg = updateCall[1] as Record<string, unknown>;
      expect(updatesArg.contentHash).toBeDefined();
      expect(updatesArg.contentHash).not.toBe('bafkreiold');
    });

    it('recomputes contentHash when tags change on unsigned entry', async () => {
      const unsigned = createMockEntry({
        contentHash: 'bafkreiold',
        contentSignature: null,
        content: 'some content',
        entryType: 'semantic',
        tags: ['old-tag'],
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(unsigned);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue({
        ...unsigned,
        tags: ['new-tag'],
      });

      await service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
        tags: ['new-tag'],
      });

      const updateCall = vi.mocked(diaryWorkflows.updateEntry).mock.calls[0]!;
      const updatesArg = updateCall[1] as Record<string, unknown>;
      expect(updatesArg.contentHash).toBeDefined();
      expect(updatesArg.contentHash).not.toBe('bafkreiold');
    });

    it('does not recompute contentHash on signed entry updates', async () => {
      const signed = createMockEntry({
        entryType: 'semantic',
        contentHash: 'bafkreisigned',
        contentSignature: 'sig123',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(signed);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue({
        ...signed,
        importance: 8,
      });

      await service.updateEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent, {
        importance: 8,
      });

      const updateCall = vi.mocked(diaryWorkflows.updateEntry).mock.calls[0]!;
      const updatesArg = updateCall[1] as Record<string, unknown>;
      expect(updatesArg.contentHash).toBeUndefined();
    });
  });

  describe('deleteDiary', () => {
    it('rejects deletion of diary containing signed entries', async () => {
      diaryRepo.findById.mockResolvedValue(MOCK_DIARY);
      permissions.canManageDiary.mockResolvedValue(true);
      repo.countSignedByDiary.mockResolvedValue(1);

      const err = await service
        .deleteDiary(DIARY_ID, OWNER_ID, KetoNamespace.Agent)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DiaryServiceError);
      expect((err as DiaryServiceError).message).toContain(
        'Cannot delete diary',
      );
    });

    it('allows deletion of diary with no signed entries', async () => {
      diaryRepo.findById.mockResolvedValue(MOCK_DIARY);
      permissions.canManageDiary.mockResolvedValue(true);
      repo.countSignedByDiary.mockResolvedValue(0);
      diaryRepo.delete.mockResolvedValue(true);

      const result = await service.deleteDiary(
        DIARY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
    });
  });

  describe('delete', () => {
    it('throws not_found when entry does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(
        service.deleteEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent),
      ).rejects.toThrow(DiaryServiceError);
      expect(diaryWorkflows.deleteEntry).not.toHaveBeenCalled();
    });

    it('throws forbidden when Keto denies delete', async () => {
      repo.findById.mockResolvedValue(createMockEntry());
      permissions.canDeleteEntry.mockResolvedValue(false);

      await expect(
        service.deleteEntry(ENTRY_ID, OTHER_AGENT_ID, KetoNamespace.Agent),
      ).rejects.toThrow(DiaryServiceError);
      expect(diaryWorkflows.deleteEntry).not.toHaveBeenCalled();
    });

    it('checks permission then delegates to diaryWorkflows.deleteEntry', async () => {
      repo.findById.mockResolvedValue(createMockEntry());
      permissions.canDeleteEntry.mockResolvedValue(true);
      vi.mocked(diaryWorkflows.deleteEntry).mockResolvedValue(true);

      const result = await service.deleteEntry(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(permissions.canDeleteEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );
      expect(diaryWorkflows.deleteEntry).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('returns false when workflow reports entry not found', async () => {
      repo.findById.mockResolvedValue(createMockEntry());
      permissions.canDeleteEntry.mockResolvedValue(true);
      vi.mocked(diaryWorkflows.deleteEntry).mockResolvedValue(false);

      const result = await service.deleteEntry(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(false);
    });

    it('rejects deletion of signed entry with immutable error', async () => {
      const signed = createMockEntry({
        contentHash: 'bafkreitest',
        contentSignature: 'sig123',
      });
      repo.findById.mockResolvedValue(signed);
      permissions.canDeleteEntry.mockResolvedValue(true);

      await expect(
        service.deleteEntry(ENTRY_ID, OWNER_ID, KetoNamespace.Agent),
      ).rejects.toThrow('Cannot delete a content-signed entry');

      expect(diaryWorkflows.deleteEntry).not.toHaveBeenCalled();
    });

    it('allows deletion of unsigned entry', async () => {
      const unsigned = createMockEntry({
        contentHash: null,
        contentSignature: null,
      });
      repo.findById.mockResolvedValue(unsigned);
      permissions.canDeleteEntry.mockResolvedValue(true);
      vi.mocked(diaryWorkflows.deleteEntry).mockResolvedValue(true);

      const result = await service.deleteEntry(
        ENTRY_ID,
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(result).toBe(true);
      expect(diaryWorkflows.deleteEntry).toHaveBeenCalledWith(ENTRY_ID);
    });
  });

  describe('reflect', () => {
    it('generates digest from recent entries', async () => {
      const entries = [
        createMockEntry({
          content: 'I learned about OAuth2',
          tags: ['learning'],
        }),
        createMockEntry({
          id: 'entry-2',
          content: 'Met another agent named Pith',
          tags: ['social'],
        }),
      ];
      repo.getRecentForDigest.mockResolvedValue(entries);

      const result = await service.reflect({ diaryId: DIARY_ID });

      expect(result.entries).toHaveLength(2);
      expect(result.totalEntries).toBe(2);
      expect(result.periodDays).toBe(7);
      expect(result.generatedAt).toBeDefined();
      expect(result.entries[0].content).toBe('I learned about OAuth2');
    });

    it('uses custom days and limit', async () => {
      repo.getRecentForDigest.mockResolvedValue([]);

      await service.reflect({
        diaryId: DIARY_ID,
        days: 30,
        maxEntries: 100,
      });

      expect(repo.getRecentForDigest).toHaveBeenCalledWith(
        DIARY_ID,
        30,
        100,
        undefined,
      );
    });

    it('returns empty digest when no entries', async () => {
      repo.getRecentForDigest.mockResolvedValue([]);

      const result = await service.reflect({ diaryId: DIARY_ID });

      expect(result.entries).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });

    it('passes entryTypes filter to repository', async () => {
      repo.getRecentForDigest.mockResolvedValue([]);

      await service.reflect({
        diaryId: DIARY_ID,
        entryTypes: ['identity', 'soul'],
      });

      expect(repo.getRecentForDigest).toHaveBeenCalledWith(DIARY_ID, 7, 50, [
        'identity',
        'soul',
      ]);
    });

    it('excludes superseded entries from digest', async () => {
      const entries = [
        createMockEntry({
          id: 'active-entry',
          content: 'Current knowledge',
        }),
        createMockEntry({
          id: 'old-entry',
          content: 'Outdated knowledge',
        }),
      ];
      repo.getRecentForDigest.mockResolvedValue(entries);
      // 'old-entry' is the target of a 'supersedes' relation — it is superseded
      entryRelationRepo.listSupersededTargetIds.mockResolvedValue([
        'old-entry',
      ]);

      const result = await service.reflect({ diaryId: DIARY_ID });

      expect(result.entries).toHaveLength(1);
      expect(result.entries[0].id).toBe('active-entry');
      expect(result.totalEntries).toBe(1);
    });

    it('includes importance and entryType in digest entries', async () => {
      const entries = [
        createMockEntry({
          importance: 8,
          entryType: 'identity',
        }),
      ];
      repo.getRecentForDigest.mockResolvedValue(entries);

      const result = await service.reflect({ diaryId: DIARY_ID });

      expect(result.entries[0].importance).toBe(8);
      expect(result.entries[0].entryType).toBe('identity');
    });
  });
});

describe('buildEmbeddingText', () => {
  it('returns content unchanged when no tags or title', () => {
    expect(buildEmbeddingText('hello world')).toBe('hello world');
  });

  it('returns content unchanged for empty tags array', () => {
    expect(buildEmbeddingText('hello world', [])).toBe('hello world');
  });

  it('returns content unchanged for null tags', () => {
    expect(buildEmbeddingText('hello world', null)).toBe('hello world');
  });

  it('appends tag: prefixed lines for each tag', () => {
    const result = buildEmbeddingText('my entry', [
      'accountable-commit',
      'high-risk',
    ]);
    expect(result).toBe('my entry\ntag:accountable-commit\ntag:high-risk');
  });

  it('handles single tag', () => {
    const result = buildEmbeddingText('content', ['solo']);
    expect(result).toBe('content\ntag:solo');
  });

  it('prepends title when provided', () => {
    const result = buildEmbeddingText('body text', null, 'My Title');
    expect(result).toBe('My Title\nbody text');
  });

  it('includes title, content, and tags together', () => {
    const result = buildEmbeddingText('body', ['tag1', 'tag2'], 'Title');
    expect(result).toBe('Title\nbody\ntag:tag1\ntag:tag2');
  });

  it('skips title when null', () => {
    const result = buildEmbeddingText('body', ['tag1'], null);
    expect(result).toBe('body\ntag:tag1');
  });

  it('skips title when empty string', () => {
    const result = buildEmbeddingText('body', null, '');
    expect(result).toBe('body');
  });
});

describe('DiaryService — tags filter', () => {
  let service: DiaryService;
  let repo: ReturnType<typeof createMockDiaryEntryRepository>;
  let diaryRepo: ReturnType<typeof createMockDiaryRepository>;
  let permissions: ReturnType<typeof createMockPermissionChecker>;
  let reader: ReturnType<typeof createMockRelationshipReader>;
  let writer: ReturnType<typeof createMockRelationshipWriter>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;
  let transactionRunner: {
    runInTransaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = createMockDiaryEntryRepository();
    diaryRepo = createMockDiaryRepository();
    diaryRepo.findById.mockResolvedValue(MOCK_DIARY);
    permissions = createMockPermissionChecker();
    reader = createMockRelationshipReader();
    writer = createMockRelationshipWriter();
    embeddings = createMockEmbeddingService();
    transactionRunner = {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    };

    service = createDiaryService({
      logger,
      diaryRepository: diaryRepo as unknown as DiaryRepository,
      diaryEntryRepository: repo as unknown as DiaryEntryRepository,
      entryRelationRepository:
        createMockEntryRelationRepository() as unknown as EntryRelationRepository,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipReader: reader as unknown as RelationshipReader,
      relationshipWriter: writer as unknown as RelationshipWriter,
      embeddingService: embeddings as unknown as EmbeddingService,
      transactionRunner: transactionRunner as unknown as TransactionRunner,
    });
  });

  describe('list', () => {
    it('passes tags filter to repository', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });

      await service.listEntries({
        diaryId: DIARY_ID,
        tags: ['accountable-commit'],
      });

      expect(repo.list).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        tags: ['accountable-commit'],
        excludeTags: undefined,
        entryTypes: undefined,
        limit: undefined,
        offset: undefined,
      });
    });

    it('passes tags with other filters', async () => {
      repo.list.mockResolvedValue({ items: [], total: 0 });

      await service.listEntries({
        diaryId: DIARY_ID,
        tags: ['tag-a', 'tag-b'],
        limit: 5,
      });

      expect(repo.list).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        tags: ['tag-a', 'tag-b'],
        excludeTags: undefined,
        entryTypes: undefined,
        limit: 5,
        offset: undefined,
      });
    });
  });

  describe('search', () => {
    it('passes tags filter to repository', async () => {
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue([]);

      await service.searchEntries(
        {
          diaryId: DIARY_ID,
          query: 'something',
          tags: ['accountable-commit'],
        },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(repo.search).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        query: 'something',
        embedding: MOCK_EMBEDDING,
        tags: ['accountable-commit'],
        limit: undefined,
        offset: undefined,
      });
    });

    it('passes tags without query', async () => {
      repo.search.mockResolvedValue([]);

      await service.searchEntries(
        {
          diaryId: DIARY_ID,
          tags: ['high-risk'],
        },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['high-risk'] }),
      );
    });

    it('passes excludeTags to repository', async () => {
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue([]);

      await service.searchEntries(
        {
          diaryId: DIARY_ID,
          query: 'something',
          excludeTags: ['incident'],
        },
        OWNER_ID,
        KetoNamespace.Agent,
      );

      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({
          excludeTags: ['incident'],
        }),
      );
    });
  });
});
