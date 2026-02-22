import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock diary workflows before service import so the service uses the mock
vi.mock('../src/workflows/diary-workflows.js', () => ({
  diaryWorkflows: {
    createEntry: vi.fn(),
    updateEntry: vi.fn(),
    deleteEntry: vi.fn(),
  },
}));

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
    canReadDiary: vi.fn().mockResolvedValue(true),
    canWriteDiary: vi.fn().mockResolvedValue(true),
    canManageDiary: vi.fn().mockResolvedValue(true),
  };
}

function createMockRelationshipWriter(): {
  [K in keyof RelationshipWriter]: ReturnType<typeof vi.fn>;
} {
  return {
    grantOwnership: vi.fn().mockResolvedValue(undefined),
    registerAgent: vi.fn().mockResolvedValue(undefined),
    removeEntryRelations: vi.fn().mockResolvedValue(undefined),
    grantDiaryOwner: vi.fn().mockResolvedValue(undefined),
    grantDiaryWriter: vi.fn().mockResolvedValue(undefined),
    grantDiaryReader: vi.fn().mockResolvedValue(undefined),
    removeDiaryRelations: vi.fn().mockResolvedValue(undefined),
    removeDiaryRelationForAgent: vi.fn().mockResolvedValue(undefined),
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
    vi.mocked(diaryWorkflows.createEntry).mockReset();
    vi.mocked(diaryWorkflows.updateEntry).mockReset();
    vi.mocked(diaryWorkflows.deleteEntry).mockReset();

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
    it('delegates to diaryWorkflows.createEntry with the full input', async () => {
      const mockEntry = createMockEntry();
      vi.mocked(diaryWorkflows.createEntry).mockResolvedValue(mockEntry);

      const input = {
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test diary entry content',
        title: 'My Entry',
        tags: ['test'],
        importance: 8,
        entryType: 'identity' as const,
      };
      const result = await service.create(input);

      expect(result).toEqual(mockEntry);
      expect(diaryWorkflows.createEntry).toHaveBeenCalledWith(input);
    });

    it('propagates errors from the workflow', async () => {
      vi.mocked(diaryWorkflows.createEntry).mockRejectedValue(
        new Error('Failed to grant ownership after entry creation'),
      );

      await expect(
        service.create({
          requesterId: OWNER_ID,
          diaryId: DIARY_ID,
          content: 'Test',
        }),
      ).rejects.toThrow('Failed to grant ownership after entry creation');
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
    it('returns null when Keto denies edit', async () => {
      permissions.canEditEntry.mockResolvedValue(false);

      const result = await service.update(ENTRY_ID, OTHER_AGENT_ID, {
        title: 'Hacked',
      });

      expect(result).toBeNull();
      expect(diaryWorkflows.updateEntry).not.toHaveBeenCalled();
    });

    it('checks permission then delegates to diaryWorkflows.updateEntry', async () => {
      const existing = createMockEntry({ title: 'Old Title' });
      const updated = createMockEntry({ title: 'Updated Title' });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.findById.mockResolvedValue(existing);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue(updated);

      const result = await service.update(ENTRY_ID, OWNER_ID, {
        title: 'Updated Title',
      });

      expect(result).toEqual(updated);
      expect(permissions.canEditEntry).toHaveBeenCalledWith(ENTRY_ID, OWNER_ID);
      expect(diaryWorkflows.updateEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        { title: 'Updated Title' },
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

      await service.update(ENTRY_ID, OWNER_ID, { content: 'New content' });
      expect(repo.findById).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('does not fetch existing entry when only metadata changes', async () => {
      permissions.canEditEntry.mockResolvedValue(true);
      vi.mocked(diaryWorkflows.updateEntry).mockResolvedValue(
        createMockEntry({ importance: 9 }),
      );

      await service.update(ENTRY_ID, OWNER_ID, {
        importance: 9,
        entryType: 'soul',
        supersededBy: 'some-entry-id',
      });

      expect(repo.findById).not.toHaveBeenCalled();
      expect(diaryWorkflows.updateEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        { importance: 9, entryType: 'soul', supersededBy: 'some-entry-id' },
        undefined,
        undefined,
        undefined,
      );
    });
  });

  describe('delete', () => {
    it('returns false when Keto denies delete', async () => {
      permissions.canDeleteEntry.mockResolvedValue(false);

      const result = await service.delete(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBe(false);
      expect(diaryWorkflows.deleteEntry).not.toHaveBeenCalled();
    });

    it('checks permission then delegates to diaryWorkflows.deleteEntry', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      vi.mocked(diaryWorkflows.deleteEntry).mockResolvedValue(true);

      const result = await service.delete(ENTRY_ID, OWNER_ID);

      expect(result).toBe(true);
      expect(permissions.canDeleteEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
      );
      expect(diaryWorkflows.deleteEntry).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('returns false when workflow reports entry not found', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      vi.mocked(diaryWorkflows.deleteEntry).mockResolvedValue(false);

      const result = await service.delete(ENTRY_ID, OWNER_ID);

      expect(result).toBe(false);
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
});
