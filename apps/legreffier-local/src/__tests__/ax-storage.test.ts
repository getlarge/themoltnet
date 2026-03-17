/**
 * AxStorage diary adapter — unit tests
 *
 * Tests the mapping between AxLearn's AxStorage interface and MoltNet diary entries.
 * SDK agent is fully mocked — no network calls.
 */
/* eslint-disable @typescript-eslint/unbound-method -- mock method references are inherent to vitest assertions */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createDiaryAxStorage,
  type DiaryStorageOptions,
} from '../ax-storage.js';

interface EntryCreateBody {
  content: string;
  title: string;
  entryType: string;
  tags: string[];
  importance: number;
}

interface EntryUpdateBody {
  content: string;
  tags: string[];
}

interface ListQuery {
  tags: string;
  limit: number;
  offset?: number;
  entryType: string;
}

function mockSdkAgent() {
  return {
    entries: {
      create: vi.fn().mockResolvedValue({ id: 'entry-1' }),
      update: vi.fn().mockResolvedValue({ id: 'entry-1' }),
      search: vi.fn().mockResolvedValue({ results: [], total: 0 }),
      list: vi
        .fn()
        .mockResolvedValue({ items: [], total: 0, limit: 10, offset: 0 }),
    },
  } as unknown as DiaryStorageOptions['sdkAgent'];
}

/** Extract typed mock calls from a vi.fn() mock. */
function mockCalls<T extends unknown[]>(fn: unknown): T[] {
  return (fn as ReturnType<typeof vi.fn>).mock.calls as T[];
}

describe('createDiaryAxStorage', () => {
  const diaryId = 'diary-uuid-123';
  const sessionId = 'session-uuid-456';

  let sdk: ReturnType<typeof mockSdkAgent>;
  let storage: ReturnType<typeof createDiaryAxStorage>;

  beforeEach(() => {
    sdk = mockSdkAgent();
    storage = createDiaryAxStorage({ sdkAgent: sdk, diaryId, sessionId });
  });

  describe('save', () => {
    it('saves a trace as a semantic diary entry with correct tags', async () => {
      const trace = {
        type: 'trace' as const,
        id: 'trace-abc',
        name: 'test-agent',
        input: { question: 'how does auth work?' },
        output: { answer: 'JWT tokens', confidence: 'high' },
        startTime: new Date('2026-03-16T10:00:00Z'),
        endTime: new Date('2026-03-16T10:00:05Z'),
        durationMs: 5000,
      };

      await storage.save('test-agent', trace);

      expect(vi.mocked(sdk.entries.create)).toHaveBeenCalledOnce();
      const calls = mockCalls<[string, EntryCreateBody]>(sdk.entries.create);
      const [callDiaryId, callBody] = calls[0];
      expect(callDiaryId).toBe(diaryId);
      expect(callBody.entryType).toBe('semantic');
      expect(callBody.tags).toEqual(
        expect.arrayContaining([
          'learn:trace',
          'learn:agent:test-agent',
          'learn:s:session-uuid-456',
          'learn:id:trace-abc',
        ]),
      );
      const content = JSON.parse(callBody.content) as {
        id: string;
        input: { question: string };
      };
      expect(content.id).toBe('trace-abc');
      expect(content.input.question).toBe('how does auth work?');
    });

    it('saves a checkpoint as a reflection diary entry with version tag', async () => {
      const checkpoint = {
        type: 'checkpoint' as const,
        name: 'test-agent',
        version: 3,
        createdAt: new Date('2026-03-16T12:00:00Z'),
        instruction: 'You are a helpful assistant.',
        examples: [{ input: { question: 'q' }, output: { answer: 'a' } }],
        score: 0.85,
      };

      await storage.save('test-agent', checkpoint);

      expect(vi.mocked(sdk.entries.create)).toHaveBeenCalledOnce();
      const calls = mockCalls<[string, EntryCreateBody]>(sdk.entries.create);
      const [, callBody] = calls[0];
      expect(callBody.entryType).toBe('reflection');
      expect(callBody.tags).toEqual(
        expect.arrayContaining([
          'learn:checkpoint',
          'learn:agent:test-agent',
          'learn:v:3',
        ]),
      );
      expect(callBody.importance).toBe(8);
    });

    it('updates existing trace via cache when trace ID was previously saved', async () => {
      vi.mocked(sdk.entries.create).mockResolvedValue({
        id: 'entry-1',
      } as never);

      const trace = {
        type: 'trace' as const,
        id: 'trace-abc',
        name: 'test-agent',
        input: { question: 'q' },
        output: { answer: 'a', confidence: 'high' },
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 100,
      };
      await storage.save('test-agent', trace);

      const traceWithFeedback = {
        ...trace,
        feedback: { score: 0.8, comment: 'good' },
      };
      await storage.save('test-agent', traceWithFeedback);

      expect(vi.mocked(sdk.entries.update)).toHaveBeenCalledOnce();
      const calls = mockCalls<[string, EntryUpdateBody]>(sdk.entries.update);
      const [entryId, body] = calls[0];
      expect(entryId).toBe('entry-1');
      expect(body.tags).toEqual(expect.arrayContaining(['learn:has-feedback']));
    });

    it('resolves trace entry ID via list when cache misses', async () => {
      vi.mocked(sdk.entries.list).mockResolvedValue({
        items: [{ id: 'entry-from-list', content: '{}' }],
        total: 1,
        limit: 1,
        offset: 0,
      } as never);

      const trace = {
        type: 'trace' as const,
        id: 'trace-xyz',
        name: 'test-agent',
        input: { question: 'q' },
        output: { answer: 'a', confidence: 'high' },
        startTime: new Date(),
        endTime: new Date(),
        durationMs: 100,
        feedback: { score: 1 },
      };
      await storage.save('test-agent', trace);

      expect(vi.mocked(sdk.entries.list)).toHaveBeenCalled();
      const listCalls = mockCalls<[string, ListQuery]>(sdk.entries.list);
      // First call is resolveTraceEntryId
      const [listDiaryId, listQuery] = listCalls[0];
      expect(listDiaryId).toBe(diaryId);
      expect(listQuery.tags).toContain('learn:id:trace-xyz');
      expect(listQuery.entryType).toBe('semantic');
      expect(vi.mocked(sdk.entries.update)).toHaveBeenCalledOnce();
      const updateCalls = mockCalls<[string]>(sdk.entries.update);
      expect(updateCalls[0][0]).toBe('entry-from-list');
    });
  });

  describe('load', () => {
    it('loads traces via list with correct tag filters', async () => {
      const now = new Date();
      vi.mocked(sdk.entries.list).mockResolvedValue({
        items: [
          {
            id: 'entry-1',
            content: JSON.stringify({
              type: 'trace',
              id: 'trace-abc',
              name: 'test-agent',
              input: { question: 'q' },
              output: { answer: 'a', confidence: 'high' },
              startTime: now.toISOString(),
              endTime: now.toISOString(),
              durationMs: 100,
            }),
          },
        ],
        total: 1,
        limit: 5,
        offset: 0,
      } as never);

      const result = await storage.load('test-agent', {
        type: 'trace',
        limit: 5,
      });

      expect(vi.mocked(sdk.entries.list)).toHaveBeenCalledOnce();
      const listCalls = mockCalls<[string, ListQuery]>(sdk.entries.list);
      const [listDiaryId, listQuery] = listCalls[0];
      expect(listDiaryId).toBe(diaryId);
      expect(listQuery.tags).toContain('learn:trace');
      expect(listQuery.tags).toContain('learn:agent:test-agent');
      expect(listQuery.limit).toBe(5);
      expect(listQuery.entryType).toBe('semantic');
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('trace');
      expect((result[0] as { id: string }).id).toBe('trace-abc');
    });

    it('loads checkpoints via list with tag filter', async () => {
      vi.mocked(sdk.entries.list).mockResolvedValue({
        items: [
          {
            id: 'entry-2',
            content: JSON.stringify({
              type: 'checkpoint',
              name: 'test-agent',
              version: 3,
              createdAt: '2026-03-16T12:00:00Z',
              instruction: 'Be helpful.',
              score: 0.85,
            }),
          },
        ],
        total: 1,
        limit: 10,
        offset: 0,
      } as never);

      const result = await storage.load('test-agent', {
        type: 'checkpoint',
        limit: 1,
      });

      expect(vi.mocked(sdk.entries.list)).toHaveBeenCalledOnce();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('checkpoint');
      expect((result[0] as { version: number }).version).toBe(3);
    });

    it('filters traces by hasFeedback when requested', async () => {
      await storage.load('test-agent', {
        type: 'trace',
        hasFeedback: true,
      });

      const listCalls = mockCalls<[string, ListQuery]>(sdk.entries.list);
      const [, listQuery] = listCalls[0];
      expect(listQuery.tags).toContain('learn:has-feedback');
    });

    it('returns empty array when no entries found', async () => {
      const result = await storage.load('test-agent', { type: 'trace' });
      expect(result).toEqual([]);
    });
  });
});
