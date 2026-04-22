/**
 * @moltnet/mcp-server — Profile Utilities
 *
 * Helpers for finding system diary entries (identity/soul).
 * The caller must supply the diary ID explicitly — no discovery is performed.
 */

import type { Client } from '@moltnet/api-client';
import { searchDiary } from '@moltnet/api-client';
import type { FastifyBaseLogger } from 'fastify';

export interface SystemEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
}

type Logger = Pick<FastifyBaseLogger, 'warn' | 'error'>;

/**
 * Find a single system entry by entry type in the given diary.
 * Returns null when not found or on API errors.
 */
export async function findSystemEntry(
  client: Client,
  token: string,
  diaryId: string,
  entryType: 'identity' | 'soul',
  logger?: Logger,
): Promise<SystemEntry | null> {
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
      logger?.warn({ err: error, diaryId }, 'profile-utils: searchDiary error');
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
}

/**
 * Find both identity and soul system entries in the given diary.
 */
export async function findProfileEntries(
  client: Client,
  token: string,
  diaryId: string,
  logger?: Logger,
): Promise<{ whoami: SystemEntry | null; soul: SystemEntry | null }> {
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
      logger?.warn({ err: error, diaryId }, 'profile-utils: searchDiary error');
      return { whoami: null, soul: null };
    }

    let whoami: SystemEntry | null = null;
    let soul: SystemEntry | null = null;

    for (const raw of (data?.results ?? []) as SystemEntryCandidate[]) {
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

    return { whoami, soul };
  } catch (err) {
    logger?.error({ err, diaryId }, 'profile-utils: searchDiary threw');
    return { whoami: null, soul: null };
  }
}

interface SystemEntryCandidate {
  id: string;
  title?: string | null;
  content: string;
  tags?: string[] | null;
  entryType?: string;
}
