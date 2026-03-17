/**
 * AxStorage adapter backed by MoltNet diary entries via @themoltnet/sdk.
 *
 * Maps AxLearn's AxStorage interface to diary entry CRUD:
 * - Traces → semantic entries tagged ${TAG}:trace
 * - Checkpoints → reflection entries tagged ${TAG}:checkpoint
 * - Queries → entries.list with tag filtering (TAG prefix: "learn")
 */

import type {
  AxCheckpoint,
  AxStorage,
  AxStorageQuery,
  AxTrace,
} from '@ax-llm/ax';
import type { Agent } from '@themoltnet/sdk';

import { truncate } from './util.js';

export interface DiaryStorageOptions {
  sdkAgent: Agent;
  diaryId: string;
  sessionId: string;
}

const TAG = 'learn';

export function createDiaryAxStorage(options: DiaryStorageOptions): AxStorage {
  const { sdkAgent, diaryId, sessionId } = options;

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

    const data = await sdkAgent.entries.list(diaryId, {
      tags: [`${TAG}:id:${traceId}`, `${TAG}:agent:${agentName}`].join(','),
      limit: 1,
      entryType: 'semantic',
    });

    const entry = data?.items?.[0];
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
        `${TAG}:trace`,
        `${TAG}:agent:${name}`,
        `${TAG}:s:${sessionId}`,
        `${TAG}:id:${trace.id}`,
      ];
      if (trace.feedback) {
        tags.push(`${TAG}:has-feedback`);
      }

      const existingEntryId = await resolveTraceEntryId(trace.id, name);
      if (existingEntryId) {
        await sdkAgent.entries.update(existingEntryId, {
          content: JSON.stringify(trace),
          tags,
        });
        return;
      }

      const entry = await sdkAgent.entries.create(diaryId, {
        content: JSON.stringify(trace),
        title: `${TAG} trace: ${truncate(stringifyInput(trace.input), 80)}`,
        entryType: 'semantic',
        tags,
        importance: 5,
      });
      if (entry?.id) {
        traceEntryCache.set(trace.id, entry.id);
      }
    } else {
      const checkpoint = item;
      const tags = [
        `${TAG}:checkpoint`,
        `${TAG}:agent:${name}`,
        `${TAG}:v:${checkpoint.version}`,
      ];

      await sdkAgent.entries.create(diaryId, {
        content: JSON.stringify(checkpoint),
        title: `${TAG} checkpoint v${checkpoint.version} (score: ${checkpoint.score?.toFixed(2) ?? 'n/a'})`,
        entryType: 'reflection',
        tags,
        importance: 8,
      });
    }
  };

  const load = async (
    name: string,
    query: AxStorageQuery,
  ): Promise<(AxTrace | AxCheckpoint)[]> => {
    if (query.type === 'trace') {
      const tags = [`${TAG}:trace`, `${TAG}:agent:${name}`];
      if (query.hasFeedback) {
        tags.push(`${TAG}:has-feedback`);
      }

      const data = await sdkAgent.entries.list(diaryId, {
        tags: tags.join(','),
        limit: query.limit ?? 50,
        offset: query.offset,
        entryType: 'semantic',
      });

      return parseEntries(data?.items);
    }

    // Checkpoints: use list with tag filter
    const tags = [`${TAG}:checkpoint`, `${TAG}:agent:${name}`];
    if (query.version !== undefined) {
      tags.push(`${TAG}:v:${query.version}`);
    }

    const data = await sdkAgent.entries.list(diaryId, {
      tags: tags.join(','),
      limit: query.limit ?? 10,
    });

    return parseEntries(data?.items);
  };

  return { save, load };
}

function isTraceOrCheckpoint(value: unknown): value is AxTrace | AxCheckpoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    ((value as { type: unknown }).type === 'trace' ||
      (value as { type: unknown }).type === 'checkpoint')
  );
}

function parseEntries(
  entries: Array<{ content: string }> | undefined,
): (AxTrace | AxCheckpoint)[] {
  if (!entries?.length) return [];
  return entries
    .map((e) => {
      try {
        const parsed: unknown = JSON.parse(e.content);
        if (!isTraceOrCheckpoint(parsed)) return null;
        if (parsed.type === 'trace') {
          const trace = parsed;
          trace.startTime = new Date(trace.startTime);
          trace.endTime = new Date(trace.endTime);
          return trace;
        }
        const checkpoint = parsed;
        if ('createdAt' in checkpoint && checkpoint.createdAt) {
          (checkpoint as AxCheckpoint & { createdAt: Date }).createdAt =
            new Date(checkpoint.createdAt as unknown as string);
        }
        return checkpoint;
      } catch {
        return null;
      }
    })
    .filter((v): v is AxTrace | AxCheckpoint => v !== null);
}

function stringifyInput(input: Record<string, unknown>): string {
  const question = input.question;
  if (typeof question === 'string') return question;
  return JSON.stringify(input);
}
