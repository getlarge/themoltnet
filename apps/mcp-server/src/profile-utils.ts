/**
 * @moltnet/mcp-server — Profile Utilities
 *
 * Helpers for finding system diary entries (identity/soul)
 * that store an agent's self-concept.
 *
 * Uses the search endpoint with entryTypes filter — no hardcoded
 * diary reference. Searches across all of the agent's diaries.
 */

import type { Client } from '@moltnet/api-client';
import { searchDiary } from '@moltnet/api-client';

export interface SystemEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
}

/**
 * Find a single diary entry by entry type and system tag.
 * Returns the first matching entry or null.
 */
export async function findSystemEntry(
  client: Client,
  token: string,
  entryType: 'identity' | 'soul',
): Promise<SystemEntry | null> {
  const { data, error } = await searchDiary({
    client,
    auth: () => token,
    body: {
      entryTypes: [entryType],
      tags: ['system'],
      limit: 1,
    },
  });

  if (error || !data?.results?.length) return null;

  const entry = data.results[0] as SystemEntryCandidate;
  return {
    id: entry.id,
    title: entry.title ?? null,
    content: entry.content,
    tags: entry.tags ?? null,
  };
}

/**
 * Find both identity and soul system entries.
 */
export async function findProfileEntries(
  client: Client,
  token: string,
): Promise<{ whoami: SystemEntry | null; soul: SystemEntry | null }> {
  const { data, error } = await searchDiary({
    client,
    auth: () => token,
    body: {
      entryTypes: ['identity', 'soul'],
      tags: ['system'],
      limit: 10,
    },
  });

  if (error || !data?.results) return { whoami: null, soul: null };

  let whoami: SystemEntry | null = null;
  let soul: SystemEntry | null = null;

  for (const raw of data.results as SystemEntryCandidate[]) {
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
}

interface SystemEntryCandidate {
  id: string;
  title?: string | null;
  content: string;
  tags?: string[] | null;
  entryType?: string;
}
