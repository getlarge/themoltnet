import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createMockDeps,
  sdkOk,
  sdkErr,
  parseResult,
  getTextContent,
  ENTRY_ID,
} from './helpers.js';
import type { McpDeps } from '../src/types.js';
import {
  handleDiaryCreate,
  handleDiaryGet,
  handleDiaryList,
  handleDiarySearch,
  handleDiaryUpdate,
  handleDiaryDelete,
  handleDiaryReflect,
} from '../src/diary-tools.js';

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
  getDiaryEntry,
  listDiaryEntries,
  searchDiary,
  updateDiaryEntry,
  deleteDiaryEntry,
  reflectDiary,
} from '@moltnet/api-client';

describe('Diary tools', () => {
  let deps: McpDeps;

  beforeEach(() => {
    vi.clearAllMocks();
    deps = createMockDeps();
  });

  describe('diary_create', () => {
    it('creates an entry with content only', async () => {
      const entry = {
        id: ENTRY_ID,
        content: 'My first memory',
        visibility: 'private',
        tags: [],
      };
      vi.mocked(createDiaryEntry).mockResolvedValue(sdkOk(entry, 201) as any);

      const result = await handleDiaryCreate(deps, {
        content: 'My first memory',
      });

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { content: 'My first memory' },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('creates an entry with all optional fields', async () => {
      const entry = {
        id: ENTRY_ID,
        content: 'A tagged memory',
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      };
      vi.mocked(createDiaryEntry).mockResolvedValue(sdkOk(entry, 201) as any);

      const result = await handleDiaryCreate(deps, {
        content: 'A tagged memory',
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      });

      expect(createDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          body: {
            content: 'A tagged memory',
            visibility: 'moltnet',
            tags: ['test', 'memory'],
          },
        }),
      );
      expect(result.isError).toBeUndefined();
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(null);
      const result = await handleDiaryCreate(unauthDeps, {
        content: 'test',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diary_get', () => {
    it('returns an entry by ID', async () => {
      const entry = { id: ENTRY_ID, content: 'A memory' };
      vi.mocked(getDiaryEntry).mockResolvedValue(sdkOk(entry) as any);

      const result = await handleDiaryGet(deps, {
        entry_id: ENTRY_ID,
      });

      expect(getDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('entry');
      expect(parsed.entry).toHaveProperty('id', ENTRY_ID);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(getDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as any,
      );

      const result = await handleDiaryGet(deps, {
        entry_id: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(null);
      const result = await handleDiaryGet(unauthDeps, {
        entry_id: ENTRY_ID,
      });

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
      vi.mocked(listDiaryEntries).mockResolvedValue(sdkOk(data) as any);

      const result = await handleDiaryList(deps, {});

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 20, offset: 0 },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('items');
      expect(parsed.items).toHaveLength(1);
    });

    it('passes limit and offset', async () => {
      vi.mocked(listDiaryEntries).mockResolvedValue(
        sdkOk({ items: [], total: 0, limit: 5, offset: 10 }) as any,
      );

      await handleDiaryList(deps, { limit: 5, offset: 10 });

      expect(listDiaryEntries).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { limit: 5, offset: 10 },
        }),
      );
    });
  });

  describe('diary_search', () => {
    it('searches with a query', async () => {
      const data = { results: [{ id: ENTRY_ID }], total: 1 };
      vi.mocked(searchDiary).mockResolvedValue(sdkOk(data) as any);

      const result = await handleDiarySearch(deps, {
        query: 'debugging OAuth',
      });

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'debugging OAuth', limit: 10 },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.results).toHaveLength(1);
    });

    it('passes limit parameter', async () => {
      vi.mocked(searchDiary).mockResolvedValue(
        sdkOk({ results: [], total: 0 }) as any,
      );

      await handleDiarySearch(deps, { query: 'test', limit: 5 });

      expect(searchDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { query: 'test', limit: 5 },
        }),
      );
    });
  });

  describe('diary_update', () => {
    it('updates an entry', async () => {
      const updated = { id: ENTRY_ID, tags: ['updated'] };
      vi.mocked(updateDiaryEntry).mockResolvedValue(sdkOk(updated) as any);

      const result = await handleDiaryUpdate(deps, {
        entry_id: ENTRY_ID,
        tags: ['updated'],
      });

      expect(updateDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
          body: { tags: ['updated'] },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('returns error when entry not found', async () => {
      vi.mocked(updateDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as any,
      );

      const result = await handleDiaryUpdate(deps, {
        entry_id: 'nonexistent',
        content: 'new content',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });
  });

  describe('diary_delete', () => {
    it('deletes an entry', async () => {
      vi.mocked(deleteDiaryEntry).mockResolvedValue(
        sdkOk({ success: true }) as any,
      );

      const result = await handleDiaryDelete(deps, {
        entry_id: ENTRY_ID,
      });

      expect(deleteDiaryEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { id: ENTRY_ID },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      vi.mocked(deleteDiaryEntry).mockResolvedValue(
        sdkErr({
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }) as any,
      );

      const result = await handleDiaryDelete(deps, {
        entry_id: 'nonexistent',
      });

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
      vi.mocked(reflectDiary).mockResolvedValue(sdkOk(digest) as any);

      const result = await handleDiaryReflect(deps, {});

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { days: 7, maxEntries: 50 },
        }),
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('digest');
    });

    it('passes custom days and max_entries', async () => {
      vi.mocked(reflectDiary).mockResolvedValue(
        sdkOk({ entries: [], totalEntries: 0 }) as any,
      );

      await handleDiaryReflect(deps, { days: 30, max_entries: 10 });

      expect(reflectDiary).toHaveBeenCalledWith(
        expect.objectContaining({
          query: { days: 30, maxEntries: 10 },
        }),
      );
    });
  });
});
