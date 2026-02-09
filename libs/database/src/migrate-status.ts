/* eslint-disable no-console, no-restricted-syntax */
/**
 * Reports which migrations have been applied and which are pending.
 *
 * Usage:
 *   DATABASE_URL=... tsx src/migrate-status.ts
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findDrizzleMetaDir(): string {
  // Walk up from __dirname to find drizzle/meta/.
  // Works from both src/ (tsx dev) and dist/src/ (compiled).
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'drizzle', 'meta');
    if (existsSync(resolve(candidate, '_journal.json'))) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return resolve(__dirname, '..', 'drizzle', 'meta');
}

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const journalPath = resolve(findDrizzleMetaDir(), '_journal.json');
  const journal: Journal = JSON.parse(
    await readFile(journalPath, 'utf-8'),
  ) as Journal;

  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
  });

  try {
    // Check if the migrations table exists (Drizzle uses its own schema)
    const tableCheck = await pool.query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'drizzle'
          AND table_name = '__drizzle_migrations'
      ) AS exists
    `);

    const tableExists = tableCheck.rows[0]?.exists === true;

    let appliedCount = 0;
    if (tableExists) {
      const result = await pool.query(
        'SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations',
      );
      appliedCount = (result.rows[0] as { count: number }).count;
    }

    console.log(
      `Migration status (${appliedCount}/${journal.entries.length} applied):\n`,
    );

    for (const entry of journal.entries) {
      const isApplied = entry.idx < appliedCount;
      const status = isApplied ? 'applied' : 'pending';
      const marker = isApplied ? '[x]' : '[ ]';
      console.log(`  ${marker} ${entry.tag} (${status})`);
    }

    const pending = journal.entries.length - appliedCount;
    if (pending > 0) {
      console.log(
        `\n${pending} migration(s) pending. Run \`pnpm db:migrate:run\` to apply.`,
      );
    } else {
      console.log('\nAll migrations applied.');
    }
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error('Failed to check migration status:', error);
  process.exit(1);
});
