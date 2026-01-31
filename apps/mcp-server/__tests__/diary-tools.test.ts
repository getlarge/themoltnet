import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockServices,
  createMockDeps,
  createMockEntry,
  parseResult,
  getTextContent,
  OWNER_ID,
  ENTRY_ID,
  type MockServices,
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
  let mocks: MockServices;
  let deps: McpDeps;

  beforeEach(() => {
    mocks = createMockServices();
    deps = createMockDeps(mocks);
  });

  describe('diary_create', () => {
    it('creates an entry with content only', async () => {
      const entry = createMockEntry();
      mocks.diaryService.create.mockResolvedValue(entry);

      const result = await handleDiaryCreate(deps, {
        content: 'My first memory',
      });

      expect(mocks.diaryService.create).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        content: 'My first memory',
      });
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('creates an entry with all optional fields', async () => {
      const entry = createMockEntry({
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      });
      mocks.diaryService.create.mockResolvedValue(entry);

      const result = await handleDiaryCreate(deps, {
        content: 'A tagged memory',
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      });

      expect(mocks.diaryService.create).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        content: 'A tagged memory',
        visibility: 'moltnet',
        tags: ['test', 'memory'],
      });
      expect(result.isError).toBeUndefined();
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(mocks, null);
      const result = await handleDiaryCreate(unauthDeps, {
        content: 'test',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diary_get', () => {
    it('returns an entry by ID', async () => {
      const entry = createMockEntry();
      mocks.diaryService.getById.mockResolvedValue(entry);

      const result = await handleDiaryGet(deps, { entry_id: ENTRY_ID });

      expect(mocks.diaryService.getById).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('entry');
      expect(parsed.entry).toHaveProperty('id', ENTRY_ID);
    });

    it('returns error when entry not found', async () => {
      mocks.diaryService.getById.mockResolvedValue(null);

      const result = await handleDiaryGet(deps, {
        entry_id: 'nonexistent',
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('not found');
    });

    it('returns error when not authenticated', async () => {
      const unauthDeps = createMockDeps(mocks, null);
      const result = await handleDiaryGet(unauthDeps, {
        entry_id: ENTRY_ID,
      });

      expect(result.isError).toBe(true);
      expect(getTextContent(result)).toContain('Not authenticated');
    });
  });

  describe('diary_list', () => {
    it('lists entries with defaults', async () => {
      const entries = [createMockEntry()];
      mocks.diaryService.list.mockResolvedValue(entries);

      const result = await handleDiaryList(deps, {});

      expect(mocks.diaryService.list).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        limit: 20,
        offset: 0,
      });
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('entries');
      expect(parsed.entries).toHaveLength(1);
    });

    it('passes limit and offset', async () => {
      mocks.diaryService.list.mockResolvedValue([]);

      await handleDiaryList(deps, { limit: 5, offset: 10 });

      expect(mocks.diaryService.list).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        limit: 5,
        offset: 10,
      });
    });
  });

  describe('diary_search', () => {
    it('searches with a query', async () => {
      const entries = [createMockEntry()];
      mocks.diaryService.search.mockResolvedValue(entries);

      const result = await handleDiarySearch(deps, {
        query: 'debugging OAuth',
      });

      expect(mocks.diaryService.search).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        query: 'debugging OAuth',
        limit: 10,
      });
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('results');
      expect(parsed.results).toHaveLength(1);
    });

    it('passes limit parameter', async () => {
      mocks.diaryService.search.mockResolvedValue([]);

      await handleDiarySearch(deps, { query: 'test', limit: 5 });

      expect(mocks.diaryService.search).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        query: 'test',
        limit: 5,
      });
    });
  });

  describe('diary_update', () => {
    it('updates an entry', async () => {
      const updated = createMockEntry({ tags: ['updated'] });
      mocks.diaryService.update.mockResolvedValue(updated);

      const result = await handleDiaryUpdate(deps, {
        entry_id: ENTRY_ID,
        tags: ['updated'],
      });

      expect(mocks.diaryService.update).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
        { tags: ['updated'] },
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('success', true);
      expect(parsed).toHaveProperty('entry');
    });

    it('returns error when entry not found', async () => {
      mocks.diaryService.update.mockResolvedValue(null);

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
      mocks.diaryService.delete.mockResolvedValue(true);

      const result = await handleDiaryDelete(deps, {
        entry_id: ENTRY_ID,
      });

      expect(mocks.diaryService.delete).toHaveBeenCalledWith(
        ENTRY_ID,
        OWNER_ID,
      );
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('success', true);
    });

    it('returns error when entry not found', async () => {
      mocks.diaryService.delete.mockResolvedValue(false);

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
        entries: [
          {
            id: ENTRY_ID,
            content: 'A memory',
            tags: null,
            createdAt: new Date(),
          },
        ],
        totalEntries: 1,
        periodDays: 7,
        generatedAt: new Date().toISOString(),
      };
      mocks.diaryService.reflect.mockResolvedValue(digest);

      const result = await handleDiaryReflect(deps, {});

      expect(mocks.diaryService.reflect).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        days: 7,
        maxEntries: 50,
      });
      const parsed = parseResult(result);
      expect(parsed).toHaveProperty('digest');
    });

    it('passes custom days and max_entries', async () => {
      const digest = {
        entries: [],
        totalEntries: 0,
        periodDays: 30,
        generatedAt: new Date().toISOString(),
      };
      mocks.diaryService.reflect.mockResolvedValue(digest);

      await handleDiaryReflect(deps, { days: 30, max_entries: 10 });

      expect(mocks.diaryService.reflect).toHaveBeenCalledWith({
        ownerId: OWNER_ID,
        days: 30,
        maxEntries: 10,
      });
    });
  });
});
