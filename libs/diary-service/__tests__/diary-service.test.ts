import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDiaryService, type DiaryService } from '../src/diary-service.js';
import type {
  DiaryEntry,
  DiaryRepository,
  EmbeddingService,
  PermissionChecker,
  TransactionRunner,
} from '../src/types.js';

// ── DBOS mock (hoisted by vitest, applies to all tests) ──────────────
const { mockWorkflowFn, mockStartWorkflow } = vi.hoisted(() => {
  const mockHandle = { getResult: vi.fn().mockResolvedValue(undefined) };
  const mockWorkflowFn = vi.fn().mockResolvedValue(mockHandle);
  const mockStartWorkflow = vi.fn().mockReturnValue(mockWorkflowFn);
  return { mockWorkflowFn, mockStartWorkflow };
});

vi.mock('@moltnet/database', () => ({
  DBOS: {
    startWorkflow: mockStartWorkflow,
  },
  ketoWorkflows: {
    grantOwnership: { name: 'keto.grantOwnership' },
    removeEntryRelations: { name: 'keto.removeEntryRelations' },
    grantViewer: { name: 'keto.grantViewer' },
  },
}));

const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';

const MOCK_EMBEDDING = Array.from({ length: 384 }, (_, i) => i * 0.001);

function createMockEntry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: ENTRY_ID,
    ownerId: OWNER_ID,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    visibility: 'private',
    tags: null,
    createdAt: new Date('2026-01-30T10:00:00Z'),
    updatedAt: new Date('2026-01-30T10:00:00Z'),
    ...overrides,
  };
}

function createMockDiaryRepository(): {
  [K in keyof DiaryRepository]: ReturnType<typeof vi.fn>;
} {
  return {
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    share: vi.fn(),
    getSharedWithMe: vi.fn(),
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
    canShareEntry: vi.fn().mockResolvedValue(true),
    grantOwnership: vi.fn().mockResolvedValue(undefined),
    grantViewer: vi.fn().mockResolvedValue(undefined),
    revokeViewer: vi.fn().mockResolvedValue(undefined),
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

describe('DiaryService', () => {
  let service: DiaryService;
  let repo: ReturnType<typeof createMockDiaryRepository>;
  let permissions: ReturnType<typeof createMockPermissionChecker>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;
  let transactionRunner: {
    runInTransaction: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    repo = createMockDiaryRepository();
    permissions = createMockPermissionChecker();
    embeddings = createMockEmbeddingService();
    transactionRunner = {
      runInTransaction: vi.fn().mockImplementation(async (fn) => fn()),
    };

    mockStartWorkflow.mockClear();
    mockWorkflowFn.mockClear();
    mockStartWorkflow.mockReturnValue(mockWorkflowFn);

    service = createDiaryService({
      diaryRepository: repo as unknown as DiaryRepository,
      permissionChecker: permissions as unknown as PermissionChecker,
      embeddingService: embeddings as unknown as EmbeddingService,
      transactionRunner: transactionRunner as unknown as TransactionRunner,
    });
  });

  describe('create', () => {
    it('creates entry with embedding inside transaction and schedules Keto workflow', async () => {
      const mockEntry = createMockEntry({ embedding: MOCK_EMBEDDING });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        ownerId: OWNER_ID,
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
        ownerId: OWNER_ID,
        content: 'Test diary entry content',
        title: undefined,
        visibility: 'private',
        tags: undefined,
        embedding: MOCK_EMBEDDING,
      });
      expect(mockStartWorkflow).toHaveBeenCalledWith({
        name: 'keto.grantOwnership',
      });
      expect(mockWorkflowFn).toHaveBeenCalledWith(mockEntry.id, OWNER_ID);
      // Sync permissionChecker should NOT be called — DBOS handles this
      expect(permissions.grantOwnership).not.toHaveBeenCalled();
    });

    it('creates entry with all optional fields', async () => {
      const mockEntry = createMockEntry({
        title: 'My Entry',
        visibility: 'moltnet',
        tags: ['test'],
        embedding: MOCK_EMBEDDING,
      });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        ownerId: OWNER_ID,
        content: 'Test diary entry content',
        title: 'My Entry',
        visibility: 'moltnet',
        tags: ['test'],
      });

      expect(result.title).toBe('My Entry');
      expect(result.visibility).toBe('moltnet');
      expect(result.tags).toEqual(['test']);
    });

    it('creates entry without embedding if embedding service fails', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockRejectedValue(new Error('Embedding failed'));
      repo.create.mockResolvedValue(mockEntry);

      const result = await service.create({
        ownerId: OWNER_ID,
        content: 'Test content',
      });

      expect(result).toEqual(mockEntry);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('defaults visibility to private', async () => {
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(createMockEntry());

      await service.create({
        ownerId: OWNER_ID,
        content: 'Test content',
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ visibility: 'private' }),
      );
    });

    it('starts Keto workflow AFTER transaction commits', async () => {
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
      const mockHandle = {
        getResult: vi.fn().mockImplementation(async () => {
          executionOrder.push('workflow-completed');
        }),
      };
      mockStartWorkflow.mockReturnValue(async () => {
        executionOrder.push('workflow-started');
        return mockHandle;
      });

      await service.create({ ownerId: OWNER_ID, content: 'Test' });

      // Workflow starts AFTER transaction, then getResult() awaited
      expect(executionOrder).toEqual([
        'transaction-start',
        'transaction-end',
        'workflow-started',
        'workflow-completed',
      ]);
    });

    it('propagates startWorkflow error after transaction committed', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);
      mockStartWorkflow.mockReturnValue(async () => {
        throw new Error('Workflow failed');
      });

      await expect(
        service.create({ ownerId: OWNER_ID, content: 'Test' }),
      ).rejects.toThrow('Workflow failed');
    });

    it('logs getResult() error but still returns entry', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);
      const mockHandle = {
        getResult: vi.fn().mockRejectedValue(new Error('Keto unavailable')),
      };
      mockStartWorkflow.mockReturnValue(vi.fn().mockResolvedValue(mockHandle));

      const result = await service.create({
        ownerId: OWNER_ID,
        content: 'Test',
      });

      expect(result).toEqual(mockEntry);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Keto grantOwnership workflow failed after commit',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getById', () => {
    it('returns entry when Keto allows viewing private entry', async () => {
      const mockEntry = createMockEntry();
      repo.findById.mockResolvedValue(mockEntry);
      permissions.canViewEntry.mockResolvedValue(true);

      const result = await service.getById(ENTRY_ID, OWNER_ID);

      expect(result).toEqual(mockEntry);
      expect(repo.findById).toHaveBeenCalledWith(ENTRY_ID);
      expect(permissions.canViewEntry).toHaveBeenCalledWith(ENTRY_ID, OWNER_ID);
    });

    it('returns null when not found', async () => {
      repo.findById.mockResolvedValue(null);

      const result = await service.getById(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBeNull();
      expect(permissions.canViewEntry).not.toHaveBeenCalled();
    });

    it('returns null when Keto denies viewing private entry', async () => {
      const mockEntry = createMockEntry({ visibility: 'private' });
      repo.findById.mockResolvedValue(mockEntry);
      permissions.canViewEntry.mockResolvedValue(false);

      const result = await service.getById(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBeNull();
      expect(permissions.canViewEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OTHER_AGENT_ID,
      );
    });

    it('skips Keto check for public entries', async () => {
      const mockEntry = createMockEntry({ visibility: 'public' });
      repo.findById.mockResolvedValue(mockEntry);

      const result = await service.getById(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toEqual(mockEntry);
      expect(permissions.canViewEntry).not.toHaveBeenCalled();
    });

    it('skips Keto check for moltnet entries', async () => {
      const mockEntry = createMockEntry({ visibility: 'moltnet' });
      repo.findById.mockResolvedValue(mockEntry);

      const result = await service.getById(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toEqual(mockEntry);
      expect(permissions.canViewEntry).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('lists entries for an owner', async () => {
      const entries = [createMockEntry(), createMockEntry({ id: 'other-id' })];
      repo.list.mockResolvedValue(entries);

      const result = await service.list({ ownerId: OWNER_ID });

      expect(result).toEqual(entries);
      expect(repo.list).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        visibility: undefined,
        limit: undefined,
        offset: undefined,
      });
    });

    it('passes filtering options through', async () => {
      repo.list.mockResolvedValue([]);

      await service.list({
        ownerId: OWNER_ID,
        visibility: ['public', 'moltnet'],
        limit: 10,
        offset: 5,
      });

      expect(repo.list).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        visibility: ['public', 'moltnet'],
        limit: 10,
        offset: 5,
      });
    });
  });

  describe('search', () => {
    it('searches with query and embedding', async () => {
      const entries = [createMockEntry()];
      embeddings.embedQuery.mockResolvedValue(MOCK_EMBEDDING);
      repo.search.mockResolvedValue(entries);

      const result = await service.search({
        ownerId: OWNER_ID,
        query: 'find relevant entries',
      });

      expect(result).toEqual(entries);
      expect(embeddings.embedQuery).toHaveBeenCalledWith(
        'find relevant entries',
      );
      expect(repo.search).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        query: 'find relevant entries',
        embedding: MOCK_EMBEDDING,
        visibility: undefined,
        limit: undefined,
        offset: undefined,
      });
    });

    it('searches without embedding if no query provided', async () => {
      repo.search.mockResolvedValue([]);

      await service.search({ ownerId: OWNER_ID });

      expect(embeddings.embedQuery).not.toHaveBeenCalled();
      expect(repo.search).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('searches without embedding if embedding service fails', async () => {
      embeddings.embedQuery.mockRejectedValue(new Error('Embed failed'));
      repo.search.mockResolvedValue([]);

      await service.search({
        ownerId: OWNER_ID,
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
      const updated = createMockEntry({ title: 'Updated Title' });
      permissions.canEditEntry.mockResolvedValue(true);
      repo.update.mockResolvedValue(updated);

      const result = await service.update(ENTRY_ID, OWNER_ID, {
        title: 'Updated Title',
      });

      expect(result).toEqual(updated);
      expect(permissions.canEditEntry).toHaveBeenCalledWith(ENTRY_ID, OWNER_ID);
      expect(repo.update).toHaveBeenCalledWith(ENTRY_ID, {
        title: 'Updated Title',
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
      const updated = createMockEntry({
        content: 'New content',
        embedding: MOCK_EMBEDDING,
      });
      permissions.canEditEntry.mockResolvedValue(true);
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(updated);

      const result = await service.update(ENTRY_ID, OWNER_ID, {
        content: 'New content',
      });

      expect(result).toEqual(updated);
      expect(embeddings.embedPassage).toHaveBeenCalledWith('New content');
      expect(repo.update).toHaveBeenCalledWith(ENTRY_ID, {
        content: 'New content',
        embedding: MOCK_EMBEDDING,
      });
    });

    it('does not regenerate embedding when only title is updated', async () => {
      permissions.canEditEntry.mockResolvedValue(true);
      repo.update.mockResolvedValue(createMockEntry({ title: 'New Title' }));

      await service.update(ENTRY_ID, OWNER_ID, { title: 'New Title' });

      expect(embeddings.embedPassage).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('checks Keto permission then deletes in transaction with durable workflow', async () => {
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
      expect(mockStartWorkflow).toHaveBeenCalledWith({
        name: 'keto.removeEntryRelations',
      });
      expect(mockWorkflowFn).toHaveBeenCalledWith(ENTRY_ID);
      // Sync permissionChecker should NOT be called — DBOS handles this
      expect(permissions.removeEntryRelations).not.toHaveBeenCalled();
    });

    it('returns false when Keto denies delete', async () => {
      permissions.canDeleteEntry.mockResolvedValue(false);

      const result = await service.delete(ENTRY_ID, OTHER_AGENT_ID);

      expect(result).toBe(false);
      expect(repo.delete).not.toHaveBeenCalled();
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('returns false when entry does not exist in DB', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(false);

      const result = await service.delete(ENTRY_ID, OWNER_ID);

      expect(result).toBe(false);
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('starts Keto workflow AFTER transaction commits', async () => {
      const executionOrder: string[] = [];

      transactionRunner.runInTransaction.mockImplementation(async (fn) => {
        executionOrder.push('transaction-start');
        const result = await fn();
        executionOrder.push('transaction-end');
        return result;
      });

      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(true);
      const mockHandle = {
        getResult: vi.fn().mockImplementation(async () => {
          executionOrder.push('workflow-completed');
        }),
      };
      mockStartWorkflow.mockReturnValue(async () => {
        executionOrder.push('workflow-started');
        return mockHandle;
      });

      await service.delete(ENTRY_ID, OWNER_ID);

      expect(executionOrder).toEqual([
        'transaction-start',
        'transaction-end',
        'workflow-started',
        'workflow-completed',
      ]);
    });

    it('propagates startWorkflow error after transaction committed', async () => {
      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(true);
      mockStartWorkflow.mockReturnValue(async () => {
        throw new Error('Workflow failed');
      });

      await expect(service.delete(ENTRY_ID, OWNER_ID)).rejects.toThrow(
        'Workflow failed',
      );
    });

    it('logs getResult() error but still returns true', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      permissions.canDeleteEntry.mockResolvedValue(true);
      repo.delete.mockResolvedValue(true);
      const mockHandle = {
        getResult: vi.fn().mockRejectedValue(new Error('Keto unavailable')),
      };
      mockStartWorkflow.mockReturnValue(vi.fn().mockResolvedValue(mockHandle));

      const result = await service.delete(ENTRY_ID, OWNER_ID);

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Keto removeEntryRelations workflow failed after commit',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('share', () => {
    it('shares entry in transaction and schedules viewer workflow', async () => {
      permissions.canShareEntry.mockResolvedValue(true);
      repo.share.mockResolvedValue(true);

      const result = await service.share(ENTRY_ID, OWNER_ID, OTHER_AGENT_ID);

      expect(result).toBe(true);
      expect(permissions.canShareEntry).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
      );
      expect(transactionRunner.runInTransaction).toHaveBeenCalledWith(
        expect.any(Function),
        { name: 'diary.share' },
      );
      expect(repo.share).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        OTHER_AGENT_ID,
      );
      expect(mockStartWorkflow).toHaveBeenCalledWith({
        name: 'keto.grantViewer',
      });
      expect(mockWorkflowFn).toHaveBeenCalledWith(ENTRY_ID, OTHER_AGENT_ID);
      // Sync permissionChecker should NOT be called — DBOS handles this
      expect(permissions.grantViewer).not.toHaveBeenCalled();
    });

    it('returns false when agent lacks share permission', async () => {
      permissions.canShareEntry.mockResolvedValue(false);

      const result = await service.share(ENTRY_ID, OTHER_AGENT_ID, OWNER_ID);

      expect(result).toBe(false);
      expect(repo.share).not.toHaveBeenCalled();
    });

    it('returns false when repo share fails', async () => {
      permissions.canShareEntry.mockResolvedValue(true);
      repo.share.mockResolvedValue(false);

      const result = await service.share(ENTRY_ID, OWNER_ID, OTHER_AGENT_ID);

      expect(result).toBe(false);
      expect(mockStartWorkflow).not.toHaveBeenCalled();
    });

    it('starts Keto workflow AFTER transaction commits', async () => {
      const executionOrder: string[] = [];

      transactionRunner.runInTransaction.mockImplementation(async (fn) => {
        executionOrder.push('transaction-start');
        const result = await fn();
        executionOrder.push('transaction-end');
        return result;
      });

      permissions.canShareEntry.mockResolvedValue(true);
      repo.share.mockResolvedValue(true);
      const mockHandle = {
        getResult: vi.fn().mockImplementation(async () => {
          executionOrder.push('workflow-completed');
        }),
      };
      mockStartWorkflow.mockReturnValue(async () => {
        executionOrder.push('workflow-started');
        return mockHandle;
      });

      await service.share(ENTRY_ID, OWNER_ID, OTHER_AGENT_ID);

      expect(executionOrder).toEqual([
        'transaction-start',
        'transaction-end',
        'workflow-started',
        'workflow-completed',
      ]);
    });

    it('propagates startWorkflow error after transaction committed', async () => {
      permissions.canShareEntry.mockResolvedValue(true);
      repo.share.mockResolvedValue(true);
      mockStartWorkflow.mockReturnValue(async () => {
        throw new Error('Workflow failed');
      });

      await expect(
        service.share(ENTRY_ID, OWNER_ID, OTHER_AGENT_ID),
      ).rejects.toThrow('Workflow failed');
    });

    it('logs getResult() error but still returns true', async () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      permissions.canShareEntry.mockResolvedValue(true);
      repo.share.mockResolvedValue(true);
      const mockHandle = {
        getResult: vi.fn().mockRejectedValue(new Error('Keto unavailable')),
      };
      mockStartWorkflow.mockReturnValue(vi.fn().mockResolvedValue(mockHandle));

      const result = await service.share(ENTRY_ID, OWNER_ID, OTHER_AGENT_ID);

      expect(result).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Keto grantViewer workflow failed after commit',
        expect.any(Error),
      );
      consoleSpy.mockRestore();
    });
  });

  describe('getSharedWithMe', () => {
    it('returns entries shared with agent', async () => {
      const entries = [createMockEntry({ ownerId: OTHER_AGENT_ID })];
      repo.getSharedWithMe.mockResolvedValue(entries);

      const result = await service.getSharedWithMe(OWNER_ID);

      expect(result).toEqual(entries);
      expect(repo.getSharedWithMe).toHaveBeenCalledWith(OWNER_ID, undefined);
    });

    it('passes limit parameter', async () => {
      repo.getSharedWithMe.mockResolvedValue([]);

      await service.getSharedWithMe(OWNER_ID, 5);

      expect(repo.getSharedWithMe).toHaveBeenCalledWith(OWNER_ID, 5);
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

      const result = await service.reflect({ ownerId: OWNER_ID });

      expect(result.entries).toHaveLength(2);
      expect(result.totalEntries).toBe(2);
      expect(result.periodDays).toBe(7);
      expect(result.generatedAt).toBeDefined();
      expect(result.entries[0].content).toBe('I learned about OAuth2');
    });

    it('uses custom days and limit', async () => {
      repo.getRecentForDigest.mockResolvedValue([]);

      await service.reflect({
        ownerId: OWNER_ID,
        days: 30,
        maxEntries: 100,
      });

      expect(repo.getRecentForDigest).toHaveBeenCalledWith(OWNER_ID, 30, 100);
    });

    it('returns empty digest when no entries', async () => {
      repo.getRecentForDigest.mockResolvedValue([]);

      const result = await service.reflect({ ownerId: OWNER_ID });

      expect(result.entries).toHaveLength(0);
      expect(result.totalEntries).toBe(0);
    });
  });
});
