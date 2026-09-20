import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { readMigrationFiles } from 'drizzle-orm/migrator';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool, type PoolClient } from 'pg';

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
    await verifyMigrationHistory(pool, migrationsFolder);
    await migrate(db, { migrationsFolder });
    await runPostMigrations(pool, migrationsFolder);
  } finally {
    // Swallow pool cleanup errors so they don't mask migration failures
    await pool.end().catch(() => {});
  }
}

/** Reject rewritten or orphaned history before Drizzle's timestamp-only check. */
async function verifyMigrationHistory(
  pool: Pool,
  folder: string,
): Promise<void> {
  const exists = await pool.query<{ ledger: string | null }>(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS ledger",
  );
  if (!exists.rows[0]?.ledger) return;
  const applied = await pool.query<{ hash: string; created_at: string }>(
    'SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1',
  );
  const latest = applied.rows[0];
  if (!latest) return;
  const migrations = readMigrationFiles({ migrationsFolder: folder });
  const expected = migrations.find(
    (migration) => migration.folderMillis === Number(latest.created_at),
  );
  if (!expected)
    throw new Error(
      'Unknown migration in database history; use the matching release or reconcile the migration ledger before migrating',
    );
  if (latest.hash !== expected.hash)
    throw new Error(
      'Applied migration hash mismatch: migration content changed; reconcile the database with its migration history before migrating',
    );
}

const sqlIdentifier = String.raw`(?:"(?:[^"\n]|"")+"|[a-z_][a-z0-9_$]*)`;
const qualifiedIdentifier = `${sqlIdentifier}(?:\\s*\\.\\s*${sqlIdentifier})?`;
const concurrentIndexPattern = new RegExp(
  `^CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+CONCURRENTLY\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${qualifiedIdentifier})\\s+ON\\s+(?:ONLY\\s+)?(${qualifiedIdentifier})(?=\\s|\\()`,
  'i',
);

async function concurrentIndex(
  client: PoolClient,
  statement: string,
): Promise<{ name: string; table: string } | null> {
  if (!/^CREATE\s+(?:UNIQUE\s+)?INDEX\s+CONCURRENTLY\b/i.test(statement))
    return null;
  const match = concurrentIndexPattern.exec(statement);
  if (!match)
    throw new Error(
      'Unsupported concurrent index declaration; use an explicit index and table name',
    );
  // PostgreSQL resolves the table's schema and identifier spelling, including
  // quoted names. An index always belongs to its table's namespace.
  const result = await client.query<{ name: string }>(
    `SELECT format('%I.%I', n.nspname, (parse_ident($2))[array_length(parse_ident($2), 1)]) AS name
     FROM pg_class t JOIN pg_namespace n ON n.oid = t.relnamespace
     WHERE t.oid = to_regclass($1)`,
    [match[2], match[1]],
  );
  if (!result.rows[0])
    throw new Error(`Concurrent index table does not exist: ${match[2]}`);
  return { name: result.rows[0].name, table: match[2] };
}

async function indexValidity(
  client: PoolClient,
  index: { name: string; table: string },
): Promise<boolean | undefined> {
  const result = await client.query<{ indisvalid: boolean }>(
    'SELECT indisvalid FROM pg_index WHERE indexrelid = to_regclass($1) AND indrelid = to_regclass($2)',
    [index.name, index.table],
  );
  return result.rows[0]?.indisvalid;
}

/** Post-commit SQL lives with its schema migration, and runs once per tag. */
export async function runPostMigrations(
  pool: Pool,
  folder: string,
): Promise<void> {
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
          const index = await concurrentIndex(client, statement);
          if (index && (await indexValidity(client, index)) === false)
            await client.query(`DROP INDEX CONCURRENTLY ${index.name}`);
          await client.query(statement);
          if (index && (await indexValidity(client, index)) !== true)
            throw new Error(`Concurrent index is not valid: ${index.name}`);
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
