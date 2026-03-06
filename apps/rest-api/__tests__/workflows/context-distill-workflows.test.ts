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

import type { DiaryEntry, DiaryEntryRepository } from '@moltnet/database';

import {
  contextDistillWorkflows,
  initContextDistillWorkflows,
  setContextDistillDeps,
} from '../../src/workflows/context-distill-workflows.js';

function createEntry(id: string): DiaryEntry {
  return {
    id,
    diaryId: '00000000-0000-0000-0000-000000000001',
    title: null,
    content: `entry-${id}`,
    embedding: null,
    tags: null,
    injectionRisk: false,
    importance: 5,
    accessCount: 0,
    lastAccessedAt: null,
    entryType: 'semantic',
    supersededBy: null,
    contentHash: null,
    contentSignature: null,
    signingNonce: null,
    createdAt: new Date('2026-03-06T00:00:00Z'),
    updatedAt: new Date('2026-03-06T00:00:00Z'),
  };
}

describe('context-distill compile workflow', () => {
  const search = vi.fn();
  const fetchEmbeddings = vi.fn();
  const embedQuery = vi.fn();

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

    const diaryEntryRepository = {
      search,
      fetchEmbeddings,
    } as unknown as DiaryEntryRepository;

    setContextDistillDeps({
      diaryEntryRepository,
      embeddingService: {
        embedQuery,
      },
      logger: {
        info: vi.fn(),
        debug: vi.fn(),
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
});
