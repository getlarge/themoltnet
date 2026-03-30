import type { ResolvedSelection, SelectedEntry } from './types.js';

export interface EntryFetcher {
  fetchEntries(
    diaryId: string,
    ids: string[],
  ): Promise<
    Array<{
      id: string;
      content: string;
      contentHash: string | null;
      importance: number;
      createdAt: Date;
    }>
  >;
}

export class EntryLoadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EntryLoadError';
  }
}

function normalizeSelection(entries: SelectedEntry[]): SelectedEntry[] {
  const seenEntryIds = new Set<string>();
  const seenRanks = new Set<number>();

  for (const entry of entries) {
    if (seenEntryIds.has(entry.entryId)) {
      throw new EntryLoadError(
        `Duplicate entryId "${entry.entryId}" in pack selection`,
      );
    }
    if (seenRanks.has(entry.rank)) {
      throw new EntryLoadError(
        `Duplicate rank "${entry.rank}" in pack selection`,
      );
    }
    seenEntryIds.add(entry.entryId);
    seenRanks.add(entry.rank);
  }

  return [...entries].sort((a, b) => a.rank - b.rank);
}

export async function loadSelectedEntries(
  fetcher: EntryFetcher,
  diaryId: string,
  requestedEntries: SelectedEntry[],
): Promise<ResolvedSelection[]> {
  const selectedEntries = normalizeSelection(requestedEntries);
  const rows = await fetcher.fetchEntries(
    diaryId,
    selectedEntries.map((e) => e.entryId),
  );

  if (rows.length !== selectedEntries.length) {
    const foundIds = new Set(rows.map((row) => row.id));
    const missingIds = selectedEntries
      .map((e) => e.entryId)
      .filter((id) => !foundIds.has(id));
    throw new EntryLoadError(
      `Entries not found in diary ${diaryId}: ${missingIds.join(', ')}`,
    );
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return selectedEntries.map((entry) => {
    const row = rowById.get(entry.entryId);
    if (!row) {
      throw new EntryLoadError(
        `Entry ${entry.entryId} was not found in diary ${diaryId}`,
      );
    }
    if (!row.contentHash) {
      throw new EntryLoadError(
        `Entry ${entry.entryId} has no contentHash and cannot be packed`,
      );
    }
    return { rank: entry.rank, row };
  });
}
