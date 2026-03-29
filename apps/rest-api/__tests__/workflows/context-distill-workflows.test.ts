import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRegisterStep, mockRegisterWorkflow, mockLogger } = vi.hoisted(
  () => {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mockRegisterStep = vi.fn((fn: Function) => fn);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
    const mockRegisterWorkflow = vi.fn((fn: Function) => fn);
    const mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    return { mockRegisterStep, mockRegisterWorkflow, mockLogger };
  },
);

vi.mock('@moltnet/database', async (importOriginal) => {
  const original = (await importOriginal()) as Record<string, unknown>;
  return {
    ...original,
    DBOS: {
      registerStep: mockRegisterStep,
      registerWorkflow: mockRegisterWorkflow,
      logger: mockLogger,
      workflowID: 'wf-test-id',
    },
  };
});

import { computeContentCid } from '@moltnet/crypto-service';
import type {
  ContextPackRepository,
  DiaryEntry,
  DiaryEntryRepository,
  EntryRelationRepository,
} from '@moltnet/database';

import {
  contextDistillWorkflows,
  initContextDistillWorkflows,
  setContextDistillDeps,
} from '../../src/workflows/context-distill-workflows.js';

function createEntry(id: string, tags: string[] | null = null): DiaryEntry {
  const content = `entry-${id}`;
  return {
    id,
    diaryId: '00000000-0000-0000-0000-000000000001',
    title: null,
    content,
    embedding: null,
    tags,
    injectionRisk: false,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    entryType: 'semantic',
    contentHash: computeContentCid('semantic', null, content, tags),
    contentSignature: null,
    signingNonce: null,
    createdBy: '00000000-0000-0000-0000-000000000002',
    createdAt: new Date('2026-03-06T00:00:00Z'),
    updatedAt: new Date('2026-03-06T00:00:00Z'),
  };
}

describe('context-distill compile workflow', () => {
  const search = vi.fn();
  const fetchEmbeddings = vi.fn();
  const embedQuery = vi.fn();
  const createRelation = vi.fn();
  const createRelations = vi.fn();

  beforeAll(() => {
    initContextDistillWorkflows();
  });

  beforeEach(() => {
    vi.clearAllMocks();

    search.mockResolvedValue([createEntry('entry-1')]);
    fetchEmbeddings.mockResolvedValue([
      { id: 'entry-1', embedding: [0.1, 0.2, 0.3] },
    ]);
    embedQuery.mockResolvedValue([0.3, 0.2, 0.1]);
    createRelations.mockResolvedValue([]);

    const diaryEntryRepository = {
      search,
      fetchEmbeddings,
    } as unknown as DiaryEntryRepository;

    const contextPackRepository = {
      findByCid: vi.fn().mockResolvedValue(null),
      createPack: vi.fn().mockResolvedValue({
        id: 'pack-001',
        diaryId: '00000000-0000-0000-0000-000000000001',
        packCid: 'bafytest',
        packCodec: 'dag-cbor',
        packType: 'compile',
        params: {},
        payload: {},
        createdBy: '00000000-0000-0000-0000-000000000002',
        supersedesPackId: null,
        pinned: false,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        createdAt: new Date(),
      }),
      addEntries: vi.fn().mockResolvedValue([]),
    } as unknown as ContextPackRepository;

    setContextDistillDeps({
      diaryEntryRepository,
      contextPackRepository,
      entryRelationRepository: {
        create: createRelation,
        createMany: createRelations,
      } as unknown as EntryRelationRepository,
      dataSource: {
        runTransaction: vi
          .fn()
          .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      } as never,
      relationshipWriter: {
        grantPackParent: vi.fn().mockResolvedValue(undefined),
      } as never,
      embeddingService: {
        embedQuery,
      } as never,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });
  });

  it('passes taskPrompt query and embedding into search candidate retrieval', async () => {
    await contextDistillWorkflows.compile({
      diaryId: '00000000-0000-0000-0000-000000000001',
      identityId: '00000000-0000-0000-0000-000000000002',
      taskPrompt: 'architecture decisions',
      tokenBudget: 2000,
      wRecency: 0.2,
      wImportance: 0.3,
      includeTags: ['api'],
      limit: 50,
    });

    expect(embedQuery).toHaveBeenCalledWith('architecture decisions');
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        diaryId: '00000000-0000-0000-0000-000000000001',
        query: 'architecture decisions',
        embedding: [0.3, 0.2, 0.1],
        tags: ['api'],
        wRecency: 0.2,
        wImportance: 0.3,
        limit: 50,
        excludeSuperseded: true,
      }),
    );
  });

  it('omits query and embedding when taskPrompt is not provided', async () => {
    await contextDistillWorkflows.compile({
      diaryId: '00000000-0000-0000-0000-000000000001',
      identityId: '00000000-0000-0000-0000-000000000002',
      tokenBudget: 2000,
    });

    expect(embedQuery).not.toHaveBeenCalled();
    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        diaryId: '00000000-0000-0000-0000-000000000001',
        query: undefined,
        embedding: undefined,
      }),
    );
  });

  it('passes excludeTags to search before compilation', async () => {
    search.mockResolvedValue([createEntry('entry-keep', ['api'])]);
    fetchEmbeddings.mockResolvedValue([
      { id: 'entry-keep', embedding: [0.1, 0.2, 0.3] },
    ]);

    const result = await contextDistillWorkflows.compile({
      diaryId: '00000000-0000-0000-0000-000000000001',
      identityId: '00000000-0000-0000-0000-000000000002',
      tokenBudget: 2000,
      excludeTags: ['incident'],
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        excludeTags: ['incident'],
      }),
    );
    expect(fetchEmbeddings).toHaveBeenCalledWith(['entry-keep']);
    expect(
      result.compileResult.entries.some((entry) => entry.id === 'entry-keep'),
    ).toBe(true);
  });

  it('passes createdBefore and createdAfter to search', async () => {
    await contextDistillWorkflows.compile({
      diaryId: '00000000-0000-0000-0000-000000000001',
      identityId: '00000000-0000-0000-0000-000000000002',
      tokenBudget: 2000,
      createdBefore: '2026-03-01T00:00:00Z',
      createdAfter: '2025-12-01T00:00:00Z',
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        createdBefore: new Date('2026-03-01T00:00:00Z'),
        createdAfter: new Date('2025-12-01T00:00:00Z'),
      }),
    );
  });

  it('passes entryTypes to search', async () => {
    await contextDistillWorkflows.compile({
      diaryId: '00000000-0000-0000-0000-000000000001',
      identityId: '00000000-0000-0000-0000-000000000002',
      tokenBudget: 2000,
      entryTypes: ['semantic', 'procedural'],
    });

    expect(search).toHaveBeenCalledWith(
      expect.objectContaining({
        entryTypes: ['semantic', 'procedural'],
      }),
    );
  });

  it('persists proposed entry relations from consolidation clusters', async () => {
    const list = vi.fn().mockResolvedValue({
      items: [createEntry('entry-1'), createEntry('entry-2')],
      total: 2,
    });
    fetchEmbeddings.mockResolvedValue([
      { id: 'entry-1', embedding: [1, 0, 0] },
      { id: 'entry-2', embedding: [0.99, 0.01, 0] },
    ]);

    setContextDistillDeps({
      diaryEntryRepository: {
        list,
        fetchEmbeddings,
      } as unknown as DiaryEntryRepository,
      contextPackRepository: {
        createPack: vi.fn(),
        addEntries: vi.fn(),
      } as unknown as ContextPackRepository,
      entryRelationRepository: {
        create: createRelation,
        createMany: createRelations,
      } as unknown as EntryRelationRepository,
      dataSource: {
        runTransaction: vi
          .fn()
          .mockImplementation(async (fn: () => Promise<unknown>) => fn()),
      } as never,
      relationshipWriter: {
        grantPackParent: vi.fn().mockResolvedValue(undefined),
      } as never,
      embeddingService: {
        embedQuery,
      } as never,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
    });

    const result = await contextDistillWorkflows.consolidate({
      diaryId: '00000000-0000-0000-0000-000000000001',
      identityId: '00000000-0000-0000-0000-000000000002',
    });

    expect(result.clusters).toHaveLength(1);
    expect(createRelations).toHaveBeenCalledWith([
      expect.objectContaining({
        sourceId: 'entry-1',
        targetId: 'entry-2',
        relation: 'supports',
        workflowId: 'wf-test-id',
      }),
    ]);
  });
});
