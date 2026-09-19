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
    // These scans must run after Drizzle commits the ADD COLUMN transaction,
    // releasing its ACCESS EXCLUSIVE lock on tasks before inspecting old rows.
    const client = await pool.connect();
    try {
      await client.query(
        "SELECT pg_advisory_lock(hashtext('moltnet:project-migration'))",
      );
      await client.query("SET lock_timeout = '5s'");
      const { rows } = await client.query<{ indisvalid: boolean }>(
        "SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass('public.tasks_project_created_idx')",
      );
      // A cancelled concurrent build can leave an invalid index. Repair only
      // this migration-owned index before retrying the resumable build.
      if (rows[0] && !rows[0].indisvalid) {
        await client.query(
          'DROP INDEX CONCURRENTLY public.tasks_project_created_idx',
        );
      }
      await client.query(
        'CREATE INDEX CONCURRENTLY IF NOT EXISTS tasks_project_created_idx ON public.tasks (project_id, created_at) WHERE project_id IS NOT NULL',
      );
      await client.query(
        'ALTER TABLE public.tasks VALIDATE CONSTRAINT tasks_project_id_projects_id_fk',
      );
    } finally {
      try {
        await client.query('RESET lock_timeout');
        await client.query(
          "SELECT pg_advisory_unlock(hashtext('moltnet:project-migration'))",
        );
      } finally {
        client.release();
      }
    }
  } finally {
    // Swallow pool cleanup errors so they don't mask migration failures
    await pool.end().catch(() => {});
  }
}
