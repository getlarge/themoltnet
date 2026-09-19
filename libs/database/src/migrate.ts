import { existsSync, readFileSync } from 'node:fs';
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
    await runPostMigrations(pool, migrationsFolder);
  } finally {
    // Swallow pool cleanup errors so they don't mask migration failures
    await pool.end().catch(() => {});
  }
}

/** Post-commit SQL lives with its schema migration, and runs once per tag. */
async function runPostMigrations(pool: Pool, folder: string): Promise<void> {
  const journal = JSON.parse(
    readFileSync(resolve(folder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const steps = journal.entries.flatMap(({ tag }) => {
    const sql = readFileSync(resolve(folder, `${tag}.sql`), 'utf8');
    const blocks = [
      ...sql.matchAll(/\/\* moltnet:post-commit\s+([\s\S]*?)\*\//g),
    ];
    return blocks.length
      ? [
          {
            tag,
            statements: blocks.flatMap((match) =>
              match[1]
                .split('-- moltnet:statement-breakpoint')
                .map((sql) => sql.trim())
                .filter(Boolean),
            ),
          },
        ]
      : [];
  });
  if (!steps.length) return;
  const client = await pool.connect();
  try {
    await client.query(
      "SELECT pg_advisory_lock(hashtext('moltnet:post-migrations'))",
    );
    await client.query(
      'CREATE TABLE IF NOT EXISTS drizzle.__moltnet_post_migrations (tag text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    for (const step of steps) {
      const applied = await client.query(
        'SELECT 1 FROM drizzle.__moltnet_post_migrations WHERE tag = $1',
        [step.tag],
      );
      if (applied.rowCount) continue;
      try {
        // Concurrent builds may wait for old snapshots without blocking writes.
        await client.query("SET lock_timeout = '0'");
        for (const statement of step.statements) {
          const index =
            /^CREATE INDEX CONCURRENTLY IF NOT EXISTS ([a-z_][a-z0-9_]*) /i.exec(
              statement,
            )?.[1];
          if (index) {
            const state = await client.query<{ indisvalid: boolean }>(
              'SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass($1)',
              [`public.${index}`],
            );
            if (state.rows[0] && !state.rows[0].indisvalid)
              await client.query(`DROP INDEX CONCURRENTLY public.${index}`);
          }
          await client.query(statement);
        }
        await client.query(
          'INSERT INTO drizzle.__moltnet_post_migrations (tag) VALUES ($1)',
          [step.tag],
        );
      } catch (cause) {
        throw new Error(
          `Post-migration step ${step.tag} failed; rerun migrations to resume`,
          { cause },
        );
      } finally {
        await client.query('RESET lock_timeout').catch(() => {});
      }
    }
  } finally {
    await client
      .query("SELECT pg_advisory_unlock(hashtext('moltnet:post-migrations'))")
      .catch(() => {});
    client.release(true);
  }
}
