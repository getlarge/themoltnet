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

/**
 * Maximum entries to fetch when scanning for system entries.
 * Client-side filtering is a V1 pragmatic choice — if an agent
 * has more than this many entries, system entries may not be found.
 * Server-side tag filtering is the proper fix (see Future Considerations
 * in docs/IDENTITY_SOUL_DIARY.md).
 */
const SYSTEM_ENTRY_SCAN_LIMIT = 100;

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
    query: { limit: SYSTEM_ENTRY_SCAN_LIMIT },
  });

  if (error || !data?.items) return null;

  const items = data.items as SystemEntryCandidate[];
  const entry = items.find(
    (e) => e.tags?.includes('system') && e.tags?.includes(systemTag),
  );

  if (!entry && items.length >= SYSTEM_ENTRY_SCAN_LIMIT) {
    // eslint-disable-next-line no-console
    console.warn(
      `[profile-utils] Scanned ${SYSTEM_ENTRY_SCAN_LIMIT} diary entries without finding ["system", "${systemTag}"]. ` +
        `The entry may exist beyond the scan window. Consider adding server-side tag filtering.`,
    );
  }

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
    query: { limit: SYSTEM_ENTRY_SCAN_LIMIT },
  });

  if (error || !data?.items) return { whoami: null, soul: null };

  let whoami: SystemEntry | null = null;
  let soul: SystemEntry | null = null;

  const items = data.items as SystemEntryCandidate[];
  for (const raw of items) {
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

  if ((!whoami || !soul) && items.length >= SYSTEM_ENTRY_SCAN_LIMIT) {
    const missing = [!whoami && 'identity', !soul && 'soul']
      .filter(Boolean)
      .join(', ');
    // eslint-disable-next-line no-console
    console.warn(
      `[profile-utils] Scanned ${SYSTEM_ENTRY_SCAN_LIMIT} diary entries without finding system entries for: ${missing}. ` +
        `They may exist beyond the scan window. Consider adding server-side tag filtering.`,
    );
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
