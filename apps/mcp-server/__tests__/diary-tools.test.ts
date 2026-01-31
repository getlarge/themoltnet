import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockApi,
  createMockDeps,
  okResponse,
  createdResponse,
  errorResponse,
  parseResult,
  getTextContent,
  TOKEN,
  ENTRY_ID,
  type MockApi,
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

describe('Diary tools', () => {
  let api: MockApi;
  let deps: McpDeps;

  beforeEach(() => {
    api = createMockApi();
    deps = createMockDeps(api);
  });

  describe('diary_create', () => {
    it('creates an entry with content only', async () => {
      const entry = {
        id: ENTRY_ID,
        content: 'My first memory',
        visibility: 'private',
        tags: [],
      };
      api.post.mockResolvedValue(createdResponse(entry));

      const result = await handleDiaryCreate(deps, {
        content: 'My first memory',
      });

      expect(api.post).toHaveBeenCalledWith('/diary/entries', TOKEN, {
        content: 'My first memory',
      });
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
      api.post.mockResolvedValue(createdResponse(entry));

      const result = await handleDiaryCreate(deps, {
        content: 'A tagged memory',
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      });

      expect(api.post).toHaveBeenCalledWith('/diary/entries', TOKEN, {
        content: 'A tagged memory',
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(api, null);
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
      api.get.mockResolvedValue(okResponse(entry));

      const result = await handleDiaryGet(deps, {
        entry_id: ENTRY_ID,
      });

      expect(api.get).toHaveBeenCalledWith(`/diary/entries/${ENTRY_ID}`, TOKEN);
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('entry');
      expect(parsed.entry).toHaveProperty('id', ENTRY_ID);
    });

    it('returns error when entry not found', async () => {
      api.get.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }),
      );

      const result = await handleDiaryGet(deps, {
        entry_id: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(api, null);
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
      api.get.mockResolvedValue(okResponse(data));

      const result = await handleDiaryList(deps, {});

      expect(api.get).toHaveBeenCalledWith('/diary/entries', TOKEN, {
        limit: 20,
        offset: 0,
      });
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('items');
      expect(parsed.items).toHaveLength(1);
    });

    it('passes limit and offset', async () => {
      api.get.mockResolvedValue(
        okResponse({ items: [], total: 0, limit: 5, offset: 10 }),
      );

      await handleDiaryList(deps, { limit: 5, offset: 10 });

      expect(api.get).toHaveBeenCalledWith('/diary/entries', TOKEN, {
        limit: 5,
        offset: 10,
      });
    });
  });

  describe('diary_search', () => {
    it('searches with a query', async () => {
      const data = { results: [{ id: ENTRY_ID }], total: 1 };
      api.post.mockResolvedValue(okResponse(data));

      const result = await handleDiarySearch(deps, {
        query: 'debugging OAuth',
      });

      expect(api.post).toHaveBeenCalledWith('/diary/search', TOKEN, {
        query: 'debugging OAuth',
        limit: 10,
      });
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.results).toHaveLength(1);
    });

    it('passes limit parameter', async () => {
      api.post.mockResolvedValue(okResponse({ results: [], total: 0 }));

      await handleDiarySearch(deps, { query: 'test', limit: 5 });

      expect(api.post).toHaveBeenCalledWith('/diary/search', TOKEN, {
        query: 'test',
        limit: 5,
      });
    });
  });

  describe('diary_update', () => {
    it('updates an entry', async () => {
      const updated = { id: ENTRY_ID, tags: ['updated'] };
      api.patch.mockResolvedValue(okResponse(updated));

      const result = await handleDiaryUpdate(deps, {
        entry_id: ENTRY_ID,
        tags: ['updated'],
      });

      expect(api.patch).toHaveBeenCalledWith(
        `/diary/entries/${ENTRY_ID}`,
        TOKEN,
        { tags: ['updated'] },
      );
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('returns error when entry not found', async () => {
      api.patch.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }),
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
      api.del.mockResolvedValue(okResponse({ success: true }));

      const result = await handleDiaryDelete(deps, {
        entry_id: ENTRY_ID,
      });

      expect(api.del).toHaveBeenCalledWith(`/diary/entries/${ENTRY_ID}`, TOKEN);
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      api.del.mockResolvedValue(
        errorResponse(404, {
          error: 'Not Found',
          message: 'Entry not found',
          statusCode: 404,
        }),
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
      api.get.mockResolvedValue(okResponse(digest));

      const result = await handleDiaryReflect(deps, {});

      expect(api.get).toHaveBeenCalledWith('/diary/reflect', TOKEN, {
        days: 7,
        maxEntries: 50,
      });
      const parsed = parseResult<Record<string, any>>(result);
      expect(parsed).toHaveProperty('digest');
    });

    it('passes custom days and max_entries', async () => {
      api.get.mockResolvedValue(okResponse({ entries: [], totalEntries: 0 }));

      await handleDiaryReflect(deps, { days: 30, max_entries: 10 });

      expect(api.get).toHaveBeenCalledWith('/diary/reflect', TOKEN, {
        days: 30,
        maxEntries: 10,
      });
    });
  });
});
