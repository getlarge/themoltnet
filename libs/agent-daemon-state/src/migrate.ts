import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import type { Pool } from 'pg';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Walk up from this file to find a generated drizzle migrations folder.
 * Works from both `src/` (tsx dev) and `dist/src/` (compiled).
 */
function findMigrationsFolder(folderName: string): string {
  let dir = __dirname;
  for (let i = 0; i < 5; i++) {
    const candidate = resolve(dir, folderName);
    if (existsSync(candidate)) {
      return candidate;
    }
    dir = dirname(dir);
  }
  return resolve(__dirname, '..', folderName);
}

/** Statements in a generated drizzle SQL file are joined by this marker. */
const STATEMENT_BREAKPOINT = '--> statement-breakpoint';

function readMigrationStatements(folder: string): string[] {
  const files = readdirSync(folder)
    .filter((name) => name.endsWith('.sql'))
    .sort();
  const statements: string[] = [];
  for (const file of files) {
    const raw = readFileSync(resolve(folder, file), 'utf8');
    for (const chunk of raw.split(STATEMENT_BREAKPOINT)) {
      const trimmed = chunk.trim();
      if (trimmed.length > 0) {
        statements.push(trimmed);
      }
    }
  }
  return statements;
}

/**
 * Apply the SQLite baseline synchronously via the driver's `exec`.
 *
 * The daemon-state SQLite store is constructed synchronously (callers do not
 * await it), and the runtime driver is a `node:sqlite` `DatabaseSync` wrapped
 * in drizzle's sqlite-proxy — which has no file-based migrator. We therefore
 * apply the drizzle-kit-generated SQL ourselves: the generated file stays the
 * single source of truth, we just run it synchronously. Idempotent via a
 * tracking table so re-opening an existing DB is a no-op.
 */
export function applySqliteMigrations(
  client: DatabaseSync,
  migrationsFolder = findMigrationsFolder('drizzle-sqlite'),
): void {
  client.exec(`
    CREATE TABLE IF NOT EXISTS __daemon_state_migrations (
      statement_index INTEGER PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    )
  `);

  const appliedRow = client
    .prepare(
      `SELECT COALESCE(MAX(statement_index), -1) AS last FROM __daemon_state_migrations`,
    )
    .get() as { last: number };
  const alreadyApplied = appliedRow.last;

  const statements = readMigrationStatements(migrationsFolder);
  if (statements.length <= alreadyApplied + 1) {
    return;
  }

  client.exec('BEGIN IMMEDIATE');
  try {
    for (let i = alreadyApplied + 1; i < statements.length; i++) {
      client.exec(statements[i]);
      client
        .prepare(
          `INSERT INTO __daemon_state_migrations (statement_index, applied_at_ms)
             VALUES (?, ?)`,
        )
        .run(i, Date.now());
    }
    client.exec('COMMIT');
  } catch (error) {
    try {
      client.exec('ROLLBACK');
    } catch {
      // surface the original error
    }
    throw error;
  }
}

/**
 * Run the Postgres baseline via the standard node-postgres migrator (tracked,
 * transactional, idempotent). Mirrors `libs/database/src/migrate.ts`. Used when
 * the daemon points at a shared Postgres instance instead of a local SQLite
 * file.
 */
export async function runPgMigrations(pool: Pool): Promise<void> {
  const db = drizzle(pool);
  const migrationsFolder = findMigrationsFolder('drizzle-pg');
  await migrate(db, { migrationsFolder });
}
