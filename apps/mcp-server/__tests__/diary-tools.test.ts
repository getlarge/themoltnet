import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleDiaryCreate,
  handleDiaryDelete,
  handleDiaryGet,
  handleDiaryList,
  handleDiaryReflect,
  handleDiarySearch,
  handleDiaryUpdate,
} from '../src/diary-tools.js';
import type { HandlerContext, McpDeps } from '../src/types.js';
import {
  createMockContext,
  createMockDeps,
  ENTRY_ID,
  getTextContent,
  parseResult,
  sdkErr,
  sdkOk,
} from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: vi.fn(),
  getDiaryEntry: vi.fn(),
  listDiaryEntries: vi.fn(),
  searchDiary: vi.fn(),
  updateDiaryEntry: vi.fn(),
  deleteDiaryEntry: vi.fn(),
  reflectDiary: vi.fn(),
}));

import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntry,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';

describe('Diary tools', () => {
  let deps: McpDeps;
  let context: HandlerContext;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
    context = createMockContext();
  });

  describe('diary_create', () => {
    it('creates an entry with content only', async () => {
      const entry = {
        id: ENTRY_ID,
        content: 'My first memory',
        tags: [],
      };
      vi.mocked(createDiaryEntry).mockResolvedValue(sdkOk(entry, 201) as never);

      const result = await handleDiaryCreate(
        { diary_ref: 'private', content: 'My first memory' },
        deps,
        context,
      );

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private' },
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

      const result = await handleDiaryCreate(
        {
          diary_ref: 'engineering',
          content: 'A tagged memory',
          title: 'Tagged',
          tags: ['test', 'memory'],
        },
        deps,
        context,
      );

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'engineering' },
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

      await handleDiaryCreate(
        { diary_ref: 'private', content: 'test', title: 'My Title' },
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
      const result = await handleDiaryCreate(
        { diary_ref: 'private', content: 'test' },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diary_get', () => {
    it('returns an entry by ID', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(getDiaryEntry).mockResolvedValue(sdkOk(entry) as never);

      const result = await handleDiaryGet(
        { diary_ref: 'private', entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(getDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private', id: ENTRY_ID },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('entry');
      expect(parsed.entry).toHaveProperty('id', ENTRY_ID);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(getDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiaryGet(
        { diary_ref: 'private', entry_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthContext = createMockContext(null);
      const result = await handleDiaryGet(
        { diary_ref: 'private', entry_id: ENTRY_ID },
        deps,
        unauthContext,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diary_list', () => {
    it('lists entries with defaults', async () => {
      const data = {
        items: [{ id: ENTRY_ID }],
        total: 1,
        limit: 20,
        offset: 0,
      };
      vi.mocked(listDiaryEntries).mockResolvedValue(sdkOk(data) as never);

      const result = await handleDiaryList(
        { diary_ref: 'private' },
        deps,
        context,
      );

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private' },
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

      await handleDiaryList(
        { diary_ref: 'private', limit: 5, offset: 10 },
        deps,
        context,
      );

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private' },
          query: { limit: 5, offset: 10 },
        }),
      );
    });

    it('passes tags filter as comma-separated query param', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [], total: 0, limit: 20, offset: 0 }) as never,
      );

      await handleDiaryList(
        { diary_ref: 'private', tags: ['accountable-commit', 'high-risk'] },
        deps,
        context,
      );

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private' },
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

      await handleDiaryList({ diary_ref: 'private' }, deps, context);

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private' },
          query: { limit: 20, offset: 0 },
        }),
      );
    });
  });

  describe('diary_search', () => {
    it('searches with a query', async () => {
      const data = { results: [{ id: ENTRY_ID }], total: 1 };
      vi.mocked(searchDiary).mockResolvedValue(sdkOk(data) as never);

      const result = await handleDiarySearch(
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

      await handleDiarySearch({ query: 'test', limit: 5 }, deps, context);

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

      await handleDiarySearch(
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

      await handleDiarySearch({ query: 'test' }, deps, context);

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'test', limit: 10 },
        }),
      );
    });
  });

  describe('diary_update', () => {
    it('updates an entry', async () => {
      const updated = { id: ENTRY_ID, tags: ['updated'] };
      vi.mocked(updateDiaryEntry).mockResolvedValue(sdkOk(updated) as never);

      const result = await handleDiaryUpdate(
        { diary_ref: 'private', entry_id: ENTRY_ID, tags: ['updated'] },
        deps,
        context,
      );

      expect(updateDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private', id: ENTRY_ID },
          body: { tags: ['updated'] },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('returns error when entry not found', async () => {
      vi.mocked(updateDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiaryUpdate(
        {
          diary_ref: 'private',
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

  describe('diary_delete', () => {
    it('deletes an entry', async () => {
      vi.mocked(deleteDiaryEntry).mockResolvedValue(
        sdkOk({ success: true }) as never,
      );

      const result = await handleDiaryDelete(
        { diary_ref: 'private', entry_id: ENTRY_ID },
        deps,
        context,
      );

      expect(deleteDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { diaryRef: 'private', id: ENTRY_ID },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(deleteDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as never,
      );

      const result = await handleDiaryDelete(
        { diary_ref: 'private', entry_id: 'nonexistent' },
        deps,
        context,
      );

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });

  describe('diary_reflect', () => {
    it('generates a digest with defaults', async () => {
      const digest = {
        entries: [{ id: ENTRY_ID, content: 'A memory' }],
        totalEntries: 1,
        periodDays: 7,
        generatedAt: '2025-01-01T00:00:00.000Z',
      };
      vi.mocked(reflectDiary).mockResolvedValue(sdkOk(digest) as never);

      const result = await handleDiaryReflect({}, deps, context);

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { days: 7, maxEntries: 50 },
        }),
      );
      const parsed = parseResult<Record<string, unknown>>(result);
      expect(parsed).toHaveProperty('digest');
    });

    it('passes custom days and max_entries', async () => {
      vi.mocked(reflectDiary).mockResolvedValue(
        sdkOk({ entries: [], totalEntries: 0 }) as never,
      );

      await handleDiaryReflect({ days: 30, max_entries: 10 }, deps, context);

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { days: 30, maxEntries: 10 },
        }),
      );
    });
  });
});
