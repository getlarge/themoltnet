/* eslint-disable no-console */
/**
 * Pre-deploy backfill: migrate Team Keto relations from singular to plural.
 *
 * The OPL was updated (Option B) to use plural relation names:
 *   owner  → owners
 *   manager → managers
 *   member  → members
 *
 * This script:
 * 1. Lists all Team tuples with relations `owner`, `manager`, `member`
 * 2. Creates replacement tuples with `owners`, `managers`, `members`
 * 3. Verifies new tuples exist
 * 4. Deletes old singular tuples (only if all verified)
 *
 * Run from the repo root:
 *   pnpm exec tsx tools/db/backfill-team-relations-plural.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-team-relations-plural.ts
 *
 * Requires ORY_PROJECT_URL + ORY_PROJECT_API_KEY.
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

const NAMESPACE = 'Team';
const SINGULAR_TO_PLURAL: Record<string, string> = {
  owner: 'owners',
  manager: 'managers',
  member: 'members',
};

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
    `${ORY_PROJECT_URL}/relation-tuples?${params.toString()}`,
    { headers: authHeaders },
  );
  if (!res.ok) return false;
  const data = (await res.json()) as ListResponse;
  return (data.relation_tuples?.length ?? 0) > 0;
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
      `Delete failed for ${tuple.namespace}:${tuple.object}#${tuple.relation}: ${res.status} ${await res.text()}`,
    );
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(
    `Backfill Team relations: singular → plural${dryRun ? ' (DRY RUN)' : ''}`,
  );
  console.log(`Keto: ${ORY_PROJECT_URL}\n`);

  // ── Phase 1: List and create plural replacements ──────────────
  const pending: Array<{ old: RelationTuple; replacement: RelationTuple }> = [];
  let totalFound = 0;

  for (const [singular, plural] of Object.entries(SINGULAR_TO_PLURAL)) {
    const tuples = await listTuples(singular);
    console.log(
      `${NAMESPACE}#${singular}: ${tuples.length} tuples → #${plural}`,
    );
    totalFound += tuples.length;

    for (const tuple of tuples) {
      const replacement: RelationTuple = {
        namespace: tuple.namespace,
        object: tuple.object,
        relation: plural,
        ...(tuple.subject_set ? { subject_set: tuple.subject_set } : {}),
        ...(tuple.subject_id ? { subject_id: tuple.subject_id } : {}),
      };

      const label = tuple.subject_set
        ? `@${tuple.subject_set.namespace}:${tuple.subject_set.object}`
        : `@${tuple.subject_id}`;

      if (dryRun) {
        console.log(
          `  [dry-run] ${tuple.object}#${singular}${label} → #${plural}`,
        );
        pending.push({ old: tuple, replacement });
        continue;
      }

      try {
        await createTuple(replacement);
        console.log(`  created ${tuple.object}#${plural}${label}`);
        pending.push({ old: tuple, replacement });
      } catch (err) {
        console.error(
          `  FAILED to create ${tuple.object}#${plural}${label}: ${err}`,
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

  // ── Phase 2: Verify all new tuples exist ──────────────────────
  console.log(`\nVerifying ${pending.length} new tuples...`);
  const verified: typeof pending = [];
  let verifyFailed = 0;

  for (const item of pending) {
    const exists = await verifyTupleExists(item.replacement);
    if (exists) {
      verified.push(item);
    } else {
      console.error(
        `  ✗ ${item.replacement.object}#${item.replacement.relation} not found after write`,
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

  // ── Phase 3: Delete old singular tuples ───────────────────────
  console.log(`\nDeleting ${verified.length} old singular tuples...`);
  let deleted = 0;
  let deleteFailed = 0;

  for (const item of verified) {
    try {
      await deleteTuple(item.old);
      deleted++;
    } catch (err) {
      console.error(
        `  FAILED to delete ${item.old.object}#${item.old.relation}: ${err}`,
      );
      deleteFailed++;
    }
  }

  console.log(
    `\nDone. Created: ${pending.length}, Verified: ${verified.length}, Deleted: ${deleted}, Delete failures: ${deleteFailed}`,
  );
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
