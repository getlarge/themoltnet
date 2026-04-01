/* eslint-disable no-console */
/**
 * Post-deploy cleanup: delete legacy Diary Keto tuples.
 *
 * After Option B migration, diary access is governed by team membership.
 * The old per-diary Keto relations are no longer referenced by OPL:
 *   - Diary#owner   (replaced by Diary#team → Team#owners)
 *   - Diary#writers  (replaced by Diary#team → Team#members with write)
 *   - Diary#readers  (replaced by Diary#team → Team#members with read)
 *
 * This script deletes all tuples matching those relations.
 *
 * Run from the repo root:
 *   pnpm exec tsx tools/db/cleanup-legacy-diary-tuples.ts --dry-run
 *   pnpm exec tsx tools/db/cleanup-legacy-diary-tuples.ts
 *
 * Requires ORY_PROJECT_URL + ORY_PROJECT_API_KEY.
 *
 * Safe to run multiple times — deleting non-existent tuples is a no-op.
 */

import { config } from '@dotenvx/dotenvx';

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');

// ── Resolve Ory/Keto config ──────────────────────────────────────────────────

config({ path: ['.env', 'env.public'], override: true });

const ORY_PROJECT_URL = process.env.ORY_PROJECT_URL;
const ORY_API_KEY = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;

if (!ORY_PROJECT_URL || !ORY_API_KEY) {
  console.error(
    'ORY_PROJECT_URL and ORY_PROJECT_API_KEY are required.\n' +
      'Ensure .env.keys is present for dotenvx decryption.',
  );
  process.exit(1);
}

const authHeaders: Record<string, string> = {
  Authorization: `Bearer ${ORY_API_KEY}`,
};

const NAMESPACE = 'Diary';
const LEGACY_RELATIONS = ['owner', 'writers', 'readers'];

// ── Types ────────────────────────────────────────────────────────────────────

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

// ── Keto helpers ─────────────────────────────────────────────────────────────

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
      `${ORY_PROJECT_URL}/relation-tuples?${params.toString()}`,
      { headers: authHeaders },
    );
    if (!res.ok) {
      throw new Error(`List failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as ListResponse;
    tuples.push(...(data.relation_tuples ?? []));
    pageToken = data.next_page_token || undefined;
  } while (pageToken);

  return tuples;
}

async function deleteTuple(tuple: RelationTuple): Promise<void> {
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
  });

  if (tuple.subject_set) {
    params.set('subject_set.namespace', tuple.subject_set.namespace);
    params.set('subject_set.object', tuple.subject_set.object);
    params.set('subject_set.relation', tuple.subject_set.relation);
  } else if (tuple.subject_id) {
    params.set('subject_id', tuple.subject_id);
  }

  const res = await fetch(
    `${ORY_PROJECT_URL}/admin/relation-tuples?${params.toString()}`,
    { method: 'DELETE', headers: authHeaders },
  );
  if (!res.ok) {
    throw new Error(
      `Delete failed for ${tuple.object}#${tuple.relation}: ${res.status} ${await res.text()}`,
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`Cleanup legacy Diary Keto tuples${dryRun ? ' (DRY RUN)' : ''}`);
  console.log(`Keto: ${ORY_PROJECT_URL}\n`);

  let totalFound = 0;
  let totalDeleted = 0;
  let totalFailed = 0;

  for (const relation of LEGACY_RELATIONS) {
    const tuples = await listTuples(relation);
    console.log(`${NAMESPACE}#${relation}: ${tuples.length} tuples`);
    totalFound += tuples.length;

    for (const tuple of tuples) {
      const subject = tuple.subject_set
        ? `@${tuple.subject_set.namespace}:${tuple.subject_set.object}`
        : `@${tuple.subject_id}`;

      if (dryRun) {
        console.log(
          `  [dry-run] would delete ${tuple.object}#${relation}${subject}`,
        );
        continue;
      }

      try {
        await deleteTuple(tuple);
        totalDeleted++;
        console.log(`  deleted ${tuple.object}#${relation}${subject}`);
      } catch (err) {
        console.error(`  FAILED ${tuple.object}#${relation}${subject}: ${err}`);
        totalFailed++;
      }
    }
  }

  if (dryRun) {
    console.log(
      `\nDry run complete. ${totalFound} legacy tuples would be deleted.`,
    );
  } else {
    console.log(
      `\nDone. Found: ${totalFound}, Deleted: ${totalDeleted}, Failed: ${totalFailed}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
