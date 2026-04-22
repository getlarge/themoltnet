/**
 * @moltnet/mcp-server — Profile Utilities
 *
 * Helpers for finding system diary entries (identity/soul)
 * that store an agent's self-concept.
 *
 * Searches are scoped to the caller's own diaries to prevent
 * cross-tenant data leaks from moltnet-visibility entries.
 */

import type { Client } from '@moltnet/api-client';
import { listDiaries, searchDiary } from '@moltnet/api-client';
import type { FastifyBaseLogger } from 'fastify';

export interface SystemEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
}

type Logger = Pick<FastifyBaseLogger, 'warn' | 'error'>;

/**
 * Returns the caller's own diary IDs.
 * Returns null if the API call fails (to distinguish from "agent owns no diaries").
 */
async function getOwnDiaryIds(
  client: Client,
  token: string,
  logger?: Logger,
): Promise<string[] | null> {
  try {
    const { data, error } = await listDiaries({ client, auth: () => token });
    if (error) {
      logger?.warn({ err: error }, 'profile-utils: listDiaries error');
      return null;
    }
    return data?.items?.map((d) => d.id) ?? [];
  } catch (err) {
    logger?.error({ err }, 'profile-utils: listDiaries threw');
    return null;
  }
}

/**
 * Find a single diary entry by entry type and system tag.
 * Returns the first matching entry or null.
 * Returns null on API/transport errors (caller should surface a retry hint, not bootstrap hint).
 */
export async function findSystemEntry(
  client: Client,
  token: string,
  entryType: 'identity' | 'soul',
  logger?: Logger,
): Promise<SystemEntry | null> {
  const diaryIds = await getOwnDiaryIds(client, token, logger);
  if (!diaryIds?.length) return null;

  const results = await Promise.all(
    diaryIds.map(async (diaryId) => {
      try {
        const { data, error } = await searchDiary({
          client,
          auth: () => token,
          body: {
            diaryId,
            entryTypes: [entryType],
            tags: ['system'],
            limit: 1,
          },
        });
        if (error) {
          logger?.warn(
            { err: error, diaryId },
            'profile-utils: searchDiary error',
          );
          return null;
        }
        const entry = data?.results?.[0] as SystemEntryCandidate | undefined;
        if (!entry) return null;
        return {
          id: entry.id,
          title: entry.title ?? null,
          content: entry.content,
          tags: entry.tags ?? null,
        };
      } catch (err) {
        logger?.error({ err, diaryId }, 'profile-utils: searchDiary threw');
        return null;
      }
    }),
  );

  return results.find((r) => r !== null) ?? null;
}

/**
 * Find both identity and soul system entries in parallel across all own diaries.
 */
export async function findProfileEntries(
  client: Client,
  token: string,
  logger?: Logger,
): Promise<{ whoami: SystemEntry | null; soul: SystemEntry | null }> {
  const diaryIds = await getOwnDiaryIds(client, token, logger);
  if (!diaryIds?.length) return { whoami: null, soul: null };

  const perDiaryResults = await Promise.all(
    diaryIds.map(async (diaryId) => {
      try {
        const { data, error } = await searchDiary({
          client,
          auth: () => token,
          body: {
            diaryId,
            entryTypes: ['identity', 'soul'],
            tags: ['system'],
            limit: 10,
          },
        });
        if (error) {
          logger?.warn(
            { err: error, diaryId },
            'profile-utils: searchDiary error',
          );
          return [];
        }
        return (data?.results ?? []) as SystemEntryCandidate[];
      } catch (err) {
        logger?.error({ err, diaryId }, 'profile-utils: searchDiary threw');
        return [];
      }
    }),
  );

  let whoami: SystemEntry | null = null;
  let soul: SystemEntry | null = null;

  for (const entries of perDiaryResults) {
    for (const raw of entries) {
      if (raw.entryType === 'identity' && !whoami) {
        whoami = {
          id: raw.id,
          title: raw.title ?? null,
          content: raw.content,
          tags: raw.tags ?? null,
        };
      }
      if (raw.entryType === 'soul' && !soul) {
        soul = {
          id: raw.id,
          title: raw.title ?? null,
          content: raw.content,
          tags: raw.tags ?? null,
        };
      }
      if (whoami && soul) break;
    }
    if (whoami && soul) break;
  }

  return { whoami, soul };
}

interface SystemEntryCandidate {
  id: string;
  title?: string | null;
  content: string;
  tags?: string[] | null;
  entryType?: string;
}
