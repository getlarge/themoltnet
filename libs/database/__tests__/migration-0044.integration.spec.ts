import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationFolder = resolve(import.meta.dirname, '../drizzle');

describe('migration 0044 personal team uniqueness', () => {
  let pool: Pool;
  let stopContainer: () => Promise<void>;
  let oldMigrationsFolder: string;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);
    pool = new Pool({ connectionString: container.getConnectionUri() });

    oldMigrationsFolder = await mkdtemp(
      join(tmpdir(), 'moltnet-pre-0044-migrations-'),
    );
    await mkdir(join(oldMigrationsFolder, 'meta'));
    const migrationFiles = (await readdir(migrationFolder)).filter(
      (name) => name.endsWith('.sql') && !name.startsWith('0044_'),
    );
    await Promise.all(
      migrationFiles.map((name) =>
        cp(join(migrationFolder, name), join(oldMigrationsFolder, name)),
      ),
    );
    const journal = JSON.parse(
      await readFile(join(migrationFolder, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx < 44);
    await writeFile(
      join(oldMigrationsFolder, 'meta/_journal.json'),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await migrate(drizzle(pool), { migrationsFolder: oldMigrationsFolder });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await stopContainer();
    await rm(oldMigrationsFolder, { recursive: true, force: true });
  });

  it('requires explicit duplicate remediation before enforcing the indexes', async () => {
    await pool.query(`
      INSERT INTO agents (id, public_key, fingerprint)
      VALUES (
        '10000000-0000-4000-a000-000000000044',
        'ed25519:migration-0044',
        'MIGR-ATIO-N004-4001'
      );
      INSERT INTO teams (id, name, personal, creator_agent_id)
      VALUES
        (
          '20000000-0000-4000-a000-000000000044',
          'Personal team with relationships to inspect',
          true,
          '10000000-0000-4000-a000-000000000044'
        ),
        (
          '20000000-0000-4000-a000-000000000045',
          'Empty duplicate selected for remediation',
          true,
          '10000000-0000-4000-a000-000000000044'
        );
    `);

    await expect(
      migrate(drizzle(pool), { migrationsFolder: migrationFolder }),
    ).rejects.toThrow(
      'personal team uniqueness requires relationship-aware duplicate remediation',
    );

    // The migration deliberately does not guess how to merge team-owned
    // relationships. This fixture has established that the second team is
    // empty, so deleting it is a safe, relationship-aware remediation.
    await pool.query(
      `DELETE FROM teams WHERE id = '20000000-0000-4000-a000-000000000045'`,
    );
    await migrate(drizzle(pool), { migrationsFolder: migrationFolder });

    const indexes = await pool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE indexname IN (
        'teams_personal_creator_agent_idx',
        'teams_personal_creator_human_idx'
      )
      ORDER BY indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'teams_personal_creator_agent_idx',
      'teams_personal_creator_human_idx',
    ]);
  }, 120_000);
});
