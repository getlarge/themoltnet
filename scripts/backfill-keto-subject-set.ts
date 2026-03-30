/**
 * Keto Tuple Backfill: subject_id → subject_set
 *
 * Rewrites legacy Diary relation tuples that use bare `subject_id`
 * to typed `subject_set` with Agent namespace. Required after the
 * auth refactor that migrated all permission checks to subject_set.
 *
 * Usage:
 *   npx tsx scripts/backfill-keto-subject-set.ts --keto-read <url> --keto-write <url> [--dry-run]
 *
 * What it does:
 * 1. Lists all Diary tuples with bare subject_id (owner, writers, readers)
 * 2. For each tuple: creates replacement with subject_set {Agent, id, ''}
 * 3. Deletes the original bare subject_id tuple
 *
 * Idempotent: Keto PUT is upsert. Running twice is safe.
 * Reversible: swap subject_set → subject_id if needed.
 */

const KETO_READ_URL =
  process.argv.find((a) => a.startsWith('--keto-read='))?.split('=')[1] ??
  process.argv[process.argv.indexOf('--keto-read') + 1];

const KETO_WRITE_URL =
  process.argv.find((a) => a.startsWith('--keto-write='))?.split('=')[1] ??
  process.argv[process.argv.indexOf('--keto-write') + 1];

const DRY_RUN = process.argv.includes('--dry-run');

if (!KETO_READ_URL || !KETO_WRITE_URL) {
  console.error(
    'Usage: npx tsx scripts/backfill-keto-subject-set.ts --keto-read <url> --keto-write <url> [--dry-run]',
  );
  process.exit(1);
}

const DIARY_RELATIONS = ['owner', 'writers', 'readers'];
const NAMESPACE = 'Diary';
const SUBJECT_NS = 'Agent';

interface RelationTuple {
  namespace: string;
  object: string;
  relation: string;
  subject_id?: string;
  subject_set?: {
    namespace: string;
    object: string;
    relation: string;
  };
}

interface ListResponse {
  relation_tuples?: RelationTuple[];
  next_page_token?: string;
}

async function listTuples(relation: string): Promise<RelationTuple[]> {
  const tuples: RelationTuple[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      namespace: NAMESPACE,
      relation,
      ...(pageToken ? { page_token: pageToken } : {}),
    });

    const res = await fetch(
      `${KETO_READ_URL}/relation-tuples?${params.toString()}`,
    );
    if (!res.ok) {
      throw new Error(`List failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as ListResponse;
    for (const tuple of data.relation_tuples ?? []) {
      // Only collect tuples with bare subject_id (no subject_set)
      if (tuple.subject_id && !tuple.subject_set) {
        tuples.push(tuple);
      }
    }
    pageToken = data.next_page_token || undefined;
  } while (pageToken);

  return tuples;
}

async function createTuple(tuple: RelationTuple): Promise<void> {
  const res = await fetch(`${KETO_WRITE_URL}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tuple),
  });
  if (!res.ok) {
    throw new Error(
      `Create failed for ${tuple.namespace}:${tuple.object}#${tuple.relation}: ${res.status} ${await res.text()}`,
    );
  }
}

async function deleteTuple(tuple: RelationTuple): Promise<void> {
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
    subject_id: tuple.subject_id!,
  });
  const res = await fetch(
    `${KETO_WRITE_URL}/admin/relation-tuples?${params.toString()}`,
    { method: 'DELETE' },
  );
  if (!res.ok) {
    throw new Error(
      `Delete failed for ${tuple.namespace}:${tuple.object}#${tuple.relation}@${tuple.subject_id}: ${res.status} ${await res.text()}`,
    );
  }
}

async function main() {
  console.log(
    `Backfill Keto subject_id → subject_set (${DRY_RUN ? 'DRY RUN' : 'LIVE'})`,
  );
  console.log(`Read: ${KETO_READ_URL}`);
  console.log(`Write: ${KETO_WRITE_URL}`);

  let totalMigrated = 0;
  let totalSkipped = 0;

  for (const relation of DIARY_RELATIONS) {
    const tuples = await listTuples(relation);
    console.log(
      `\n${NAMESPACE}#${relation}: ${tuples.length} bare subject_id tuples`,
    );

    for (const tuple of tuples) {
      const replacement: RelationTuple = {
        namespace: tuple.namespace,
        object: tuple.object,
        relation: tuple.relation,
        subject_set: {
          namespace: SUBJECT_NS,
          object: tuple.subject_id!,
          relation: '',
        },
      };

      if (DRY_RUN) {
        console.log(
          `  [dry-run] ${tuple.object}#${tuple.relation}@${tuple.subject_id} → @${SUBJECT_NS}:${tuple.subject_id}`,
        );
        totalMigrated++;
        continue;
      }

      try {
        await createTuple(replacement);
        await deleteTuple(tuple);
        console.log(
          `  ✓ ${tuple.object}#${tuple.relation}@${tuple.subject_id} → @${SUBJECT_NS}:${tuple.subject_id}`,
        );
        totalMigrated++;
      } catch (err) {
        console.error(
          `  ✗ ${tuple.object}#${tuple.relation}@${tuple.subject_id}: ${err}`,
        );
        totalSkipped++;
      }
    }
  }

  console.log(`\nDone. Migrated: ${totalMigrated}, Skipped: ${totalSkipped}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
