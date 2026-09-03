export interface KetoSubjectSet {
  namespace: string;
  object: string;
  relation: string;
}

export interface KetoTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_id?: string;
  subject_set?: KetoSubjectSet;
}

export interface LegacySelfTupleAdapters {
  listTuples(pageToken?: string): Promise<{
    items: KetoTuple[];
    nextPageToken?: string;
  }>;
  putTuple(tuple: KetoTuple): Promise<void>;
  tupleExists(tuple: KetoTuple): Promise<boolean>;
  checkSelfPermission(tuple: KetoTuple): Promise<boolean>;
  deleteTuple(tuple: KetoTuple): Promise<void>;
}

export interface LegacySelfTupleCounts {
  pages: number;
  scanned: number;
  directSubjects: number;
  migratable: number;
  unknown: number;
  copied: number;
  verified: number;
  deleted: number;
  failed: number;
}

export interface LegacySelfTupleResult {
  counts: LegacySelfTupleCounts;
  unknown: Array<Pick<KetoTuple, 'namespace' | 'object' | 'relation'>>;
  failures: Array<{ tuple: KetoTuple; reason: string }>;
}

export type LegacySelfTupleMode = 'dry-run' | 'apply' | 'verify';

function typedReplacement(tuple: KetoTuple): KetoTuple | undefined {
  if (
    !tuple.subject_id ||
    tuple.subject_set ||
    (tuple.namespace !== 'Agent' && tuple.namespace !== 'Human') ||
    tuple.relation !== 'self' ||
    tuple.object !== tuple.subject_id
  ) {
    return undefined;
  }

  return {
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
    subject_set: {
      namespace: tuple.namespace,
      object: tuple.object,
      relation: '',
    },
  };
}

/**
 * Migrates only the two legacy typed-self tuple shapes. Unknown direct subjects
 * are intentionally reported but never mutated.
 */
export async function migrateLegacySelfTuples(
  adapters: LegacySelfTupleAdapters,
  mode: LegacySelfTupleMode,
): Promise<LegacySelfTupleResult> {
  const counts: LegacySelfTupleCounts = {
    pages: 0,
    scanned: 0,
    directSubjects: 0,
    migratable: 0,
    unknown: 0,
    copied: 0,
    verified: 0,
    deleted: 0,
    failed: 0,
  };
  const unknown: LegacySelfTupleResult['unknown'] = [];
  const failures: LegacySelfTupleResult['failures'] = [];
  const seenTokens = new Set<string>();
  let pageToken: string | undefined;

  do {
    if (pageToken) {
      if (seenTokens.has(pageToken)) {
        throw new Error('Keto returned a repeated relationship page token');
      }
      seenTokens.add(pageToken);
    }
    const page = await adapters.listTuples(pageToken);
    counts.pages++;

    for (const legacy of page.items) {
      counts.scanned++;
      if (!legacy.subject_id || legacy.subject_set) continue;
      counts.directSubjects++;
      const replacement = typedReplacement(legacy);
      if (!replacement) {
        counts.unknown++;
        unknown.push({
          namespace: legacy.namespace,
          object: legacy.object,
          relation: legacy.relation,
        });
        continue;
      }
      counts.migratable++;
      if (mode === 'dry-run') continue;

      try {
        if (mode === 'apply') {
          // A duplicate insert is intentionally accepted by the adapter: it is
          // how a resumed run proves its replacement already exists.
          await adapters.putTuple(replacement);
          counts.copied++;
        }

        const replacementExists = await adapters.tupleExists(replacement);
        const permissionWorks = await adapters.checkSelfPermission(replacement);
        if (!replacementExists || !permissionWorks) {
          throw new Error(
            `replacement verification failed (tuple=${replacementExists}, permission=${permissionWorks})`,
          );
        }
        counts.verified++;

        if (mode === 'apply') {
          // Never remove authorization until its replacement is both readable
          // and accepted by Keto's relation check endpoint.
          await adapters.deleteTuple(legacy);
          counts.deleted++;
        }
      } catch (error) {
        counts.failed++;
        failures.push({
          tuple: legacy,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    pageToken = page.nextPageToken;
  } while (pageToken);

  return { counts, unknown, failures };
}
