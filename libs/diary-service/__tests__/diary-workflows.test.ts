import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DiaryEntry,
  DiaryEntryRepository,
  EmbeddingService,
  RelationshipWriter,
} from '../src/types.js';

// ── DBOS mock ──────────────────────────────────────────────────────
const { mockRegisterStep, mockRegisterWorkflow, mockRunTransaction } =
  vi.hoisted(() => {
    // registerStep returns a callable that just invokes the original fn
    const mockRegisterStep = vi.fn().mockImplementation((fn) => fn);
    // registerWorkflow returns a callable that just invokes the original fn
    const mockRegisterWorkflow = vi.fn().mockImplementation((fn) => fn);
    const mockRunTransaction = vi.fn().mockImplementation(async (fn) => fn());

    return { mockRegisterStep, mockRegisterWorkflow, mockRunTransaction };
  });

vi.mock('@moltnet/database', () => ({
  DBOS: {
    registerStep: mockRegisterStep,
    registerWorkflow: mockRegisterWorkflow,
  },
}));

const OWNER_ID = '550e8400-e29b-41d4-a716-446655440000';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
const GENERATED_ID = '880e8400-e29b-41d4-a716-446655440003';
const DIARY_ID = '990e8400-e29b-41d4-a716-446655440004';

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

describe('Diary Workflows', () => {
  let repo: ReturnType<typeof createMockDiaryEntryRepository>;
  let writer: ReturnType<typeof createMockRelationshipWriter>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;

  // We need to reset the workflow module state for each test
  // because initDiaryWorkflows is idempotent
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module to force re-init
    vi.resetModules();

    repo = createMockDiaryEntryRepository();
    writer = createMockRelationshipWriter();
    embeddings = createMockEmbeddingService();
    mockRunTransaction.mockImplementation(async (fn) => fn());

    // Dynamically import to get fresh module state
    const { setDiaryWorkflowDeps, initDiaryWorkflows } =
      await import('../src/workflows/diary-workflows.js');

    setDiaryWorkflowDeps({
      diaryEntryRepository: repo as unknown as DiaryEntryRepository,
      relationshipWriter: writer as unknown as RelationshipWriter,
      embeddingService: embeddings as unknown as EmbeddingService,
      dataSource: {
        runTransaction: mockRunTransaction,
      } as never,
    });

    initDiaryWorkflows();
  });

  describe('diary.create', () => {
    it('creates entry with embedding and grants ownership', async () => {
      const mockEntry = createMockEntry({ id: GENERATED_ID });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.createEntry({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test diary entry content',
      });

      expect(result).toEqual(mockEntry);
      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Test diary entry content',
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          diaryId: DIARY_ID,
          content: 'Test diary entry content',
          embedding: MOCK_EMBEDDING,
          injectionRisk: false,
        }),
      );
      expect(writer.grantOwnership).toHaveBeenCalledWith(
        mockEntry.id,
        OWNER_ID,
      );
    });

    it('includes title and tags in embedding text', async () => {
      const mockEntry = createMockEntry({
        id: GENERATED_ID,
        title: 'Deploy Log',
        tags: ['deploy'],
      });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.create.mockResolvedValue(mockEntry);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await diaryWorkflows.createEntry({
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

    it('creates entry without embedding if embedding service fails', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockRejectedValue(new Error('Embedding failed'));
      repo.create.mockResolvedValue(mockEntry);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.createEntry({
        requesterId: OWNER_ID,
        diaryId: DIARY_ID,
        content: 'Test content',
      });

      expect(result).toEqual(mockEntry);
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ embedding: undefined }),
      );
    });

    it('compensates by deleting entry when grantOwnership fails', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockResolvedValue([]);
      repo.create.mockResolvedValue(mockEntry);
      writer.grantOwnership.mockRejectedValue(new Error('Keto unavailable'));
      repo.delete.mockResolvedValue(true);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await expect(
        diaryWorkflows.createEntry({
          requesterId: OWNER_ID,
          diaryId: DIARY_ID,
          content: 'Test content',
        }),
      ).rejects.toThrow('Failed to grant ownership after entry creation');

      // Verify compensation: entry was deleted
      expect(repo.delete).toHaveBeenCalledWith(mockEntry.id);
    });
  });

  describe('diary.update', () => {
    it('regenerates embedding with existing title when only content changes', async () => {
      const updated = createMockEntry({
        content: 'New content',
        embedding: MOCK_EMBEDDING,
      });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(updated);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.updateEntry(
        ENTRY_ID,
        { content: 'New content' },
        'Old content',
        'Old title',
      );

      expect(result).toEqual(updated);
      // existingTitle is preserved in the embedding text
      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Old title\nNew content',
      );
      expect(repo.update).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({
          content: 'New content',
          embedding: MOCK_EMBEDDING,
          injectionRisk: false,
        }),
      );
    });

    it('regenerates embedding when only tags change', async () => {
      const updated = createMockEntry({ tags: ['new-tag'] });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(updated);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await diaryWorkflows.updateEntry(
        ENTRY_ID,
        { tags: ['new-tag'] },
        'Original content',
        null,
        ['old-tag'],
      );

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Original content\ntag:new-tag',
      );
    });

    it('regenerates embedding when only title changes', async () => {
      const updated = createMockEntry({ title: 'New Title' });
      embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
      repo.update.mockResolvedValue(updated);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await diaryWorkflows.updateEntry(
        ENTRY_ID,
        { title: 'New Title' },
        'Body text',
        'Old Title',
      );

      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'New Title\nBody text',
      );
    });

    it('does not regenerate embedding when only metadata changes', async () => {
      repo.update.mockResolvedValue(
        createMockEntry({ importance: 9, entryType: 'soul' }),
      );

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await diaryWorkflows.updateEntry(ENTRY_ID, {
        importance: 9,
        entryType: 'soul',
      });

      expect(embeddings.embedPassage).not.toHaveBeenCalled();
    });
  });

  describe('diary.delete', () => {
    it('deletes entry and removes Keto relations', async () => {
      repo.delete.mockResolvedValue(true);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.deleteEntry(ENTRY_ID);

      expect(result).toBe(true);
      expect(repo.delete).toHaveBeenCalledWith(ENTRY_ID);
      expect(writer.removeEntryRelations).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('skips Keto cleanup when entry does not exist', async () => {
      repo.delete.mockResolvedValue(false);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.deleteEntry(ENTRY_ID);

      expect(result).toBe(false);
      expect(writer.removeEntryRelations).not.toHaveBeenCalled();
    });
  });
});
