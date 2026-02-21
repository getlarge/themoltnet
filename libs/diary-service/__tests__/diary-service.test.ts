import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildEmbeddingText,
  createDiaryService,
  type DiaryService,
} from '../src/diary-service.js';
import type {
  AgentLookupRepository,
  DiaryEntry,
  DiaryEntryRepository,
  DiaryRepository,
  DiaryShareRepository,
  EmbeddingService,
  PermissionChecker,
  RelationshipWriter,
  TransactionRunner,
} from '../src/types.js';

const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
const DIARY_ID = '880e8400-e29b-41d4-a716-446655440004';

const MOCK_EMBEDDING = Array.from({ length: 384 }, (_, i) => i * 0.001);

function createMockEntry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: ENTRY_ID,
    diaryId: DIARY_ID,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    tags: null,
    injectionRisk: false,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    entryType: 'semantic' as const,
    supersededBy: null,
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
  };
}

function createMockPermissionChecker(): {
  [K in keyof PermissionChecker]: ReturnType<typeof vi.fn>;
} {
  return {
    canViewEntry: vi.fn().mockResolvedValue(true),
    canEditEntry: vi.fn().mockResolvedValue(true),
    canDeleteEntry: vi.fn().mockResolvedValue(true),
  };
}

function createMockRelationshipWriter(): {
  [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
} {
  return {
    grantOwnership: vi.fn().mockResolvedValue(undefined),
    registerAgent: vi.fn().mockResolvedValue(undefined),
    removeEntryRelations: vi.fn().mockResolvedValue(undefined),
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
    findOwnedById: vi.fn(),
    listByOwner: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

function createMockDiaryShareRepository(): {
  [K in keyof DiaryShareRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    findByDiaryAndAgent: vi.fn(),
    listByDiary: vi.fn(),
    listPendingForAgent: vi.fn(),
    updateStatus: vi.fn(),
  };
}

function createMockAgentLookupRepository(): {
  [K in keyof AgentLookupRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    findByFingerprint: vi.fn(),
  };
}

describe('DiaryService', () => {
  let service: DiaryService;
  let repo: ReturnType<typeof createMockDiaryEntryRepository>;
  let permissions: ReturnType<typeof createMockPermissionChecker>;
  let writer: ReturnType<typeof createMockRelationshipWriter>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;
  let transactionRunner: {
    runInTransaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = createMockDiaryEntryRepository();
    permissions = createMockPermissionChecker();
    writer = createMockRelationshipWriter();
    embeddings = createMockEmbeddingService();
    transactionRunner = {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    };

    service = createDiaryService({
      diaryRepository:
        createMockDiaryRepository() as unknown as DiaryRepository,
      diaryShareRepository:
        createMockDiaryShareRepository() as unknown as DiaryShareRepository,
      agentRepository:
        createMockAgentLookupRepository() as unknown as AgentLookupRepository,
      diaryEntryRepository: repo as unknown as DiaryEntryRepository,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipWriter: writer as unknown as RelationshipWriter,
      embeddingService: embeddings as unknown as EmbeddingService,
      transactionRunner: transactionRunner as unknown as TransactionRunner,
    });
  });

  describe('create', () => {
    it('creates entry with embedding inside transaction and calls relationshipWriter', async () => {
      const mockEntry = createMockEntry({ embedding: MOCK_EMBEDDING });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test diary entry content',
      });

      expect(result).toEqual(mockEntry);
      expect(transactionRunner.runInTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        { name: 'diary.create' },
      );
      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Test diary entry content',
      );
      expect(repo.create).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        content: 'Test diary entry content',
        title: undefined,
        tags: undefined,
        embedding: MOCK_EMBEDDING,
        injectionRisk: false,
        importance: undefined,
        entryType: undefined,
      });
      expect(writer.grantOwnership).toHaveBeenCalledWith(
        mockEntry.id,
        OWNER_ID,
      );
    });

    it('creates entry with all optional fields', async () => {
      const mockEntry = createMockEntry({
        title: 'My Entry',
        tags: ['test'],
        embedding: MOCK_EMBEDDING,
      });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test diary entry content',
        title: 'My Entry',
        tags: ['test'],
      });

      expect(result.title).toBe('My Entry');
      expect(result.tags).toEqual(['test']);
      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'My Entry\nTest diary entry content\ntag:test',
      );
    });

    it('creates entry without embedding if embedding service fails', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockRejectedValue(new Error('Embedding failed'));
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test content',
      });

      expect(result).toEqual(mockEntry);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('calls relationshipWriter INSIDE transaction', async () => {
      const executionOrder: string[] = [];
      const mockEntry = createMockEntry();

      transactionRunner.runInTransaction.mockImplementation(async (fn) => {
        executionOrder.push('transaction-start');
        const result = await fn();
        executionOrder.push('transaction-end');
        return result;
      });

      repo.create.mockResolvedValue(mockEntry);
      embeddings.embedPassage.mockResolvedValue([]);
      writer.grantOwnership.mockImplementation(async () => {
        executionOrder.push('writer-called');
      });

      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test',
      });

      expect(executionOrder).toEqual([
        'transaction-start',
        'writer-called',
        'transaction-end',
      ]);
    });

    it('creates entry with importance and entryType', async () => {
      const mockEntry = createMockEntry({
        importance: 8,
        entryType: 'identity',
        embedding: MOCK_EMBEDDING,
      });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'I am a creative agent',
        importance: 8,
        entryType: 'identity',
      });

      expect(result.importance).toBe(8);
      expect(result.entryType).toBe('identity');
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          importance: 8,
          entryType: 'identity',
        }),
      );
    });

    it('throws when grantOwnership fails inside transaction', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);
      writer.grantOwnership.mockRejectedValue(new Error('Keto unavailable'));

      await expect(
        service.create({
          requesterId: OWNER_ID,
          diaryId: DIARY_ID,
          content: 'Test',
        }),
      ).rejects.toThrow();
    });
  });

  describe('getById', () => {
    it('returns entry when Keto allows', async () => {
      const mockEntry = createMockEntry();
      repo.findById.mockResolvedValue(mockEntry);
      permissions.canViewEntry.mockResolvedValue(true);

      const result = await service.getById(ENTRY_ID, OWNER_ID);

      expect(result).toEqual(mockEntry);
      expect(repo.findById).toHaveBeenCalledWith(ENTRY_ID);
      expect(permissions.canViewEntry).toHaveBeenCalledWith(ENTRY_ID, OWNER_ID);
    });

    it('returns null when Keto denies', async () => {
      const mockEntry = createMockEntry();
      repo.findById.mockResolvedValue(mockEntry);
      permissions.canViewEntry.mockResolvedValue(false);

      const result = await service.getById(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBeNull();
      expect(permissions.canViewEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OTHER_AGENT_ID,
      );
    });
  });

  describe('list', () => {
    it('lists entries for a diary', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      repo.list.mockResolvedValue(entries);

      const result = await service.list({ diaryId: DIARY_ID });

      expect(result).toEqual(entries);
      expect(repo.list).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        limit: undefined,
        offset: undefined,
      });
    });

    it('passes filtering options through', async () => {
      repo.list.mockResolvedValue([]);

      await service.list({
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

    it('passes entryType filter to repository', async () => {
      repo.list.mockResolvedValue([]);

      await service.list({
        diaryId: DIARY_ID,
        entryType: 'reflection',
      });

      expect(repo.list).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          entryType: 'reflection',
        }),
      );
    });
  });

  describe('search', () => {
    it('searches with query and embedding', async () => {
      const entries = [createMockEntry()];
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue(entries);

      const result = await service.search({
        diaryId: DIARY_ID,
        query: 'find relevant entries',
      });

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

      await service.search({ diaryId: DIARY_ID });

      expect(embeddings.embedQuery).not.toHaveBeenCalled();
      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('passes weighted scoring params to repository', async () => {
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue([]);

      await service.search({
        diaryId: DIARY_ID,
        query: 'important memories',
        wRelevance: 1.0,
        wRecency: 0.3,
        wImportance: 0.2,
        entryTypes: ['identity', 'reflection'],
        excludeSuperseded: true,
      });

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

      await service.search({
        diaryId: DIARY_ID,
        query: 'test query',
      });

      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'test query',
          embedding: undefined,
        }),
      );
    });
  });

  describe('update', () => {
    it('checks Keto permission then updates entry', async () => {
      const existing = createMockEntry({ title: 'Old Title' });
      const updated = createMockEntry({ title: 'Updated Title' });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(updated);

      const result = await service.update(ENTRY_ID, OWNER_ID, {
        title: 'Updated Title',
      });

      expect(result).toEqual(updated);
      expect(permissions.canEditEntry).toHaveBeenCalledWith(ENTRY_ID, OWNER_ID);
      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Updated Title\nTest diary entry content',
      );
      expect(repo.update).toHaveBeenCalledWith(ENTRY_ID, {
        title: 'Updated Title',
        injectionRisk: false,
        embedding: MOCK_EMBEDDING,
      });
    });

    it('returns null when Keto denies edit', async () => {
      permissions.canEditEntry.mockResolvedValue(false);

      const result = await service.update(ENTRY_ID, OTHER_AGENT_ID, {
        title: 'Hacked',
      });

      expect(result).toBeNull();
      expect(repo.update).not.toHaveBeenCalled();
    });

    it('regenerates embedding when content is updated', async () => {
      const existing = createMockEntry();
      const updated = createMockEntry({
        content: 'New content',
        embedding: MOCK_EMBEDDING,
      });
      permissions.canEditEntry.mockResolvedValue(true);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.findById.mockResolvedValue(existing);
      repo.update.mockResolvedValue(updated);

      const result = await service.update(ENTRY_ID, OWNER_ID, {
        content: 'New content',
      });

      expect(result).toEqual(updated);
      // existing entry has title: null, so embedding text is just content
      expect(embeddings.embedPassage).toHaveBeenCalledWith('New content');
      expect(repo.update).toHaveBeenCalledWith(ENTRY_ID, {
        content: 'New content',
        embedding: MOCK_EMBEDDING,
        injectionRisk: false,
      });
    });

    it('forwards importance, entryType, and supersededBy to repository', async () => {
      permissions.canEditEntry.mockResolvedValue(true);
      repo.update.mockResolvedValue(
        createMockEntry({ importance: 9, entryType: 'soul' }),
      );

      await service.update(ENTRY_ID, OWNER_ID, {
        importance: 9,
        entryType: 'soul',
        supersededBy: 'some-entry-id',
      });

      expect(repo.update).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({
          importance: 9,
          entryType: 'soul',
          supersededBy: 'some-entry-id',
        }),
      );
    });
  });

  describe('delete', () => {
    it('checks Keto permission then deletes in transaction and calls relationshipWriter', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(true);

      const result = await service.delete(ENTRY_ID, OWNER_ID);

      expect(result).toBe(true);
      expect(permissions.canDeleteEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
      );
      expect(transactionRunner.runInTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        { name: 'diary.delete' },
      );
      expect(repo.delete).toHaveBeenCalledWith(ENTRY_ID);
      expect(writer.removeEntryRelations).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('returns false when Keto denies delete', async () => {
      permissions.canDeleteEntry.mockResolvedValue(false);

      const result = await service.delete(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBe(false);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(writer.removeEntryRelations).not.toHaveBeenCalled();
    });

    it('returns false when entry does not exist in DB', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(false);

      const result = await service.delete(ENTRY_ID, OWNER_ID);

      expect(result).toBe(false);
      expect(writer.removeEntryRelations).not.toHaveBeenCalled();
    });

    it('calls relationshipWriter INSIDE transaction', async () => {
      const executionOrder: string[] = [];

      transactionRunner.runInTransaction.mockImplementation(async (fn) => {
        executionOrder.push('transaction-start');
        const result = await fn();
        executionOrder.push('transaction-end');
        return result;
      });

      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(true);
      writer.removeEntryRelations.mockImplementation(async () => {
        executionOrder.push('writer-called');
      });

      await service.delete(ENTRY_ID, OWNER_ID);

      expect(executionOrder).toEqual([
        'transaction-start',
        'writer-called',
        'transaction-end',
      ]);
    });

    it('throws when removeEntryRelations fails inside transaction', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(true);
      writer.removeEntryRelations.mockRejectedValue(
        new Error('Keto unavailable'),
      );

      await expect(service.delete(ENTRY_ID, OWNER_ID)).rejects.toThrow();
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
          supersededBy: null,
        }),
        createMockEntry({
          id: 'old-entry',
          content: 'Outdated knowledge',
          supersededBy: 'active-entry',
        }),
      ];
      repo.getRecentForDigest.mockResolvedValue(entries);

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
  let permissions: ReturnType<typeof createMockPermissionChecker>;
  let writer: ReturnType<typeof createMockRelationshipWriter>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;
  let transactionRunner: {
    runInTransaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = createMockDiaryEntryRepository();
    permissions = createMockPermissionChecker();
    writer = createMockRelationshipWriter();
    embeddings = createMockEmbeddingService();
    transactionRunner = {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    };

    service = createDiaryService({
      diaryRepository:
        createMockDiaryRepository() as unknown as DiaryRepository,
      diaryShareRepository:
        createMockDiaryShareRepository() as unknown as DiaryShareRepository,
      agentRepository:
        createMockAgentLookupRepository() as unknown as AgentLookupRepository,
      diaryEntryRepository: repo as unknown as DiaryEntryRepository,
      permissionChecker: permissions as unknown as PermissionChecker,
      relationshipWriter: writer as unknown as RelationshipWriter,
      embeddingService: embeddings as unknown as EmbeddingService,
      transactionRunner: transactionRunner as unknown as TransactionRunner,
    });
  });

  describe('list', () => {
    it('passes tags filter to repository', async () => {
      repo.list.mockResolvedValue([]);

      await service.list({
        diaryId: DIARY_ID,
        tags: ['accountable-commit'],
      });

      expect(repo.list).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        tags: ['accountable-commit'],
        limit: undefined,
        offset: undefined,
      });
    });

    it('passes tags with other filters', async () => {
      repo.list.mockResolvedValue([]);

      await service.list({
        diaryId: DIARY_ID,
        tags: ['tag-a', 'tag-b'],
        limit: 5,
      });

      expect(repo.list).toHaveBeenCalledWith({
        diaryId: DIARY_ID,
        tags: ['tag-a', 'tag-b'],
        limit: 5,
        offset: undefined,
      });
    });
  });

  describe('search', () => {
    it('passes tags filter to repository', async () => {
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue([]);

      await service.search({
        diaryId: DIARY_ID,
        query: 'something',
        tags: ['accountable-commit'],
      });

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

      await service.search({
        diaryId: DIARY_ID,
        tags: ['high-risk'],
      });

      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({ tags: ['high-risk'] }),
      );
    });
  });

  describe('create — tags and title in embedding', () => {
    it('includes tags in embedding text', async () => {
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(createMockEntry({ tags: ['deploy'] }));

      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Deployed v2',
        tags: ['deploy'],
      });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Deployed v2\ntag:deploy',
      );
    });

    it('uses content only when no tags or title', async () => {
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(createMockEntry());

      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Plain entry',
      });

      expect(embeddings.embedPassage).toHaveBeenCalledWith('Plain entry');
    });

    it('includes title in embedding text', async () => {
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(
        createMockEntry({ title: 'Security Audit' }),
      );

      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Ran npm audit',
        title: 'Security Audit',
      });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Security Audit\nRan npm audit',
      );
    });

    it('includes title, content, and tags in embedding text', async () => {
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(
        createMockEntry({ title: 'Deploy Log', tags: ['deploy'] }),
      );

      await service.create({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Deployed v3',
        title: 'Deploy Log',
        tags: ['deploy'],
      });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Deploy Log\nDeployed v3\ntag:deploy',
      );
    });
  });

  describe('update — tags and title in embedding', () => {
    it('regenerates embedding when tags change', async () => {
      const existing = createMockEntry({
        content: 'Original',
        tags: ['old-tag'],
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(createMockEntry({ tags: ['new-tag'] }));

      await service.update(ENTRY_ID, OWNER_ID, { tags: ['new-tag'] });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Original\ntag:new-tag',
      );
    });

    it('uses new content and new tags together for embedding', async () => {
      const existing = createMockEntry();
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(createMockEntry());

      await service.update(ENTRY_ID, OWNER_ID, {
        content: 'New content',
        tags: ['alpha', 'beta'],
      });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'New content\ntag:alpha\ntag:beta',
      );
    });

    it('regenerates embedding when title changes', async () => {
      const existing = createMockEntry({
        content: 'Body text',
        title: 'Old Title',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(createMockEntry({ title: 'New Title' }));

      await service.update(ENTRY_ID, OWNER_ID, { title: 'New Title' });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'New Title\nBody text',
      );
    });

    it('includes existing title in embedding when only content changes', async () => {
      const existing = createMockEntry({
        content: 'Old body',
        title: 'Kept Title',
      });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(createMockEntry());

      await service.update(ENTRY_ID, OWNER_ID, { content: 'New body' });

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Kept Title\nNew body',
      );
    });
  });
});
