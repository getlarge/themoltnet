import { DiaryEntryRepository } from '../repositories/diary-entry.repository.js';
import { DiaryRepository } from '../repositories/diary.repository.js';

interface ConsolidateInput {
  diaryId: string;
  identityId: string;
  entryIds?: string[];
}

/**
 * Consolidate diary entries into a summary. If entryIds are provided,
 * only those entries are included. Otherwise, the latest entries from
 * the diary are used.
 */
export async function consolidateEntries(
  input: ConsolidateInput,
  deps: {
    diaryRepository: DiaryRepository;
    diaryEntryRepository: DiaryEntryRepository;
  },
) {
  // Step 1: Verify the caller owns the diary
  const diary = await deps.diaryRepository.findByIdAndOwner(
    input.diaryId,
    input.identityId,
  );
  if (!diary) {
    throw new Error('Diary not found or not owned by caller');
  }

  // Step 2: Fetch entries
  // TODO: implement this step — fetch the entries to consolidate.
  // If entryIds are provided, fetch those specific entries.
  // If not, fetch the latest 50 entries from the diary.
  const entries = await fetchEntries(input, deps.diaryEntryRepository);

  // Step 3: Run consolidation (simplified)
  return {
    diaryId: input.diaryId,
    entryCount: entries.length,
    entries,
  };
}

async function fetchEntries(
  input: ConsolidateInput,
  repository: DiaryEntryRepository,
) {
  // TODO: implement
  throw new Error('Not implemented');
}
