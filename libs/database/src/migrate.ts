import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

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

  // In source: src/ → ../drizzle/
  // In compiled dist: dist/ → ../drizzle/
  const migrationsFolder = resolve(__dirname, '..', 'drizzle');

  try {
    await migrate(db, { migrationsFolder });
  } finally {
    // Swallow pool cleanup errors so they don't mask migration failures
    await pool.end().catch(() => {});
  }
}
