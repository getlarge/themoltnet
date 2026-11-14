import { computeContentCid } from '@moltnet/crypto-service';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DiaryEntry,
  DiaryEntryRepository,
  EmbeddingService,
  RelationshipWriter,
} from '../src/index.js';
import type { diaryWorkflows as WorkflowCollection } from '../src/workflows/diary-workflows.js';

// ── DBOS mock ──────────────────────────────────────────────────────
const {
  mockRegisterStep,
  mockRegisterWorkflow,
  mockRunTransaction,
  mockStartWorkflow,
  mockEnqueue,
} = vi.hoisted(() => {
  // registerStep returns a callable that just invokes the original fn
  const mockRegisterStep = vi.fn().mockImplementation((fn) => fn);
  // registerWorkflow returns a callable that just invokes the original fn
  const mockRegisterWorkflow = vi.fn().mockImplementation((fn) => fn);
  const mockRunTransaction = vi.fn().mockImplementation(async (fn) => fn());

  const mockStartWorkflow = vi.fn();
  const mockEnqueue = vi.fn();
  return {
    mockRegisterStep,
    mockRegisterWorkflow,
    mockRunTransaction,
    mockStartWorkflow,
    mockEnqueue,
  };
});

vi.mock('@moltnet/database', () => ({
  DBOS: {
    logger: { warn: vi.fn() },
    startWorkflow: mockStartWorkflow,
    registerStep: mockRegisterStep,
    registerWorkflow: mockRegisterWorkflow,
  },
}));

const ENTRY_ID = '770e8400-e29b-41d4-a716-446655440002';
const DIARY_ID = '990e8400-e29b-41d4-a716-446655440004';

const MOCK_EMBEDDING = Array.from({ length: 384 }, (_, i) => i * 0.001);

function createMockEntry(overrides: Partial<DiaryEntry> = {}): DiaryEntry {
  return {
    id: ENTRY_ID,
    diaryId: DIARY_ID,
    creatorAgentId: ENTRY_ID,
    creatorHumanId: null,
    title: null,
    content: 'Test diary entry content',
    embedding: null,
    tags: null,
    injectionRisk: false,
    injectionThreats: [],
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
    needsEmbedding: vi.fn(),
    saveEmbedding: vi.fn(),
    create: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    search: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    findByIds: vi.fn(),
    deleteMany: vi.fn(),
    fetchEmbeddings: vi.fn(),
    searchPublic: vi.fn(),
    listTags: vi.fn(),
    listPublic: vi.fn(),
    listPublicSince: vi.fn(),
    countSignedByDiary: vi.fn(),
    findPublicById: vi.fn(),
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
    removeEntryRelationsBatch: vi.fn().mockResolvedValue(undefined),
    grantDiaryTeam: vi.fn().mockResolvedValue(undefined),
    removeDiaryTeam: vi.fn().mockResolvedValue(undefined),
    removeDiaryRelations: vi.fn().mockResolvedValue(undefined),
    grantPackParent: vi.fn().mockResolvedValue(undefined),
    removePackRelations: vi.fn().mockResolvedValue(undefined),
    removePackRelationsBatch: vi.fn().mockResolvedValue(undefined),
    grantTeamOwners: vi.fn().mockResolvedValue(undefined),
    grantTeamManagers: vi.fn().mockResolvedValue(undefined),
    grantTeamExecutors: vi.fn().mockResolvedValue(undefined),
    grantTeamMembers: vi.fn().mockResolvedValue(undefined),
    removeTeamMemberRelation: vi.fn().mockResolvedValue(undefined),
    grantGroupParent: vi.fn().mockResolvedValue(undefined),
    grantGroupMember: vi.fn().mockResolvedValue(undefined),
    removeGroupMember: vi.fn().mockResolvedValue(undefined),
    removeGroupRelations: vi.fn().mockResolvedValue(undefined),
    grantDiaryWriters: vi.fn().mockResolvedValue(undefined),
    grantDiaryManagers: vi.fn().mockResolvedValue(undefined),
    revokeDiaryWriter: vi.fn().mockResolvedValue(undefined),
    revokeDiaryManager: vi.fn().mockResolvedValue(undefined),
    removeAgentRelations: vi.fn().mockResolvedValue(undefined),
    removeHumanRelations: vi.fn().mockResolvedValue(undefined),
    grantTaskOwnership: vi.fn().mockResolvedValue(undefined),
    grantTaskTeam: vi.fn().mockResolvedValue(undefined),
    grantTaskWriters: vi.fn().mockResolvedValue(undefined),
    grantTaskManagers: vi.fn().mockResolvedValue(undefined),
    revokeTaskWriter: vi.fn().mockResolvedValue(undefined),
    revokeTaskManager: vi.fn().mockResolvedValue(undefined),
    grantTaskClaimant: vi.fn().mockResolvedValue(undefined),
    removeTaskRelations: vi.fn().mockResolvedValue(undefined),
    removeTaskRelationsBatch: vi.fn().mockResolvedValue(undefined),
    removeTaskClaimant: vi.fn().mockResolvedValue(undefined),
    writeRuntimePolicyEdges: vi.fn().mockResolvedValue(undefined),
    removeRuntimePolicyRelations: vi.fn().mockResolvedValue(undefined),
    writeRuntimeProfilePolicyEdges: vi.fn().mockResolvedValue(undefined),
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
  let workflows: typeof WorkflowCollection;
  let enrich: (
    input: DiaryEntry,
    jobId: string,
    attempt?: number,
  ) => Promise<void>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    repo = createMockDiaryEntryRepository();
    writer = createMockRelationshipWriter();
    embeddings = createMockEmbeddingService();
    embeddings.embedPassage.mockResolvedValue(MOCK_EMBEDDING);
    repo.needsEmbedding.mockResolvedValue(true);
    repo.saveEmbedding.mockResolvedValue(true);
    mockRunTransaction.mockImplementation(async (fn) => fn());
    mockStartWorkflow.mockImplementation(() => mockEnqueue);
    mockEnqueue.mockResolvedValue({ getResult: vi.fn() });
    const module = await import('../src/workflows/diary-workflows.js');
    module.setDiaryWorkflowDeps({
      diaryEntryRepository: repo as unknown as DiaryEntryRepository,
      relationshipWriter: writer as unknown as RelationshipWriter,
      embeddingService: embeddings as unknown as EmbeddingService,
      transactionRunner: { runInTransaction: mockRunTransaction },
    });
    module.initDiaryWorkflows();
    workflows = module.diaryWorkflows;
    enrich = mockRegisterWorkflow.mock.calls.find(
      (call) => call[1].name === 'diary.embed',
    )![0];
  });

  it('returns a readable entry after durable handoff, without running inference', async () => {
    const entry = createMockEntry();
    repo.create.mockResolvedValue(entry);
    const result = await workflows.createEntry({
      diaryId: DIARY_ID,
      creator: { kind: 'agent', id: ENTRY_ID },
      content: entry.content,
      contentHash: computeContentCid('semantic', null, entry.content, null),
    });
    expect(result).toEqual(entry);
    expect(embeddings.embedPassage).not.toHaveBeenCalled();
    expect(writer.grantEntryParent).toHaveBeenCalledWith(entry.id, DIARY_ID);
    expect(mockStartWorkflow).toHaveBeenCalledWith(enrich, {
      workflowID: expect.stringMatching(/^diary-embedding:/),
      queueName: 'diary-embeddings',
      timeoutMS: null,
    });
    expect(mockEnqueue).toHaveBeenCalledWith(
      { id: entry.id, content: entry.content, title: null, tags: null },
      expect.any(String),
    );
    expect(writer.grantEntryParent.mock.invocationCallOrder[0]).toBeLessThan(
      mockStartWorkflow.mock.invocationCallOrder[0],
    );
  });

  it('does not acknowledge a failed handoff', async () => {
    repo.create.mockResolvedValue(createMockEntry());
    mockEnqueue.mockRejectedValue(new Error('enqueue failed'));
    await expect(
      workflows.createEntry({
        diaryId: DIARY_ID,
        creator: { kind: 'agent', id: ENTRY_ID },
        content: 'x',
        contentHash: 'cid',
      }),
    ).rejects.toThrow('enqueue failed');
  });

  it('compensates a failed Keto link without enqueuing enrichment', async () => {
    repo.create.mockResolvedValue(createMockEntry());
    writer.grantEntryParent.mockRejectedValue(new Error('Keto unavailable'));
    await expect(
      workflows.createEntry({
        diaryId: DIARY_ID,
        creator: { kind: 'agent', id: ENTRY_ID },
        content: 'x',
        contentHash: 'cid',
      }),
    ).rejects.toThrow('Failed to link entry');
    expect(repo.delete).toHaveBeenCalledWith(ENTRY_ID);
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it.each([{ content: 'new' }, { title: 'new' }, { tags: ['new'] }])(
    'invalidates the vector and schedules the persisted snapshot on edit %j',
    async (updates) => {
      const entry = createMockEntry({ ...updates });
      repo.update.mockResolvedValue(entry);
      await workflows.updateEntry(
        ENTRY_ID,
        updates,
        'stale content',
        'stale title',
        ['stale'],
      );
      expect(repo.update).toHaveBeenCalledWith(
        ENTRY_ID,
        expect.objectContaining({ ...updates, embedding: null }),
      );
      expect(mockEnqueue).toHaveBeenCalledWith(
        {
          id: entry.id,
          content: entry.content,
          title: entry.title,
          tags: entry.tags,
        },
        expect.any(String),
      );
      expect(embeddings.embedPassage).not.toHaveBeenCalled();
    },
  );

  it('leaves metadata-only edits out of the inference queue', async () => {
    repo.update.mockResolvedValue(createMockEntry());
    await workflows.updateEntry(ENTRY_ID, { importance: 9 });
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it('embeds title, body and tags in a background workflow and saves with CAS', async () => {
    const entry = createMockEntry({ title: 'Title', tags: ['tag'] });
    await enrich(entry, 'job');
    expect(embeddings.embedPassage).toHaveBeenCalledWith(
      'Title\n' + entry.content + '\ntag:tag',
    );
    expect(repo.saveEmbedding).toHaveBeenCalledWith(entry, MOCK_EMBEDDING);
  });

  it('skips inference for deleted, superseded, or already embedded inputs', async () => {
    repo.needsEmbedding.mockResolvedValue(false);
    await enrich(createMockEntry(), 'job');
    expect(embeddings.embedPassage).not.toHaveBeenCalled();
  });

  it('treats a lost CAS during inference as superseded work', async () => {
    repo.saveEmbedding.mockResolvedValue(false);
    await enrich(createMockEntry(), 'job');
    expect(mockStartWorkflow).not.toHaveBeenCalled();
  });

  it.each([new Error('model unavailable'), [], [NaN]])(
    'durably delays failed or invalid inference without occupying a queue slot: %j',
    async (failure) => {
      if (failure instanceof Error)
        embeddings.embedPassage.mockRejectedValue(failure);
      else embeddings.embedPassage.mockResolvedValue(failure);
      await enrich(createMockEntry(), 'job', 10);
      expect(repo.saveEmbedding).not.toHaveBeenCalled();
      expect(mockStartWorkflow).toHaveBeenCalledWith(enrich, {
        workflowID: expect.stringMatching(/^diary-embedding:/),
        queueName: 'diary-embeddings',
        timeoutMS: null,
        enqueueOptions: { delaySeconds: 300 },
      });
      expect(mockEnqueue).toHaveBeenCalledWith(createMockEntry(), 'job', 11);
    },
  );

  it.each(['check', 'persist'])(
    'durably retries database failures during %s',
    async (phase) => {
      const failing =
        phase === 'check' ? repo.needsEmbedding : repo.saveEmbedding;
      failing.mockRejectedValueOnce(new Error('temporary database failure'));
      await enrich(createMockEntry(), 'job');
      expect(mockStartWorkflow).toHaveBeenCalledWith(enrich, {
        workflowID: 'diary-embedding:job:1',
        queueName: 'diary-embeddings',
        timeoutMS: null,
        enqueueOptions: { delaySeconds: 5 },
      });
    },
  );

  it('deletes the row before removing Keto relations', async () => {
    repo.delete.mockResolvedValue(true);
    expect(await workflows.deleteEntry(ENTRY_ID)).toBe(true);
    expect(writer.removeEntryRelations).toHaveBeenCalledWith(ENTRY_ID);
  });
});
