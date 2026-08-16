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

import { runMigrations } from '../src/migrate.js';

const migrationFolder = resolve(import.meta.dirname, '../drizzle');

describe('migration 0039 workflow invariants', () => {
  let cleanPool: Pool;
  let duplicatePool: Pool;
  let stopContainer: () => Promise<void>;
  let oldMigrationsFolder: string;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);

    const cleanUrl = container.getConnectionUri();
    await runMigrations(cleanUrl);
    cleanPool = new Pool({ connectionString: cleanUrl });

    await cleanPool.query('CREATE DATABASE duplicate_seed');
    const duplicateUrl = new URL(cleanUrl);
    duplicateUrl.pathname = '/duplicate_seed';
    duplicatePool = new Pool({ connectionString: duplicateUrl.toString() });

    oldMigrationsFolder = await mkdtemp(
      join(tmpdir(), 'moltnet-old-migrations-'),
    );
    await mkdir(join(oldMigrationsFolder, 'meta'));
    const migrationFiles = (await readdir(migrationFolder)).filter(
      (name) => name.endsWith('.sql') && !name.startsWith('0039_'),
    );
    await Promise.all(
      migrationFiles.map((name) =>
        cp(join(migrationFolder, name), join(oldMigrationsFolder, name)),
      ),
    );
    const journal = JSON.parse(
      await readFile(join(migrationFolder, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx < 39);
    await writeFile(
      join(oldMigrationsFolder, 'meta/_journal.json'),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await migrate(drizzle(duplicatePool), {
      migrationsFolder: oldMigrationsFolder,
    });

    await duplicatePool.query(`
      INSERT INTO agents (identity_id, public_key, fingerprint)
      VALUES (
        '10000000-0000-4000-a000-000000000001',
        'ed25519:migration-test',
        'MIGR-ATIO-N003-9001'
      );
      INSERT INTO teams (id, name, creator_agent_id)
      VALUES
        (
          '20000000-0000-4000-a000-000000000001',
          'Source',
          '10000000-0000-4000-a000-000000000001'
        ),
        (
          '20000000-0000-4000-a000-000000000002',
          'Destination',
          '10000000-0000-4000-a000-000000000001'
        );
      INSERT INTO diaries (
        id, creator_agent_id, team_id, name, visibility
      ) VALUES (
        '30000000-0000-4000-a000-000000000001',
        '10000000-0000-4000-a000-000000000001',
        '20000000-0000-4000-a000-000000000001',
        'Migration diary',
        'private'
      );
      INSERT INTO diary_transfers (
        id,
        diary_id,
        source_team_id,
        destination_team_id,
        workflow_id,
        status,
        initiated_by,
        expires_at,
        created_at
      ) VALUES
        (
          '40000000-0000-4000-a000-000000000001',
          '30000000-0000-4000-a000-000000000001',
          '20000000-0000-4000-a000-000000000001',
          '20000000-0000-4000-a000-000000000002',
          'migration-oldest',
          'pending',
          '10000000-0000-4000-a000-000000000001',
          now() + interval '1 day',
          '2026-01-01T00:00:00Z'
        ),
        (
          '40000000-0000-4000-a000-000000000002',
          '30000000-0000-4000-a000-000000000001',
          '20000000-0000-4000-a000-000000000001',
          '20000000-0000-4000-a000-000000000002',
          'migration-newer',
          'pending',
          '10000000-0000-4000-a000-000000000001',
          now() + interval '1 day',
          '2026-01-02T00:00:00Z'
        );
    `);

    await migrate(drizzle(duplicatePool), {
      migrationsFolder: migrationFolder,
    });
  }, 120_000);

  afterAll(async () => {
    await Promise.all([cleanPool.end(), duplicatePool.end()]);
    await stopContainer();
    await rm(oldMigrationsFolder, { recursive: true, force: true });
  });

  it('applies cleanly with task idempotency columns and partial indexes', async () => {
    const columns = await cleanPool.query<{ column_name: string }>(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'tasks'
        AND column_name IN ('idempotency_key_hash', 'idempotency_request_cid')
      ORDER BY column_name
    `);
    expect(columns.rows.map((row) => row.column_name)).toEqual([
      'idempotency_key_hash',
      'idempotency_request_cid',
    ]);

    const indexes = await cleanPool.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE indexname IN (
        'diary_transfers_one_pending_per_diary_idx',
        'tasks_agent_idempotency_idx',
        'tasks_human_idempotency_idx'
      )
      ORDER BY indexname
    `);
    expect(indexes.rows.map((row) => row.indexname)).toEqual([
      'diary_transfers_one_pending_per_diary_idx',
      'tasks_agent_idempotency_idx',
      'tasks_human_idempotency_idx',
    ]);
  });

  it('preserves the oldest pending transfer and rejects newer duplicates', async () => {
    const transfers = await duplicatePool.query<{
      workflow_id: string;
      status: string;
      resolved_at: Date | null;
    }>(`
      SELECT workflow_id, status, resolved_at
      FROM diary_transfers
      ORDER BY created_at, id
    `);

    expect(transfers.rows).toEqual([
      {
        workflow_id: 'migration-oldest',
        status: 'pending',
        resolved_at: null,
      },
      {
        workflow_id: 'migration-newer',
        status: 'rejected',
        resolved_at: expect.any(Date),
      },
    ]);
  });

  it('rejects a second pending transfer after the migration', async () => {
    await expect(
      duplicatePool.query(`
        INSERT INTO diary_transfers (
          diary_id,
          source_team_id,
          destination_team_id,
          workflow_id,
          initiated_by,
          expires_at
        ) VALUES (
          '30000000-0000-4000-a000-000000000001',
          '20000000-0000-4000-a000-000000000001',
          '20000000-0000-4000-a000-000000000002',
          'migration-conflict',
          '10000000-0000-4000-a000-000000000001',
          now() + interval '1 day'
        )
      `),
    ).rejects.toMatchObject({
      code: '23505',
      constraint: 'diary_transfers_one_pending_per_diary_idx',
    });
  });
});
