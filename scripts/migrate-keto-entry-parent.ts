#!/usr/bin/env -S npx tsx
/**
 * Keto Entry Parent Migration
 *
 * Backfills DiaryEntry#parent@Diary relation tuples in Keto for all existing
 * diary entries and removes the now-orphaned DiaryEntry#owner tuples.
 *
 * Background: entries were originally created with DiaryEntry#owner@Agent
 * tuples. After the OPL was rewritten to use a parent-based model, existing
 * entries have no parent relation, so all permission checks fail for them.
 *
 * Usage:
 *   tsx scripts/migrate-keto-entry-parent.ts
 *   tsx scripts/migrate-keto-entry-parent.ts --dry-run
 *
 * Required environment variables:
 *   DATABASE_URL        — Postgres connection string
 *   ORY_KETO_WRITE_URL  — Keto admin/write API base URL (e.g. http://localhost:4467)
 *   ORY_KETO_READ_URL   — Keto public/read API base URL  (e.g. http://localhost:4466)
 */

import { setTimeout } from 'node:timers/promises';
import { parseArgs } from 'node:util';

import { createDatabase } from '@moltnet/database';
import {
  Configuration,
  PermissionApi,
  RelationshipApi,
} from '@ory/client-fetch';
import { sql } from 'drizzle-orm';

// ── CLI Arguments ────────────────────────────────────────────

const { values: args } = parseArgs({
  options: {
    'dry-run': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
  strict: true,
  allowPositionals: false,
});

if (args.help) {
  console.log(`
Usage: tsx scripts/migrate-keto-entry-parent.ts [--dry-run]

Options:
  --dry-run   Print what would be done without making any Keto API calls
  -h, --help  Show this help message

Required environment variables:
  DATABASE_URL        Postgres connection string
  ORY_KETO_WRITE_URL  Keto admin/write API base URL
  ORY_KETO_READ_URL   Keto public/read API base URL
`);
  process.exit(0);
}

// ── Helpers ──────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

// ── Types ────────────────────────────────────────────────────

interface EntryRow {
  entry_id: string;
  diary_id: string;
  owner_id: string;
}

// ── Main ─────────────────────────────────────────────────────

async function main(): Promise<void> {
  const dryRun = args['dry-run'];

  console.log(`Keto Entry-Parent Migration`);
  console.log(`============================`);
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`);

  // Resolve env vars (only required in live mode)
  const databaseUrl = requireEnv('DATABASE_URL');
  const ketoWriteUrl = dryRun
    ? (process.env['ORY_KETO_WRITE_URL'] ?? 'http://localhost:4467')
    : requireEnv('ORY_KETO_WRITE_URL');
  const ketoReadUrl = dryRun
    ? (process.env['ORY_KETO_READ_URL'] ?? 'http://localhost:4466')
    : requireEnv('ORY_KETO_READ_URL');

  // ── Database query ──────────────────────────────────────────

  const { db, pool } = createDatabase(databaseUrl);

  let entries: EntryRow[];
  try {
    const result = await db.execute(sql`
      SELECT e.id AS entry_id, e.diary_id, d.owner_id
      FROM diary_entries e
      JOIN diaries d ON d.id = e.diary_id
      ORDER BY e.created_at
    `);
    entries = result.rows as EntryRow[];
  } finally {
    await pool.end();
  }

  console.log(`Entries found: ${entries.length}`);
  console.log(``);

  if (entries.length === 0) {
    console.log(`Nothing to do.`);
    return;
  }

  // ── Keto clients ─────────────────────────────────────────────

  const relationshipApi = new RelationshipApi(
    new Configuration({ basePath: ketoWriteUrl }),
  );
  const permissionApi = new PermissionApi(
    new Configuration({ basePath: ketoReadUrl }),
  );

  // ── Migration ────────────────────────────────────────────────

  const BATCH_SIZE = 50;
  const BATCH_DELAY_MS = 50;

  let written = 0;
  let deleted = 0;
  const failures: { index: number; entryId: string; error: string }[] = [];

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    // entries[i] is guaranteed to exist because i < entries.length
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    const { entry_id: entryId, diary_id: diaryId, owner_id: ownerId } = entry!;
    const position = i + 1;

    process.stdout.write(
      `[${position}/${entries.length}] entry=${entryId} diary=${diaryId} owner=${ownerId} ... `,
    );

    if (dryRun) {
      console.log(`skipped (dry run)`);
      written++;
      deleted++;
    } else {
      try {
        // Write parent tuple: DiaryEntry:{id}#parent@Diary:{diary_id}
        await relationshipApi.createRelationship({
          createRelationshipBody: {
            namespace: 'DiaryEntry',
            object: entryId,
            relation: 'parent',
            subject_set: {
              namespace: 'Diary',
              object: diaryId,
              relation: '',
            },
          },
        });

        // Delete old owner tuples: DiaryEntry:{id}#owner (any subject)
        await relationshipApi.deleteRelationships({
          namespace: 'DiaryEntry',
          object: entryId,
          relation: 'owner',
        });

        written++;
        deleted++;
        console.log(`done`);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${message}`);
        failures.push({ index: position, entryId, error: message });
      }
    }

    // Batch delay between batches (not after the last entry)
    if (!dryRun && position < entries.length && position % BATCH_SIZE === 0) {
      await setTimeout(BATCH_DELAY_MS);
    }
  }

  // ── Verification ─────────────────────────────────────────────

  console.log(``);
  const sampleSize = Math.min(5, entries.length);
  const sample = entries.slice(0, sampleSize);
  console.log(`Verification sample (up to 5 entries):`);

  let checksPassed = 0;
  let exitCode = 0;

  for (const {
    entry_id: entryId,
    diary_id: diaryId,
    owner_id: ownerId,
  } of sample) {
    if (dryRun) {
      console.log(`  [skipped — dry run] entry=${entryId}`);
      checksPassed++;
      continue;
    }

    try {
      const entryCheck = await permissionApi.checkPermission({
        namespace: 'DiaryEntry',
        object: entryId,
        relation: 'view',
        subjectId: ownerId,
      });

      const diaryCheck = await permissionApi.checkPermission({
        namespace: 'Diary',
        object: diaryId,
        relation: 'read',
        subjectId: ownerId,
      });

      const entryOk = entryCheck.allowed;
      const diaryOk = diaryCheck.allowed;

      if (entryOk && diaryOk) {
        console.log(
          `  ✅ entry=${entryId}  DiaryEntry.view=${entryOk}  Diary.read=${diaryOk}`,
        );
        checksPassed++;
      } else {
        console.log(
          `  ❌ entry=${entryId}  DiaryEntry.view=${entryOk}  Diary.read=${diaryOk}  <- FAIL`,
        );
        exitCode = 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  ❌ entry=${entryId}: verification error — ${message}`);
      exitCode = 1;
    }
  }

  // ── Summary ──────────────────────────────────────────────────

  console.log(``);
  console.log(
    `Done. ${written} written, ${deleted} owner tuples deleted. ${checksPassed}/${sampleSize} checks passed.`,
  );

  if (failures.length > 0) {
    console.log(``);
    console.log(`Failures (${failures.length}):`);
    for (const { index, entryId, error } of failures) {
      console.log(`  [${index}] entry_${entryId}: ${error}`);
    }
    exitCode = 1;
  }

  process.exit(exitCode);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
