/**
 * AxStorage diary adapter — unit tests
 *
 * Tests the mapping between AxLearn's AxStorage interface and MoltNet diary entries.
 * API client is fully mocked — no network calls.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createDiaryAxStorage } from '../ax-storage.js';

// Mock the API client functions
const mockCreateEntry = vi.fn();
const mockSearchDiary = vi.fn();
const mockListEntries = vi.fn();
const mockUpdateEntry = vi.fn();

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: (...args: unknown[]) => mockCreateEntry(...args),
  searchDiary: (...args: unknown[]) => mockSearchDiary(...args),
  listDiaryEntries: (...args: unknown[]) => mockListEntries(...args),
  updateDiaryEntryById: (...args: unknown[]) => mockUpdateEntry(...args),
}));

describe('createDiaryAxStorage', () => {
  const client = {} as any;
  const diaryId = 'diary-uuid-123';
  const bearerToken = 'test-token';
  const sessionId = 'session-uuid-456';

  let storage: ReturnType<typeof createDiaryAxStorage>;

  beforeEach(() => {
    vi.clearAllMocks();
    storage = createDiaryAxStorage({ client, diaryId, bearerToken, sessionId });
  });

  describe('save', () => {
    it('saves a trace as a procedural diary entry with correct tags', async () => {
      // resolveTraceEntryId will search — return empty (no existing entry)
      mockSearchDiary.mockResolvedValue({ data: { results: [], total: 0 } });
      mockCreateEntry.mockResolvedValue({ data: { id: 'entry-1' } });

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

      expect(mockCreateEntry).toHaveBeenCalledOnce();
      const call = mockCreateEntry.mock.calls[0][0];
      expect(call.path.diaryId).toBe(diaryId);
      expect(call.body.entryType).toBe('procedural');
      expect(call.body.tags).toEqual(
        expect.arrayContaining([
          'axlearn:trace',
          'axlearn:agent:test-agent',
          'axlearn:session:session-uuid-456',
          'axlearn:id:trace-abc',
        ]),
      );
      // Content should be JSON-serialized trace
      const content = JSON.parse(call.body.content);
      expect(content.id).toBe('trace-abc');
      expect(content.input.question).toBe('how does auth work?');
    });

    it('saves a checkpoint as a reflection diary entry with version tag', async () => {
      mockCreateEntry.mockResolvedValue({ data: { id: 'entry-2' } });

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

      expect(mockCreateEntry).toHaveBeenCalledOnce();
      const call = mockCreateEntry.mock.calls[0][0];
      expect(call.body.entryType).toBe('reflection');
      expect(call.body.tags).toEqual(
        expect.arrayContaining([
          'axlearn:checkpoint',
          'axlearn:agent:test-agent',
          'axlearn:v:3',
        ]),
      );
      expect(call.body.importance).toBe(8);
    });

    it('updates existing trace entry via cache when trace ID was previously saved', async () => {
      // First save creates the entry and caches the mapping
      mockCreateEntry.mockResolvedValue({ data: { id: 'entry-1' } });
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

      // Second save with same trace ID — resolves via cache, then updates
      mockUpdateEntry.mockResolvedValue({ data: { id: 'entry-1' } });
      const traceWithFeedback = {
        ...trace,
        feedback: { score: 0.8, comment: 'good' },
      };
      await storage.save('test-agent', traceWithFeedback);

      expect(mockUpdateEntry).toHaveBeenCalledOnce();
      const call = mockUpdateEntry.mock.calls[0][0];
      expect(call.path.entryId).toBe('entry-1');
      expect(call.body.tags).toEqual(
        expect.arrayContaining(['axlearn:has-feedback']),
      );
    });

    it('resolves trace entry ID via tag search when cache misses', async () => {
      // Simulate a fresh storage instance (no cache) — search finds the entry
      mockSearchDiary.mockResolvedValue({
        data: {
          results: [{ id: 'entry-from-search', content: '{}' }],
          total: 1,
        },
      });
      mockUpdateEntry.mockResolvedValue({ data: { id: 'entry-from-search' } });

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

      // Should have searched by axlearn:id:trace-xyz tag
      expect(mockSearchDiary).toHaveBeenCalled();
      const searchCall = mockSearchDiary.mock.calls[0][0];
      expect(searchCall.body.tags).toEqual(
        expect.arrayContaining(['axlearn:id:trace-xyz']),
      );
      // Then updated the found entry
      expect(mockUpdateEntry).toHaveBeenCalledOnce();
      expect(mockUpdateEntry.mock.calls[0][0].path.entryId).toBe(
        'entry-from-search',
      );
    });
  });

  describe('load', () => {
    it('loads traces via searchDiary with correct tag filters', async () => {
      const now = new Date();
      mockSearchDiary.mockResolvedValue({
        data: {
          results: [
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
              tags: ['axlearn:trace', 'axlearn:agent:test-agent'],
              createdAt: now.toISOString(),
            },
          ],
        },
      });

      const result = await storage.load('test-agent', {
        type: 'trace',
        limit: 5,
      });

      expect(mockSearchDiary).toHaveBeenCalledOnce();
      const call = mockSearchDiary.mock.calls[0][0];
      expect(call.body.tags).toEqual(
        expect.arrayContaining(['axlearn:trace', 'axlearn:agent:test-agent']),
      );
      expect(call.body.limit).toBe(5);
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('trace');
      expect((result[0] as any).id).toBe('trace-abc');
    });

    it('loads checkpoints via listDiaryEntries with tag filter', async () => {
      mockListEntries.mockResolvedValue({
        data: {
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
              tags: [
                'axlearn:checkpoint',
                'axlearn:agent:test-agent',
                'axlearn:v:3',
              ],
              createdAt: '2026-03-16T12:00:00Z',
            },
          ],
        },
      });

      const result = await storage.load('test-agent', {
        type: 'checkpoint',
        limit: 1,
      });

      expect(mockListEntries).toHaveBeenCalledOnce();
      expect(result).toHaveLength(1);
      expect(result[0].type).toBe('checkpoint');
      expect((result[0] as any).version).toBe(3);
    });

    it('filters traces by hasFeedback when requested', async () => {
      mockSearchDiary.mockResolvedValue({ data: { results: [], total: 0 } });

      await storage.load('test-agent', {
        type: 'trace',
        hasFeedback: true,
      });

      const call = mockSearchDiary.mock.calls[0][0];
      expect(call.body.tags).toEqual(
        expect.arrayContaining(['axlearn:has-feedback']),
      );
    });

    it('returns empty array when API returns no entries', async () => {
      mockSearchDiary.mockResolvedValue({ data: { results: [], total: 0 } });

      const result = await storage.load('test-agent', { type: 'trace' });
      expect(result).toEqual([]);
    });
  });
});
