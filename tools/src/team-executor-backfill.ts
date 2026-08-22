export type TeamRoleRelation = 'owners' | 'managers' | 'executors' | 'members';

export interface TeamRoleTuple {
  namespace?: string;
  object?: string;
  relation?: string;
  subject_set?: {
    namespace?: string;
    object?: string;
    relation?: string;
  };
}

export interface TeamExecutorBackfillAdapters {
  listTuples(input: {
    relation: TeamRoleRelation;
    pageToken?: string;
  }): Promise<{ items: TeamRoleTuple[]; nextPageToken?: string }>;
  putTuple(tuple: TeamRoleTuple): Promise<void>;
  onProgress?(progress: { completed: number; total: number }): void;
}

export type BackfillMode = 'dry-run' | 'apply' | 'verify';

export async function backfillTeamExecutors(
  adapters: TeamExecutorBackfillAdapters,
  mode: BackfillMode,
) {
  const relations = new Map<TeamRoleRelation, TeamRoleTuple[]>();
  for (const relation of [
    'owners',
    'managers',
    'executors',
    'members',
  ] as const) {
    relations.set(relation, await readAll(adapters, relation));
  }

  const existing = new Set<string>();
  for (const [relation, tuples] of relations) {
    for (const tuple of tuples) {
      const key = tupleKey(tuple.object, relation, tuple.subject_set);
      if (key) existing.add(key);
    }
  }

  const expected: TeamRoleTuple[] = [];
  for (const relation of ['owners', 'managers'] as const) {
    for (const tuple of relations.get(relation) ?? []) {
      if (tuple.subject_set?.namespace !== 'Agent') continue;
      expected.push(project(tuple, 'executors'));
    }
  }
  for (const tuple of relations.get('executors') ?? []) {
    if (tuple.subject_set?.namespace !== 'Agent') continue;
    const owner = tupleKey(tuple.object, 'owners', tuple.subject_set);
    const manager = tupleKey(tuple.object, 'managers', tuple.subject_set);
    if ((owner && existing.has(owner)) || (manager && existing.has(manager))) {
      continue;
    }
    expected.push(project(tuple, 'members'));
  }

  const uniqueExpected = dedupe(expected);
  const missing = uniqueExpected.filter((tuple) => {
    const key = tupleKey(
      tuple.object,
      tuple.relation as TeamRoleRelation,
      tuple.subject_set,
    );
    return key !== null && !existing.has(key);
  });

  if (mode === 'verify' && missing.length > 0) {
    throw new Error(
      `Team executor projection verification failed: ${missing.length} tuple(s) missing`,
    );
  }
  if (mode === 'apply') {
    for (const [index, tuple] of missing.entries()) {
      await adapters.putTuple(tuple);
      adapters.onProgress?.({ completed: index + 1, total: missing.length });
    }
  }

  return {
    expected: uniqueExpected.length,
    existing: uniqueExpected.length - missing.length,
    inserted: mode === 'apply' ? missing.length : 0,
    missing,
  };
}

async function readAll(
  adapters: TeamExecutorBackfillAdapters,
  relation: TeamRoleRelation,
): Promise<TeamRoleTuple[]> {
  const items: TeamRoleTuple[] = [];
  let pageToken: string | undefined;
  do {
    const page = await adapters.listTuples({ relation, pageToken });
    items.push(...page.items);
    pageToken = page.nextPageToken;
  } while (pageToken);
  return items;
}

function project(
  tuple: TeamRoleTuple,
  relation: TeamRoleRelation,
): TeamRoleTuple {
  return {
    namespace: 'Team',
    object: tuple.object,
    relation,
    subject_set: tuple.subject_set,
  };
}

function tupleKey(
  teamId: string | undefined,
  relation: TeamRoleRelation,
  subject: TeamRoleTuple['subject_set'],
): string | null {
  if (!teamId || !subject?.namespace || !subject.object) return null;
  return `${teamId}\0${relation}\0${subject.namespace}\0${subject.object}`;
}

function dedupe(tuples: TeamRoleTuple[]): TeamRoleTuple[] {
  const byKey = new Map<string, TeamRoleTuple>();
  for (const tuple of tuples) {
    const key = tupleKey(
      tuple.object,
      tuple.relation as TeamRoleRelation,
      tuple.subject_set,
    );
    if (key) byKey.set(key, tuple);
  }
  return [...byKey.values()];
}
