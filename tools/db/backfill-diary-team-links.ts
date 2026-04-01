/* eslint-disable no-console */
/**
 * Pre-deploy backfill: link orphaned diaries to their creator's personal team.
 *
 * Diaries created before the team-based access model (Option B) may have
 * `team_id IS NULL`. This script:
 * 1. Finds all diaries with no team_id
 * 2. Looks up each diary's creator's personal team
 * 3. Sets `diaries.team_id = personalTeamId`
 * 4. Writes Keto tuple: Diary:<diaryId>#team@Team:<personalTeamId>
 *
 * Run from the repo root so workspace dependencies resolve correctly:
 *   pnpm exec tsx tools/db/backfill-diary-team-links.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-diary-team-links.ts
 *
 * Usage (prod via Fly MPG proxy on port 15432):
 *   fly mpg proxy <cluster-id> --local-port 15432
 *   pnpm exec tsx tools/db/backfill-diary-team-links.ts --dry-run
 *   pnpm exec tsx tools/db/backfill-diary-team-links.ts
 *
 * Requires ORY_PROJECT_URL + ORY_PROJECT_API_KEY for Keto writes.
 *
 * Idempotent: skips diaries that already have a team_id.
 */

import { config } from '@dotenvx/dotenvx';
import { createDatabase, createTeamRepository } from '@moltnet/database';
import { sql } from 'drizzle-orm';

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const proxyHost =
  args.find((a) => a.startsWith('--host='))?.split('=')[1] ?? 'localhost';
const proxyPort =
  args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '15432';

// ── Resolve DATABASE_URL ─────────────────────────────────────────────────────

function resolveUrl(): string {
  const explicit = process.env.DATABASE_URL;
  if (explicit && !explicit.startsWith('encrypted:')) {
    console.log('Using DATABASE_URL from environment');
    return explicit;
  }

  config({ path: ['.env', 'env.public'], override: true });

  const decrypted = process.env.DATABASE_URL;
  if (!decrypted) {
    console.error('DATABASE_URL not found after dotenvx decryption');
    process.exit(1);
  }

  if (decrypted.startsWith('encrypted:')) {
    console.error('DATABASE_URL is still encrypted — check DOTENV_PRIVATE_KEY');
    process.exit(1);
  }

  const url = new URL(decrypted);
  url.hostname = proxyHost;
  url.port = proxyPort;
  url.searchParams.set('sslmode', 'disable');

  const rewritten = url.toString();
  console.log(
    `Rewritten DATABASE_URL: ${url.hostname}:${url.port}/${url.pathname.slice(1)}`,
  );
  return rewritten;
}

// ── Resolve Ory/Keto config ──────────────────────────────────────────────────

function resolveOry(): { url: string; headers: Record<string, string> } {
  const oryUrl = process.env.ORY_PROJECT_URL;
  const apiKey = process.env.ORY_PROJECT_API_KEY ?? process.env.ORY_API_KEY;

  if (!oryUrl || !apiKey) {
    console.error(
      'ORY_PROJECT_URL and ORY_PROJECT_API_KEY are required (loaded from env.public + .env)',
    );
    process.exit(1);
  }

  return {
    url: oryUrl,
    headers: { Authorization: `Bearer ${apiKey}` },
  };
}

// ── Keto helpers ─────────────────────────────────────────────────────────────

async function grantDiaryTeam(
  ory: ReturnType<typeof resolveOry>,
  diaryId: string,
  teamId: string,
): Promise<void> {
  const res = await fetch(`${ory.url}/admin/relation-tuples`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...ory.headers },
    body: JSON.stringify({
      namespace: 'Diary',
      object: diaryId,
      relation: 'team',
      subject_set: {
        namespace: 'Team',
        object: teamId,
        relation: '',
      },
    }),
  });
  if (!res.ok) {
    throw new Error(`Keto grant failed: ${res.status} ${await res.text()}`);
  }
}

async function verifyDiaryTeam(
  ory: ReturnType<typeof resolveOry>,
  diaryId: string,
  teamId: string,
): Promise<boolean> {
  const params = new URLSearchParams({
    namespace: 'Diary',
    object: diaryId,
    relation: 'team',
    'subject_set.namespace': 'Team',
    'subject_set.object': teamId,
    'subject_set.relation': '',
  });
  const res = await fetch(`${ory.url}/relation-tuples?${params.toString()}`, {
    headers: ory.headers,
  });
  if (!res.ok) return false;
  const data = (await res.json()) as { relation_tuples?: unknown[] };
  return (data.relation_tuples?.length ?? 0) > 0;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const databaseUrl = resolveUrl();
  const ory = resolveOry();
  const { db, pool } = createDatabase(databaseUrl);
  const teamRepo = createTeamRepository(db);

  console.log(`\nBackfill diary → team links${dryRun ? ' (DRY RUN)' : ''}\n`);

  try {
    // 1. Find diaries with no team_id
    const orphaned = await db.execute<{
      id: string;
      created_by: string;
      name: string;
    }>(sql`SELECT id, created_by, name FROM diaries WHERE team_id IS NULL`);
    const diaries = orphaned.rows;
    console.log(`Found ${diaries.length} diaries with no team_id`);

    if (diaries.length === 0) {
      console.log('Nothing to do.');
      return;
    }

    // 2. For each diary, find the creator's personal team and link
    const linked: Array<{
      diaryId: string;
      teamId: string;
      name: string;
    }> = [];
    const skipped: string[] = [];

    for (const diary of diaries) {
      const personalTeam = await teamRepo.findPersonalByCreator(
        diary.created_by,
      );

      if (!personalTeam) {
        console.error(
          `  SKIP "${diary.name}" (${diary.id}): no personal team for creator ${diary.created_by}`,
        );
        skipped.push(diary.id);
        continue;
      }

      if (dryRun) {
        console.log(
          `  [dry-run] "${diary.name}" (${diary.id}) → team ${personalTeam.id}`,
        );
        linked.push({
          diaryId: diary.id,
          teamId: personalTeam.id,
          name: diary.name,
        });
        continue;
      }

      try {
        // Update DB
        await db.execute(
          sql`UPDATE diaries SET team_id = ${personalTeam.id} WHERE id = ${diary.id}`,
        );
        // Write Keto tuple
        await grantDiaryTeam(ory, diary.id, personalTeam.id);
        linked.push({
          diaryId: diary.id,
          teamId: personalTeam.id,
          name: diary.name,
        });
        console.log(
          `  linked "${diary.name}" (${diary.id}) → team ${personalTeam.id}`,
        );
      } catch (err) {
        console.error(`  FAILED "${diary.name}" (${diary.id}): ${err}`);
      }
    }

    if (dryRun) {
      console.log(
        `\nDry run complete. ${linked.length} diaries would be linked, ${skipped.length} skipped (no personal team).`,
      );
      return;
    }

    // 3. Verify Keto tuples
    console.log(`\nVerifying ${linked.length} Keto tuples...`);
    let verified = 0;
    let verifyFailed = 0;

    for (const item of linked) {
      const ok = await verifyDiaryTeam(ory, item.diaryId, item.teamId);
      if (ok) {
        verified++;
      } else {
        console.error(
          `  ✗ Diary:${item.diaryId}#team@Team:${item.teamId} not found`,
        );
        verifyFailed++;
      }
    }

    console.log(
      `\nDone. Linked: ${linked.length}, Verified: ${verified}, Verify failures: ${verifyFailed}, Skipped: ${skipped.length}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
