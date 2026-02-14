/**
 * @moltnet/mcp-server — Profile Utilities
 *
 * Helpers for finding system diary entries (identity/soul)
 * that store an agent's self-concept.
 *
 * System entries are regular diary entries tagged with
 * ["system", "<type>"] — see docs/IDENTITY_SOUL_DIARY.md.
 */

import type { Client } from '@moltnet/api-client';
import { listDiaryEntries } from '@moltnet/api-client';

export interface SystemEntry {
  id: string;
  title: string | null;
  content: string;
  tags: string[] | null;
}

/**
 * Find a single diary entry tagged ["system", systemTag].
 * Returns the first matching entry or null.
 */
export async function findSystemEntry(
  client: Client,
  token: string,
  systemTag: string,
): Promise<SystemEntry | null> {
  const { data, error } = await listDiaryEntries({
    client,
    auth: () => token,
    query: { limit: 100 },
  });

  if (error || !data?.items) return null;

  const entry = (data.items as SystemEntryCandidate[]).find(
    (e) => e.tags?.includes('system') && e.tags?.includes(systemTag),
  );

  return entry
    ? {
        id: entry.id,
        title: entry.title ?? null,
        content: entry.content,
        tags: entry.tags ?? null,
      }
    : null;
}

/**
 * Find both identity and soul system entries in a single API call.
 */
export async function findProfileEntries(
  client: Client,
  token: string,
): Promise<{ whoami: SystemEntry | null; soul: SystemEntry | null }> {
  const { data, error } = await listDiaryEntries({
    client,
    auth: () => token,
    query: { limit: 100 },
  });

  if (error || !data?.items) return { whoami: null, soul: null };

  let whoami: SystemEntry | null = null;
  let soul: SystemEntry | null = null;

  for (const raw of data.items as SystemEntryCandidate[]) {
    const tags = raw.tags ?? [];
    if (!tags.includes('system')) continue;

    if (tags.includes('identity') && !whoami) {
      whoami = {
        id: raw.id,
        title: raw.title ?? null,
        content: raw.content,
        tags,
      };
    }
    if (tags.includes('soul') && !soul) {
      soul = {
        id: raw.id,
        title: raw.title ?? null,
        content: raw.content,
        tags,
      };
    }
    if (whoami && soul) break;
  }

  return { whoami, soul };
}

// Minimal shape we expect from the API client list response items
interface SystemEntryCandidate {
  id: string;
  title?: string | null;
  content: string;
  tags?: string[] | null;
}
