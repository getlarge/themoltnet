/* eslint-disable no-console */
/**
 * One-time backfill: rewrite Diary Keto tuples from subject_id to subject_set.
 *
 * Diary relation tuples (owner, writers, readers) created before the
 * subject_set migration used bare `subject_id`. Permission checks now
 * require `subject_set` with Agent/Human namespace for team traversal.
 *
 * Run from the repo root so workspace dependencies resolve correctly:
 *   pnpm exec tsx tools/db/backfill-keto-subject-set.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-keto-subject-set.ts
 *
 * The script loads .env + env.public via dotenvx for ORY_PROJECT_URL
 * and ORY_PROJECT_API_KEY. No database access needed (Keto-only).
 *
 * Phases:
 * 1. List all Diary tuples with bare subject_id
 * 2. Create replacement tuples with subject_set {Agent, id, ''}
 * 3. Verify all new tuples exist
 * 4. Delete old bare subject_id tuples (only if all verified)
 * 5. Sample permission check
 *
 * Idempotent: Keto PUT is upsert. Running twice is safe.
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

const DIARY_RELATIONS = ['owner', 'writers', 'readers'];
const NAMESPACE = 'Diary';
const SUBJECT_NS = 'Agent';

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
    for (const tuple of data.relation_tuples ?? []) {
      if (tuple.subject_id && !tuple.subject_set) {
        tuples.push(tuple);
      }
    }
    pageToken = data.next_page_token || undefined;
  } while (pageToken);

  return tuples;
}

async function createTuple(tuple: RelationTuple): Promise<void> {
  const res = await fetch(`${ORY_PROJECT_URL}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify(tuple),
  });
  if (!res.ok) {
    throw new Error(
      `Create failed for ${tuple.namespace}:${tuple.object}#${tuple.relation}: ${res.status} ${await res.text()}`,
    );
  }
}

async function verifyTupleExists(tuple: RelationTuple): Promise<boolean> {
  const ss = tuple.subject_set!;
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
    'subject_set.namespace': ss.namespace,
    'subject_set.object': ss.object,
    'subject_set.relation': ss.relation,
  });
  const res = await fetch(
    `${ORY_PROJECT_URL}/relation-tuples?${params.toString()}`,
    { headers: authHeaders },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as ListResponse;
  return (data.relation_tuples?.length ?? 0) > 0;
}

async function checkPermission(
  namespace: string,
  object: string,
  relation: string,
  subjectNs: string,
  subjectId: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    namespace,
    object,
    relation,
    'subject_set.namespace': subjectNs,
    'subject_set.object': subjectId,
    'subject_set.relation': '',
  });
  const res = await fetch(`${ORY_PROJECT_URL}/check?${params.toString()}`, {
    headers: authHeaders,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { allowed: boolean };
  return data.allowed;
}

async function deleteTuple(tuple: RelationTuple): Promise<void> {
  const params = new URLSearchParams({
    namespace: tuple.namespace,
    object: tuple.object,
    relation: tuple.relation,
    subject_id: tuple.subject_id!,
  });
  const res = await fetch(
    `${ORY_PROJECT_URL}/admin/relation-tuples?${params.toString()}`,
    { method: 'DELETE', headers: authHeaders },
  );
  if (!res.ok) {
    throw new Error(`Delete failed: ${res.status} ${await res.text()}`);
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `Backfill Keto subject_id → subject_set${dryRun ? ' (DRY RUN)' : ''}`,
  );
  console.log(`Keto: ${ORY_PROJECT_URL}\n`);

  // ── Phase 1: Create all subject_set tuples ───────────────────
  const pending: Array<{ old: RelationTuple; replacement: RelationTuple }> = [];
  let totalFound = 0;

  for (const relation of DIARY_RELATIONS) {
    const tuples = await listTuples(relation);
    console.log(
      `${NAMESPACE}#${relation}: ${tuples.length} bare subject_id tuples`,
    );
    totalFound += tuples.length;

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

      if (dryRun) {
        console.log(
          `  [dry-run] ${tuple.object}#${tuple.relation}@${tuple.subject_id} → @${SUBJECT_NS}:${tuple.subject_id}`,
        );
        pending.push({ old: tuple, replacement });
        continue;
      }

      try {
        await createTuple(replacement);
        console.log(
          `  created ${tuple.object}#${tuple.relation}@${SUBJECT_NS}:${tuple.subject_id}`,
        );
        pending.push({ old: tuple, replacement });
      } catch (err) {
        console.error(
          `  FAILED to create ${tuple.object}#${tuple.relation}: ${err}`,
        );
      }
    }
  }

  if (dryRun) {
    console.log(
      `\nDry run complete. ${pending.length}/${totalFound} tuples would be migrated.`,
    );
    return;
  }

  // ── Phase 2: Verify all new tuples exist ────────────────────
  console.log(`\nVerifying ${pending.length} new tuples...`);
  const verified: typeof pending = [];
  let verifyFailed = 0;

  for (const item of pending) {
    const exists = await verifyTupleExists(item.replacement);
    if (exists) {
      verified.push(item);
    } else {
      console.error(
        `  ✗ ${item.old.object}#${item.old.relation}@${SUBJECT_NS}:${item.old.subject_id} not found after write`,
      );
      verifyFailed++;
    }
  }

  console.log(`Verified: ${verified.length} ok, ${verifyFailed} failed`);

  if (verifyFailed > 0) {
    console.error(
      '\nAborting delete phase — not all tuples verified. Old tuples preserved.',
    );
    return;
  }

  // ── Phase 3: Delete old bare subject_id tuples ──────────────
  console.log(`\nDeleting ${verified.length} old bare subject_id tuples...`);
  let deleted = 0;
  let deleteFailed = 0;

  for (const item of verified) {
    try {
      await deleteTuple(item.old);
      deleted++;
    } catch (err) {
      console.error(
        `  FAILED to delete ${item.old.object}#${item.old.relation}@${item.old.subject_id}: ${err}`,
      );
      deleteFailed++;
    }
  }

  console.log(
    `\nDone. Created: ${pending.length}, Verified: ${verified.length}, Deleted: ${deleted}, Delete failures: ${deleteFailed}`,
  );

  // ── Phase 4: Sample permission checks ───────────────────────
  if (deleted > 0) {
    console.log('\nRunning sample permission checks...');
    let checksPassed = 0;
    let checksFailed = 0;

    for (const relation of DIARY_RELATIONS) {
      const params = new URLSearchParams({ namespace: NAMESPACE, relation });
      const res = await fetch(
        `${ORY_PROJECT_URL}/relation-tuples?${params.toString()}`,
        { headers: authHeaders },
      );
      if (!res.ok) continue;
      const data = (await res.json()) as ListResponse;
      const sample = (data.relation_tuples ?? []).find(
        (t) => t.subject_set?.namespace === SUBJECT_NS,
      );
      if (!sample?.subject_set) continue;

      const allowed = await checkPermission(
        NAMESPACE,
        sample.object,
        'read',
        sample.subject_set.namespace,
        sample.subject_set.object,
      );
      if (allowed) {
        console.log(
          `  ✓ ${NAMESPACE}:${sample.object}#read via ${sample.relation} → allowed`,
        );
        checksPassed++;
      } else {
        console.error(
          `  ✗ ${NAMESPACE}:${sample.object}#read via ${sample.relation} → denied`,
        );
        checksFailed++;
      }
    }

    console.log(
      `\nPermission checks: ${checksPassed} passed, ${checksFailed} failed${checksFailed > 0 ? ' — review OPL configuration' : ''}`,
    );
  }
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
