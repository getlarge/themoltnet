import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DiaryEntry,
  DiaryRepository,
  EmbeddingService,
  PermissionChecker,
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
const OTHER_AGENT_ID = '660e8400-e29b-41d4-a716-446655440001';
const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
const GENERATED_ID = '880e8400-e29b-41d4-a716-446655440003';

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
    injectionRisk: false,
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
    unshare: vi.fn(),
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

describe('Diary Workflows', () => {
  let repo: ReturnType<typeof createMockDiaryRepository>;
  let permissions: ReturnType<typeof createMockPermissionChecker>;
  let embeddings: ReturnType<typeof createMockEmbeddingService>;

  // We need to reset the workflow module state for each test
  // because initDiaryWorkflows is idempotent
  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset the module to force re-init
    vi.resetModules();

    repo = createMockDiaryRepository();
    permissions = createMockPermissionChecker();
    embeddings = createMockEmbeddingService();
    mockRunTransaction.mockImplementation(async (fn) => fn());

    // Dynamically import to get fresh module state
    const { setDiaryWorkflowDeps, initDiaryWorkflows } =
      await import('../src/workflows/diary-workflows.js');

    setDiaryWorkflowDeps({
      diaryRepository: repo as unknown as DiaryRepository,
      permissionChecker: permissions as unknown as PermissionChecker,
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
        ownerId: OWNER_ID,
        content: 'Test diary entry content',
      });

      expect(result).toEqual(mockEntry);
      expect(embeddings.embedPassage).toHaveBeenCalledWith(
        'Test diary entry content',
      );
      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          ownerId: OWNER_ID,
          content: 'Test diary entry content',
          visibility: 'private',
          embedding: MOCK_EMBEDDING,
          injectionRisk: false,
        }),
      );
      expect(permissions.grantOwnership).toHaveBeenCalledWith(
        mockEntry.id,
        OWNER_ID,
      );
    });

    it('creates entry without embedding if embedding service fails', async () => {
      const mockEntry = createMockEntry();
      embeddings.embedPassage.mockRejectedValue(new Error('Embedding failed'));
      repo.create.mockResolvedValue(mockEntry);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.createEntry({
        ownerId: OWNER_ID,
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
      permissions.grantOwnership.mockRejectedValue(
        new Error('Keto unavailable'),
      );
      repo.delete.mockResolvedValue(true);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await expect(
        diaryWorkflows.createEntry({
          ownerId: OWNER_ID,
          content: 'Test content',
        }),
      ).rejects.toThrow('Failed to grant ownership after entry creation');

      // Verify compensation: entry was deleted
      expect(repo.delete).toHaveBeenCalledWith(mockEntry.id);
    });
  });

  describe('diary.update', () => {
    it('regenerates embedding and scans injection when content changes', async () => {
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
      expect(embeddings.embedPassage).toHaveBeenCalledWith('New content');
      expect(repo.update).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({
          content: 'New content',
          embedding: MOCK_EMBEDDING,
          injectionRisk: false,
        }),
      );
    });

    it('does not regenerate embedding when only visibility changes', async () => {
      repo.update.mockResolvedValue(createMockEntry({ visibility: 'moltnet' }));

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await diaryWorkflows.updateEntry(ENTRY_ID, { visibility: 'moltnet' });

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
      expect(permissions.removeEntryRelations).toHaveBeenCalledWith(ENTRY_ID);
    });

    it('skips Keto cleanup when entry does not exist', async () => {
      repo.delete.mockResolvedValue(false);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.deleteEntry(ENTRY_ID);

      expect(result).toBe(false);
      expect(permissions.removeEntryRelations).not.toHaveBeenCalled();
    });
  });

  describe('diary.share', () => {
    it('creates share record and grants viewer permission', async () => {
      repo.share.mockResolvedValue(true);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.shareEntry(
        ENTRY_ID,
        OWNER_ID,
        OTHER_AGENT_ID,
      );

      expect(result).toBe(true);
      expect(repo.share).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        OTHER_AGENT_ID,
      );
      expect(permissions.grantViewer).toHaveBeenCalledWith(
        ENTRY_ID,
        OTHER_AGENT_ID,
      );
    });

    it('compensates by unsharing when grantViewer fails', async () => {
      repo.share.mockResolvedValue(true);
      permissions.grantViewer.mockRejectedValue(new Error('Keto unavailable'));
      repo.unshare.mockResolvedValue(true);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      await expect(
        diaryWorkflows.shareEntry(ENTRY_ID, OWNER_ID, OTHER_AGENT_ID),
      ).rejects.toThrow('Failed to grant viewer after share creation');

      // Verify compensation: share was removed
      expect(repo.unshare).toHaveBeenCalledWith(ENTRY_ID, OTHER_AGENT_ID);
    });

    it('skips Keto grant when share record was not created', async () => {
      repo.share.mockResolvedValue(false);

      const { diaryWorkflows } =
        await import('../src/workflows/diary-workflows.js');

      const result = await diaryWorkflows.shareEntry(
        ENTRY_ID,
        OWNER_ID,
        OTHER_AGENT_ID,
      );

      expect(result).toBe(false);
      expect(permissions.grantViewer).not.toHaveBeenCalled();
    });
  });
});
