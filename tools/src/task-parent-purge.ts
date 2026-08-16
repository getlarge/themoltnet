import type { KetoTuple, Page } from './task-ownership-backfill.js';

export interface TaskParentPurgeAdapters {
  listParentTuples(pageToken?: string): Promise<Page<KetoTuple>>;
  deleteTuples(tuples: KetoTuple[]): Promise<void>;
}

export interface TaskParentPurgeResult {
  found: number;
  deleted: number;
  remaining: KetoTuple[];
}

const CHUNK_SIZE = 100;
const BATCH_DELAY_MS = 75;

export async function purgeTaskParentRelations(
  adapters: TaskParentPurgeAdapters,
  mode: 'dry-run' | 'apply' | 'verify',
): Promise<TaskParentPurgeResult> {
  const tuples = await collectParentTuples(adapters);

  if (mode === 'verify' && tuples.length > 0) {
    throw new Error(
      `Task parent relationship verification incomplete: ${tuples.length} tuple(s) remain`,
    );
  }

  let deleted = 0;
  if (mode === 'apply') {
    for (let offset = 0; offset < tuples.length; offset += CHUNK_SIZE) {
      const batch = tuples.slice(offset, offset + CHUNK_SIZE);
      await adapters.deleteTuples(batch);
      deleted += batch.length;
      if (offset + CHUNK_SIZE < tuples.length) await delay(BATCH_DELAY_MS);
    }
    await purgeTaskParentRelations(adapters, 'verify');
  }

  return {
    found: tuples.length,
    deleted,
    remaining: mode === 'apply' ? [] : tuples,
  };
}

async function collectParentTuples(
  adapters: TaskParentPurgeAdapters,
): Promise<KetoTuple[]> {
  const tuples: KetoTuple[] = [];
  const seen = new Set<string>();
  let pageToken: string | undefined;

  do {
    if (pageToken && seen.has(pageToken)) {
      throw new Error(`Pagination token repeated: ${pageToken}`);
    }
    if (pageToken) seen.add(pageToken);
    const page = await adapters.listParentTuples(pageToken);
    if (!page || !Array.isArray(page.items)) {
      throw new Error('Unreadable Task#parent relationship page');
    }
    for (const tuple of page.items) {
      if (
        tuple.namespace !== 'Task' ||
        tuple.relation !== 'parent' ||
        tuple.subject_set.namespace !== 'Diary'
      ) {
        throw new Error('Unexpected tuple returned for Task#parent purge');
      }
      tuples.push(tuple);
    }
    pageToken = page.nextPageToken || undefined;
  } while (pageToken);

  return tuples;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
