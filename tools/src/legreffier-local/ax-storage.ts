/**
 * AxStorage adapter backed by MoltNet diary entries.
 *
 * Maps AxLearn's AxStorage interface to diary entry CRUD:
 * - Traces → procedural entries tagged axlearn:trace
 * - Checkpoints → reflection entries tagged axlearn:checkpoint
 * - Queries → searchDiary (traces) or listDiaryEntries (checkpoints)
 */

import type {
  AxCheckpoint,
  AxStorage,
  AxStorageQuery,
  AxTrace,
} from '@ax-llm/ax';
import type { Client } from '@moltnet/api-client';
import {
  createDiaryEntry,
  listDiaryEntries,
  searchDiary,
  updateDiaryEntryById,
} from '@moltnet/api-client';

export interface DiaryStorageOptions {
  client: Client;
  diaryId: string;
  bearerToken: string;
  sessionId: string;
}

export function createDiaryAxStorage(options: DiaryStorageOptions): AxStorage {
  const { client, diaryId, bearerToken, sessionId } = options;
  const auth = () => bearerToken;

  /**
   * In-memory cache from trace ID → diary entry ID for fast lookups.
   * Falls back to tag-based search when the cache misses (e.g. after restart).
   */
  const traceEntryCache = new Map<string, string>();

  /** Resolve a trace ID to its diary entry ID — cache first, then tag search. */
  async function resolveTraceEntryId(
    traceId: string,
    agentName: string,
  ): Promise<string | null> {
    const cached = traceEntryCache.get(traceId);
    if (cached) return cached;

    // Search by axlearn:id:<traceId> tag — survives server restarts
    const { data } = await searchDiary({
      client,
      auth,
      body: {
        diaryId,
        tags: [`axlearn:id:${traceId}`, `axlearn:agent:${agentName}`],
        limit: 1,
        entryTypes: ['procedural'],
      },
    });

    const entry = data?.results?.[0];
    if (entry?.id) {
      traceEntryCache.set(traceId, entry.id);
      return entry.id;
    }
    return null;
  }

  const save = async (
    name: string,
    item: AxTrace | AxCheckpoint,
  ): Promise<void> => {
    if (item.type === 'trace') {
      const trace = item;
      const tags = [
        'axlearn:trace',
        `axlearn:agent:${name}`,
        `axlearn:session:${sessionId}`,
        `axlearn:id:${trace.id}`,
      ];
      if (trace.feedback) {
        tags.push('axlearn:has-feedback');
      }

      // Check if this trace already exists (feedback update)
      const existingEntryId = await resolveTraceEntryId(trace.id, name);
      if (existingEntryId) {
        await updateDiaryEntryById({
          client,
          auth,
          path: { entryId: existingEntryId },
          body: {
            content: JSON.stringify(trace),
            tags,
          },
        });
        return;
      }

      const { data } = await createDiaryEntry({
        client,
        auth,
        path: { diaryId },
        body: {
          content: JSON.stringify(trace),
          title: `axlearn trace: ${truncate(stringifyInput(trace.input), 80)}`,
          entryType: 'procedural',
          tags,
          importance: 5,
        },
      });
      if (data?.id) {
        traceEntryCache.set(trace.id, data.id);
      }
    } else {
      const checkpoint = item;
      const tags = [
        'axlearn:checkpoint',
        `axlearn:agent:${name}`,
        `axlearn:v:${checkpoint.version}`,
      ];

      await createDiaryEntry({
        client,
        auth,
        path: { diaryId },
        body: {
          content: JSON.stringify(checkpoint),
          title: `axlearn checkpoint v${checkpoint.version} (score: ${checkpoint.score?.toFixed(2) ?? 'n/a'})`,
          entryType: 'reflection',
          tags,
          importance: 8,
        },
      });
    }
  };

  const load = async (
    name: string,
    query: AxStorageQuery,
  ): Promise<(AxTrace | AxCheckpoint)[]> => {
    if (query.type === 'trace') {
      const tags = ['axlearn:trace', `axlearn:agent:${name}`];
      if (query.hasFeedback) {
        tags.push('axlearn:has-feedback');
      }

      const { data } = await searchDiary({
        client,
        auth,
        body: {
          diaryId,
          tags,
          limit: query.limit ?? 50,
          offset: query.offset,
          entryTypes: ['procedural'],
        },
      });

      return parseEntries(data?.results);
    }

    // Checkpoints: use list with tag filter
    const tags = ['axlearn:checkpoint', `axlearn:agent:${name}`];
    if (query.version !== undefined) {
      tags.push(`axlearn:v:${query.version}`);
    }

    const { data } = await listDiaryEntries({
      client,
      auth,
      path: { diaryId },
      query: {
        tags: tags.join(','),
        limit: query.limit ?? 10,
      },
    });

    return parseEntries(data?.items);
  };

  return { save, load };
}

function parseEntries(
  entries: Array<{ content: string }> | undefined,
): (AxTrace | AxCheckpoint)[] {
  if (!entries?.length) return [];
  return entries
    .map((e) => {
      try {
        const parsed = JSON.parse(e.content);
        // Restore Date objects from ISO strings
        if (parsed.type === 'trace') {
          parsed.startTime = new Date(parsed.startTime);
          parsed.endTime = new Date(parsed.endTime);
        }
        if (parsed.type === 'checkpoint' && parsed.createdAt) {
          parsed.createdAt = new Date(parsed.createdAt);
        }
        return parsed;
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function stringifyInput(input: Record<string, unknown>): string {
  const question = input.question;
  if (typeof question === 'string') return question;
  return JSON.stringify(input);
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 3) + '...';
}
