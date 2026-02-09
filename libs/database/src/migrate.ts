import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

function findMigrationsFolder(): string {
  // Walk up from __dirname to find the drizzle/ folder.
  // Works from both src/ (tsx dev) and dist/src/ (compiled).
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, 'drizzle');
    if (existsSync(resolve(candidate, 'meta', '_journal.json'))) {
      return candidate;
    }
    dir = dirname(dir);
  }
  // Fallback to the original relative path
  return resolve(__dirname, '..', 'drizzle');
}

/**
 * Run all pending Drizzle migrations against the given database.
 *
 * Resolves the `drizzle/` folder relative to this file so it works
 * both in source (`src/`) and compiled (`dist/`) contexts.
 */
export async function runMigrations(databaseUrl: string): Promise<void> {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 5_000,
  });
  const db = drizzle(pool);
  const migrationsFolder = findMigrationsFolder();

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    // Swallow pool cleanup errors so they don't mask migration failures
    await pool.end().catch(() => {});
  }
}
