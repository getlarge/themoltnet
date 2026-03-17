/* eslint-disable no-console */
/**
 * One-time backfill: compute contentHash for diary entries that have none.
 *
 * Entries created before the CID feature (migration 0017) have NULL
 * content_hash. This script computes and sets the CIDv1 for each.
 *
 * Usage (local Docker):
 *   DATABASE_URL=postgres://moltnet:...@localhost:5432/moltnet npx tsx tools/db/backfill-content-hashes.ts --dry-run
 *
 * Usage (prod via fly mpg proxy on port 15432):
 *   npx tsx tools/db/backfill-content-hashes.ts --dry-run
 *   npx tsx tools/db/backfill-content-hashes.ts
 *
 * The script loads .env via dotenvx and rewrites DATABASE_URL to point
 * at localhost:15432 (fly mpg proxy). Override with --port and --host.
 */

import { config } from '@dotenvx/dotenvx';
import { computeContentCid } from '@moltnet/crypto-service';
import { createDatabase, diaryEntries } from '@moltnet/database';
import { eq, isNull } from 'drizzle-orm';

// ── Parse args ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const proxyHost =
  args.find((a) => a.startsWith('--host='))?.split('=')[1] ?? 'localhost';
const proxyPort =
  args.find((a) => a.startsWith('--port='))?.split('=')[1] ?? '15432';

// ── Resolve DATABASE_URL ─────────────────────────────────────────────────────

function resolveUrl(): string {
  // If DATABASE_URL is explicitly set and not encrypted, use it directly
  const explicit = process.env.DATABASE_URL;
  if (explicit && !explicit.startsWith('encrypted:')) {
    console.log('Using DATABASE_URL from environment');
    return explicit;
  }

  // Load encrypted .env via dotenvx
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

  // Rewrite host/port to point at local fly mpg proxy
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

// ── Backfill ─────────────────────────────────────────────────────────────────

async function backfill(): Promise<void> {
  const databaseUrl = resolveUrl();
  const { db, pool } = createDatabase(databaseUrl);

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
