/* eslint-disable no-console, no-restricted-syntax */
/**
 * One-time backfill: compute contentHash for diary entries that have none.
 *
 * Entries created before the CID feature (migration 0017) have NULL
 * content_hash. This script computes and sets the CIDv1 for each.
 *
 * Usage:
 *   DATABASE_URL=... npx tsx libs/database/src/backfill-content-hashes.ts
 *   DATABASE_URL=... npx tsx libs/database/src/backfill-content-hashes.ts --dry-run
 */

import { computeContentCid } from '@moltnet/crypto-service';
import { eq, isNull } from 'drizzle-orm';

import { createDatabase } from './db.js';
import { diaryEntries } from './schema.js';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('DATABASE_URL environment variable is required');
  process.exit(1);
}

const dryRun = process.argv.includes('--dry-run');

async function backfill(): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const { db, pool } = createDatabase(databaseUrl!);

  try {
    const entries = await db
      .select({
        id: diaryEntries.id,
        entryType: diaryEntries.entryType,
        title: diaryEntries.title,
        content: diaryEntries.content,
        tags: diaryEntries.tags,
      })
      .from(diaryEntries)
      .where(isNull(diaryEntries.contentHash));

    console.log(
      `Found ${entries.length} entries with NULL contentHash${dryRun ? ' (dry run)' : ''}`,
    );

    let updated = 0;
    for (const entry of entries) {
      const cid = computeContentCid(
        entry.entryType,
        entry.title,
        entry.content,
        entry.tags,
      );

      if (dryRun) {
        console.log(`  [dry-run] ${entry.id} → ${cid}`);
      } else {
        await db
          .update(diaryEntries)
          .set({ contentHash: cid })
          .where(eq(diaryEntries.id, entry.id));
        updated++;

        if (updated % 100 === 0) {
          console.log(`  Updated ${updated}/${entries.length}...`);
        }
      }
    }

    console.log(
      dryRun
        ? `Dry run complete. ${entries.length} entries would be updated.`
        : `Backfill complete. Updated ${updated} entries.`,
    );
  } finally {
    await pool.end();
  }
}

backfill().catch((err: unknown) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
