export interface TaskOwnershipRow {
  id: string;
  teamId: string | null;
  diaryId: string;
}

export interface KetoSubjectSet {
  namespace: string;
  object: string;
  relation: string;
}

export interface KetoTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_set: KetoSubjectSet;
}

export interface Page<T> {
  items: T[];
  nextPageToken?: string;
}

export interface TaskOwnershipBackfillAdapters {
  listTasks(cursor?: string): Promise<Page<TaskOwnershipRow>>;
  listTuples(filter: {
    namespace: 'Diary' | 'Task';
    relation: 'team' | 'writers' | 'managers';
    pageToken?: string;
  }): Promise<Page<KetoTuple>>;
  putTuple(tuple: KetoTuple): Promise<void>;
}

export interface TaskOwnershipBackfillResult {
  tasks: number;
  expected: number;
  existing: number;
  inserted: number;
  missing: KetoTuple[];
}

const CHUNK_SIZE = 100;
const BATCH_DELAY_MS = 75;

export async function backfillTaskOwnership(
  adapters: TaskOwnershipBackfillAdapters,
  mode: 'dry-run' | 'apply' | 'verify',
): Promise<TaskOwnershipBackfillResult> {
  const tasks = await collectPages((cursor) => adapters.listTasks(cursor));
  for (const task of tasks) {
    if (!task.teamId) throw new Error(`Task ${task.id} has a null team_id`);
  }

  const [teamTuples, diaryWriters, diaryManagers, taskWriters, taskManagers] =
    await Promise.all([
      collectTuples(adapters, 'Task', 'team'),
      collectTuples(adapters, 'Diary', 'writers'),
      collectTuples(adapters, 'Diary', 'managers'),
      collectTuples(adapters, 'Task', 'writers'),
      collectTuples(adapters, 'Task', 'managers'),
    ]);

  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  for (const tuple of teamTuples) {
    const task = tasksById.get(tuple.object);
    if (!task) continue;
    if (
      tuple.subject_set.namespace !== 'Team' ||
      tuple.subject_set.object !== task.teamId ||
      tuple.subject_set.relation !== ''
    ) {
      throw new Error(
        `Conflicting Task:${task.id}#team tuple: expected Team:${task.teamId}, found ${tuple.subject_set.namespace}:${tuple.subject_set.object}#${tuple.subject_set.relation}`,
      );
    }
  }

  const grantsByDiary = new Map<string, KetoTuple[]>();
  for (const tuple of [...diaryWriters, ...diaryManagers]) {
    const grants = grantsByDiary.get(tuple.object) ?? [];
    grants.push(tuple);
    grantsByDiary.set(tuple.object, grants);
  }

  const expected = new Map<string, KetoTuple>();
  for (const task of tasks) {
    addTuple(expected, {
      namespace: 'Task',
      object: task.id,
      relation: 'team',
      subject_set: { namespace: 'Team', object: task.teamId!, relation: '' },
    });
    for (const diaryGrant of grantsByDiary.get(task.diaryId) ?? []) {
      addTuple(expected, {
        namespace: 'Task',
        object: task.id,
        relation: diaryGrant.relation,
        subject_set: { ...diaryGrant.subject_set },
      });
    }
  }

  const existing = new Set(
    [...teamTuples, ...taskWriters, ...taskManagers].map(tupleKey),
  );
  const missing = [...expected.values()].filter(
    (tuple) => !existing.has(tupleKey(tuple)),
  );

  if (mode === 'verify' && missing.length > 0) {
    throw new Error(
      `Task ownership verification incomplete: ${missing.length} required tuple(s) missing`,
    );
  }

  let inserted = 0;
  if (mode === 'apply') {
    for (let offset = 0; offset < missing.length; offset += CHUNK_SIZE) {
      const chunk = missing.slice(offset, offset + CHUNK_SIZE);
      for (const tuple of chunk) {
        await adapters.putTuple(tuple);
        inserted++;
      }
      if (offset + CHUNK_SIZE < missing.length) {
        await delay(BATCH_DELAY_MS);
      }
    }
    // Verification uses a fresh, fully paginated read so concurrent bridge
    // writes and idempotent retries cannot conceal an incomplete migration.
    await backfillTaskOwnership(adapters, 'verify');
  }

  return {
    tasks: tasks.length,
    expected: expected.size,
    existing: expected.size - missing.length,
    inserted,
    missing,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function collectTuples(
  adapters: TaskOwnershipBackfillAdapters,
  namespace: 'Diary' | 'Task',
  relation: 'team' | 'writers' | 'managers',
): Promise<KetoTuple[]> {
  return collectPages((pageToken) =>
    adapters.listTuples({ namespace, relation, pageToken }),
  );
}

async function collectPages<T>(
  read: (cursor?: string) => Promise<Page<T>>,
): Promise<T[]> {
  const items: T[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  do {
    if (cursor && seen.has(cursor)) {
      throw new Error(`Pagination token repeated: ${cursor}`);
    }
    if (cursor) seen.add(cursor);
    const page = await read(cursor);
    if (!page || !Array.isArray(page.items)) {
      throw new Error('Unreadable paginated response');
    }
    items.push(...page.items);
    cursor = page.nextPageToken || undefined;
  } while (cursor);
  return items;
}

function addTuple(map: Map<string, KetoTuple>, tuple: KetoTuple): void {
  map.set(tupleKey(tuple), tuple);
}

function tupleKey(tuple: KetoTuple): string {
  const subject = tuple.subject_set;
  return `${tuple.namespace}:${tuple.object}#${tuple.relation}@${subject.namespace}:${subject.object}#${subject.relation}`;
}
