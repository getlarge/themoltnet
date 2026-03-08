import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDiariesCompile,
  handleDiariesConsolidate,
  handleDiariesCreate,
  handleDiariesGet,
  handleDiariesList,
  handleEntryCreate,
  handleEntryDelete,
  handleEntryGet,
  handleEntryList,
  handleEntrySearch,
  handleEntryUpdate,
  handleEntryVerify,
  handleReflect,
} from '../src/diary-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  DIARY_ID,
  ENTRY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  compileDiary: vi.fn(),
  consolidateDiary: vi.fn(),
  createDiaryEntry: vi.fn(),
  getDiaryEntryById: vi.fn(),
  listDiaryEntries: vi.fn(),
  searchDiary: vi.fn(),
  updateDiaryEntryById: vi.fn(),
  deleteDiaryEntryById: vi.fn(),
  verifyDiaryEntryById: vi.fn(),
  reflectDiary: vi.fn(),
  listDiaries: vi.fn(),
  createDiary: vi.fn(),
  getDiary: vi.fn(),
}));

import {
  compileDiary,
  consolidateDiary,
  createDiary,
  createDiaryEntry,
  deleteDiaryEntryById,
  getDiary,
  getDiaryEntryById,
  listDiaries,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  updateDiaryEntryById,
  verifyDiaryEntryById,
} from '@moltnet/api-client';

describe('Diary tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('entries_create', () => {
    it('creates an entry with content only', async () => {
      const entry = {
        id: ENTRY_ID,
        content: 'My first memory',
        tags: [],
      };
      vi.mocked(createDiaryEntry).mockResolvedValue(sdkOk(entry, 201) as never);

      const result = await handleEntryCreate(
        { diary_id: DIARY_ID, content: 'My first memory' },
        deps,
        context,
      );

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID },
          body: { content: 'My first memory' },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('creates an entry with all optional fields', async () => {
      const entry = {
        id: ENTRY_ID,
        content: 'A tagged memory',
        tags: ['test', 'memory'],
      };
      vi.mocked(createDiaryEntry).mockResolvedValue(sdkOk(entry, 201) as never);

      const result = await handleEntryCreate(
        {
          diary_id: DIARY_ID,
          content: 'A tagged memory',
          title: 'Tagged',
          tags: ['test', 'memory'],
        },
        deps,
        context,
      );

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID },
          body: {
            content: 'A tagged memory',
            title: 'Tagged',
            tags: ['test', 'memory'],
          },
        }),
      );
      expect(result.isError).toBeUndefined();
    });

    it('passes title to API when provided', async () => {
      vi.mocked(createDiaryEntry).mockResolvedValue(
        sdkOk(
          { id: ENTRY_ID, content: 'test', title: 'My Title' },
          201,
        ) as never,
      );

      await handleEntryCreate(
        { diary_id: DIARY_ID, content: 'test', title: 'My Title' },
        deps,
        context,
      );

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({ title: 'My Title' }),
        }),
      );
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleEntryCreate(
        { diary_id: DIARY_ID, content: 'test' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('entries_get', () => {
    it('returns an entry by ID', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(getDiaryEntryById).mockResolvedValue(sdkOk(entry) as never);

      const result = await handleEntryGet(
        { diary_id: DIARY_ID, entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(getDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: ENTRY_ID },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('entry');
      expect(parsed.entry).toHaveProperty('id', ENTRY_ID);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(getDiaryEntryById).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleEntryGet(
        { diary_id: DIARY_ID, entry_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleEntryGet(
        { diary_id: DIARY_ID, entry_id: ENTRY_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('entries_list', () => {
    it('lists entries with defaults', async () => {
      const data = {
        items: [{ id: ENTRY_ID }],
        total: 1,
        limit: 20,
        offset: 0,
      };
      vi.mocked(listDiaryEntries).mockResolvedValue(sdkOk(data) as never);

      const result = await handleEntryList(
        { diary_id: DIARY_ID },
        deps,
        context,
      );

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID },
          query: { limit: 20, offset: 0 },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('items');
      expect(parsed.items).toHaveLength(1);
    });

    it('passes limit and offset', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [], total: 0, limit: 5, offset: 10 }) as never,
      );

      await handleEntryList(
        { diary_id: DIARY_ID, limit: 5, offset: 10 },
        deps,
        context,
      );

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID },
          query: { limit: 5, offset: 10 },
        }),
      );
    });

    it('passes tags filter as comma-separated query param', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [], total: 0, limit: 20, offset: 0 }) as never,
      );

      await handleEntryList(
        { diary_id: DIARY_ID, tags: ['accountable-commit', 'high-risk'] },
        deps,
        context,
      );

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID },
          query: {
            limit: 20,
            offset: 0,
            tags: 'accountable-commit,high-risk',
          },
        }),
      );
    });

    it('omits tags from query when not provided', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [], total: 0, limit: 20, offset: 0 }) as never,
      );

      await handleEntryList({ diary_id: DIARY_ID }, deps, context);

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryId: DIARY_ID },
          query: { limit: 20, offset: 0 },
        }),
      );
    });
  });

  describe('entries_search', () => {
    it('searches with a query', async () => {
      const data = { results: [{ id: ENTRY_ID }], total: 1 };
      vi.mocked(searchDiary).mockResolvedValue(sdkOk(data) as never);

      const result = await handleEntrySearch(
        { query: 'debugging OAuth' },
        deps,
        context,
      );

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'debugging OAuth', limit: 10 },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.results).toHaveLength(1);
    });

    it('passes limit parameter', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [], total: 0 }) as never,
      );

      await handleEntrySearch({ query: 'test', limit: 5 }, deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'test', limit: 5 },
        }),
      );
    });

    it('passes tags filter to API', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [], total: 0 }) as never,
      );

      await handleEntrySearch(
        { query: 'commits', tags: ['accountable-commit'] },
        deps,
        context,
      );

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            query: 'commits',
            limit: 10,
            tags: ['accountable-commit'],
          },
        }),
      );
    });

    it('omits tags from body when not provided', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [], total: 0 }) as never,
      );

      await handleEntrySearch({ query: 'test' }, deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'test', limit: 10 },
        }),
      );
    });

    it('passes exclude_tags filter to API', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [], total: 0 }) as never,
      );

      await handleEntrySearch(
        { query: 'commits', exclude_tags: ['incident'] },
        deps,
        context,
      );

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            query: 'commits',
            limit: 10,
            excludeTags: ['incident'],
          },
        }),
      );
    });
  });

  describe('entries_update', () => {
    it('updates an entry', async () => {
      const updated = { id: ENTRY_ID, tags: ['updated'] };
      vi.mocked(updateDiaryEntryById).mockResolvedValue(
        sdkOk(updated) as never,
      );

      const result = await handleEntryUpdate(
        { diary_id: DIARY_ID, entry_id: ENTRY_ID, tags: ['updated'] },
        deps,
        context,
      );

      expect(updateDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: ENTRY_ID },
          body: { tags: ['updated'] },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('returns error when entry not found', async () => {
      vi.mocked(updateDiaryEntryById).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleEntryUpdate(
        {
          diary_id: DIARY_ID,
          entry_id: 'nonexistent',
          content: 'new content',
        },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });

  describe('entries_delete', () => {
    it('deletes an entry', async () => {
      vi.mocked(deleteDiaryEntryById).mockResolvedValue(
        sdkOk({ success: true }) as never,
      );

      const result = await handleEntryDelete(
        { diary_id: DIARY_ID, entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(deleteDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: ENTRY_ID },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(deleteDiaryEntryById).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleEntryDelete(
        { diary_id: DIARY_ID, entry_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });

  describe('reflect', () => {
    it('generates a digest with defaults', async () => {
      const digest = {
        entries: [{ id: ENTRY_ID, content: 'A memory' }],
        totalEntries: 1,
        periodDays: 7,
        generatedAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(reflectDiary).mockResolvedValue(sdkOk(digest) as never);

      const result = await handleReflect({ diary_id: DIARY_ID }, deps, context);

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { diaryId: DIARY_ID, days: 7, maxEntries: 50 },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('digest');
    });

    it('passes custom days and max_entries', async () => {
      vi.mocked(reflectDiary).mockResolvedValue(
        sdkOk({ entries: [], totalEntries: 0 }) as never,
      );

      await handleReflect(
        { diary_id: DIARY_ID, days: 30, max_entries: 10 },
        deps,
        context,
      );

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { diaryId: DIARY_ID, days: 30, maxEntries: 10 },
        }),
      );
    });
  });

  describe('entries_verify', () => {
    it('verifies an entry by ID', async () => {
      vi.mocked(verifyDiaryEntryById).mockResolvedValue(
        sdkOk({ signed: true, valid: true }) as never,
      );

      const result = await handleEntryVerify(
        { entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(verifyDiaryEntryById).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { entryId: ENTRY_ID },
        }),
      );
      expect(result.isError).toBeUndefined();
    });
  });

  describe('diaries_list', () => {
    it('returns list of diaries', async () => {
      const data = {
        items: [
          {
            id: DIARY_ID,
            name: 'My Diary',
            visibility: 'private',
            ownerId: 'owner-id',
            signed: false,
            createdAt: '2025-01-01T00:00:00.000Z',
            updatedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      };
      vi.mocked(listDiaries).mockResolvedValue(sdkOk(data) as never);

      const result = await handleDiariesList({}, deps, context);

      expect(listDiaries).toHaveBeenCalledWith(
        expect.objectContaining({ auth: expect.any(Function) }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('items');
      expect(parsed.items).toHaveLength(1);
    });

    it('returns empty list when no diaries', async () => {
      vi.mocked(listDiaries).mockResolvedValue(sdkOk({ items: [] }) as never);

      const result = await handleDiariesList({}, deps, context);

      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('items');
      expect(parsed.items).toHaveLength(0);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleDiariesList({}, deps, unauthContext);

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });

    it('returns error when API fails', async () => {
      vi.mocked(listDiaries).mockResolvedValue(
        sdkErr({
          error: 'Internal Server Error',
          message: 'Server error',
          statusCode: 500,
        }) as never,
      );

      const result = await handleDiariesList({}, deps, context);

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Failed to list diaries');
    });
  });

  describe('diaries_create', () => {
    it('creates a diary with name only', async () => {
      const diary = {
        id: DIARY_ID,
        name: 'My Diary',
        visibility: 'private',
        ownerId: 'owner-id',
        signed: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(createDiary).mockResolvedValue(sdkOk(diary, 201) as never);

      const result = await handleDiariesCreate(
        { name: 'My Diary' },
        deps,
        context,
      );

      expect(createDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'My Diary', visibility: undefined },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('diary');
    });

    it('creates a diary with name and visibility', async () => {
      const diary = {
        id: DIARY_ID,
        name: 'Public Diary',
        visibility: 'public',
        ownerId: 'owner-id',
        signed: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(createDiary).mockResolvedValue(sdkOk(diary, 201) as never);

      await handleDiariesCreate(
        { name: 'Public Diary', visibility: 'public' },
        deps,
        context,
      );

      expect(createDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { name: 'Public Diary', visibility: 'public' },
        }),
      );
    });

    it('returns diary with id on success', async () => {
      const diary = { id: DIARY_ID, name: 'Test' };
      vi.mocked(createDiary).mockResolvedValue(sdkOk(diary, 201) as never);

      const result = await handleDiariesCreate({ name: 'Test' }, deps, context);

      const parsed = parseResult<{ diary: { id: string } }>(result);
      expect(parsed.diary).toHaveProperty('id', DIARY_ID);
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleDiariesCreate(
        { name: 'Test' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diaries_get', () => {
    it('returns diary metadata by ID', async () => {
      const diary = {
        id: DIARY_ID,
        name: 'My Diary',
        visibility: 'private',
        ownerId: 'owner-id',
        signed: false,
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(getDiary).mockResolvedValue(sdkOk(diary) as never);

      const result = await handleDiariesGet(
        { diary_id: DIARY_ID },
        deps,
        context,
      );

      expect(getDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: DIARY_ID },
        }),
      );
      const parsed = parseResult<{ diary: { id: string } }>(result);
      expect(parsed).toHaveProperty('diary');
      expect(parsed.diary).toHaveProperty('id', DIARY_ID);
    });

    it('returns error when diary not found', async () => {
      vi.mocked(getDiary).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Diary not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiariesGet(
        { diary_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleDiariesGet(
        { diary_id: DIARY_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diaries_consolidate', () => {
    it('calls consolidate API and returns result', async () => {
      vi.mocked(consolidateDiary).mockResolvedValue(
        sdkOk({ clusters: [], total: 0 }) as never,
      );

      const result = await handleDiariesConsolidate(
        {
          diary_id: DIARY_ID,
          threshold: 0.75,
          strategy: 'hybrid',
        },
        deps,
        context,
      );

      expect(consolidateDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: DIARY_ID },
          body: {
            threshold: 0.75,
            strategy: 'hybrid',
            entryIds: undefined,
            excludeTags: undefined,
          },
        }),
      );
      expect(result.isError).toBeUndefined();
    });

    it('passes exclude_tags to consolidate API', async () => {
      vi.mocked(consolidateDiary).mockResolvedValue(
        sdkOk({ clusters: [], total: 0 }) as never,
      );

      await handleDiariesConsolidate(
        {
          diary_id: DIARY_ID,
          tags: ['context'],
          exclude_tags: ['incident'],
        },
        deps,
        context,
      );

      expect(consolidateDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            tags: ['context'],
            excludeTags: ['incident'],
          }),
        }),
      );
    });
  });

  describe('diaries_compile', () => {
    it('calls compile API and returns result', async () => {
      vi.mocked(compileDiary).mockResolvedValue(
        sdkOk({ items: [], totalTokens: 0 }) as never,
      );

      const result = await handleDiariesCompile(
        {
          diary_id: DIARY_ID,
          token_budget: 1024,
          task_prompt: 'prepare context for oauth bugfix',
        },
        deps,
        context,
      );

      expect(compileDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: DIARY_ID },
          body: {
            tokenBudget: 1024,
            taskPrompt: 'prepare context for oauth bugfix',
            lambda: undefined,
            includeTags: undefined,
            excludeTags: undefined,
            wRecency: undefined,
            wImportance: undefined,
          },
        }),
      );
      expect(result.isError).toBeUndefined();
    });

    it('passes exclude_tags to compile API', async () => {
      vi.mocked(compileDiary).mockResolvedValue(
        sdkOk({ items: [], totalTokens: 0 }) as never,
      );

      await handleDiariesCompile(
        {
          diary_id: DIARY_ID,
          token_budget: 1024,
          include_tags: ['context'],
          exclude_tags: ['incident'],
        },
        deps,
        context,
      );

      expect(compileDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.objectContaining({
            includeTags: ['context'],
            excludeTags: ['incident'],
          }),
        }),
      );
    });
  });
});
