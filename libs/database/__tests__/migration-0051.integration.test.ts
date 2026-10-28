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

const AGENT = '10000000-0000-4000-a000-000000000051';
const RECREATED_AGENT = '10000000-0000-4000-a000-000000000052';
const HUMAN = '11000000-0000-4000-a000-000000000051';
const AGENT_IDENTITY = '90000000-0000-4000-a000-000000000001';
const HUMAN_IDENTITY = '90000000-0000-4000-a000-000000000002';
const DEAD_AGENT_IDENTITY = '90000000-0000-4000-a000-000000000003';
const DEAD_HUMAN_IDENTITY = '90000000-0000-4000-a000-000000000004';
const DEAD_UNKNOWN_IDENTITY = '90000000-0000-4000-a000-000000000005';
const DEAD_SHARED_IDENTITY = '90000000-0000-4000-a000-000000000006';
const DEAD_REQUESTED_BY_AGENT_IDENTITY = '90000000-0000-4000-a000-000000000007';
const DEAD_SIGNER_KEY_IDENTITY = '90000000-0000-4000-a000-000000000008';
const TEAM = '20000000-0000-4000-a000-000000000051';
const DIARY = '30000000-0000-4000-a000-000000000051';

describe('migration 0051 signing request requester', () => {
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
      join(tmpdir(), 'moltnet-pre-0051-migrations-'),
    );
    await mkdir(join(oldMigrationsFolder, 'meta'));
    const migrationFiles = (await readdir(migrationFolder)).filter(
      (name) => name.endsWith('.sql') && !name.startsWith('0051_'),
    );
    await Promise.all(
      migrationFiles.map((name) =>
        cp(join(migrationFolder, name), join(oldMigrationsFolder, name)),
      ),
    );
    const journal = JSON.parse(
      await readFile(join(migrationFolder, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx < 51);
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

  it('backfills requesters from principals, then entries, and drops the rest', async () => {
    await pool.query(`
      INSERT INTO agents (id, identity_id, public_key, fingerprint) VALUES
        ('${AGENT}', '${AGENT_IDENTITY}', 'ed25519:a', 'MIGR-ATIO-N005-1001'),
        ('${RECREATED_AGENT}', NULL, 'ed25519:b', 'MIGR-ATIO-N005-1002');
      INSERT INTO humans (id, identity_id) VALUES ('${HUMAN}', '${HUMAN_IDENTITY}');
      INSERT INTO teams (id, name, creator_agent_id)
      VALUES ('${TEAM}', 'Team', '${AGENT}');
      INSERT INTO diaries (id, creator_agent_id, team_id, name, visibility)
      VALUES ('${DIARY}', '${AGENT}', '${TEAM}', 'Diary', 'private');
      INSERT INTO diary_entries (
        diary_id, content, creator_agent_id, content_hash, content_signature
      ) VALUES
        ('${DIARY}', 'signed', '${RECREATED_AGENT}', 'bafy-entry',
          'sig-dead-agent-entry'),
        -- One identity whose signatures created entries under two agents.
        ('${DIARY}', 'shared a', '${AGENT}', 'bafy-shared-a', 'sig-shared-a'),
        ('${DIARY}', 'shared b', '${RECREATED_AGENT}', 'bafy-shared-b',
          'sig-shared-b');
      INSERT INTO signing_requests (
        id, agent_id, requested_by, message, expires_at, status, signature,
        signer_public_key
      ) VALUES
        ('40000000-0000-4000-a000-000000000001', '${AGENT_IDENTITY}', NULL,
          'live agent', now(), 'completed', 'sig-1', NULL),
        ('40000000-0000-4000-a000-000000000002', '${HUMAN_IDENTITY}', NULL,
          'live human', now(), 'completed', 'sig-2', NULL),
        ('40000000-0000-4000-a000-000000000003', '${DEAD_HUMAN_IDENTITY}',
          '{"id": "${HUMAN}", "type": "human"}', 'requested_by', now(),
          'completed', 'sig-3', NULL),
        ('40000000-0000-4000-a000-000000000004', '${DEAD_AGENT_IDENTITY}', NULL,
          'used by an entry', now(), 'completed', 'sig-dead-agent-entry', NULL),
        ('40000000-0000-4000-a000-000000000005', '${DEAD_AGENT_IDENTITY}', NULL,
          'same identity, no entry', now(), 'expired', NULL, NULL),
        ('40000000-0000-4000-a000-000000000006', '${DEAD_UNKNOWN_IDENTITY}',
          NULL, 'unattributable', now(), 'completed', 'sig-6', NULL),
        ('40000000-0000-4000-a000-000000000007',
          '${DEAD_REQUESTED_BY_AGENT_IDENTITY}',
          '{"id": "${RECREATED_AGENT}", "type": "agent"}', 'requested_by agent',
          now(), 'completed', 'sig-7', NULL),
        ('40000000-0000-4000-a000-000000000008', '${DEAD_SHARED_IDENTITY}',
          NULL, 'ambiguous a', now(), 'completed', 'sig-shared-a', NULL),
        ('40000000-0000-4000-a000-000000000009', '${DEAD_SHARED_IDENTITY}',
          NULL, 'ambiguous b', now(), 'completed', 'sig-shared-b', NULL),
        ('40000000-0000-4000-a000-000000000010', '${DEAD_SHARED_IDENTITY}',
          NULL, 'ambiguous, no entry', now(), 'expired', NULL, NULL),
        ('40000000-0000-4000-a000-000000000011', '${DEAD_SIGNER_KEY_IDENTITY}',
          NULL, 'signer key', now(), 'completed', 'sig-11', 'ed25519:b'),
        -- The live identity wins over a conflicting requested_by.
        ('40000000-0000-4000-a000-000000000012', '${AGENT_IDENTITY}',
          '{"id": "${RECREATED_AGENT}", "type": "agent"}', 'precedence',
          now(), 'completed', 'sig-12', NULL);
    `);

    await migrate(drizzle(pool), { migrationsFolder: migrationFolder });

    const { rows } = await pool.query<{
      id: string;
      requester_agent_id: string | null;
      requester_human_id: string | null;
    }>(`
      SELECT id, requester_agent_id, requester_human_id
      FROM signing_requests ORDER BY id
    `);
    expect(rows).toEqual([
      {
        id: '40000000-0000-4000-a000-000000000001',
        requester_agent_id: AGENT,
        requester_human_id: null,
      },
      {
        id: '40000000-0000-4000-a000-000000000002',
        requester_agent_id: null,
        requester_human_id: HUMAN,
      },
      {
        id: '40000000-0000-4000-a000-000000000003',
        requester_agent_id: null,
        requester_human_id: HUMAN,
      },
      {
        id: '40000000-0000-4000-a000-000000000004',
        requester_agent_id: RECREATED_AGENT,
        requester_human_id: null,
      },
      {
        id: '40000000-0000-4000-a000-000000000005',
        requester_agent_id: RECREATED_AGENT,
        requester_human_id: null,
      },
      // 6 is unattributable and deleted.
      {
        id: '40000000-0000-4000-a000-000000000007',
        requester_agent_id: RECREATED_AGENT,
        requester_human_id: null,
      },
      // 8 and 9 each back one entry; 10 shares their identity, whose
      // entries have two creators, so it is deleted.
      {
        id: '40000000-0000-4000-a000-000000000008',
        requester_agent_id: AGENT,
        requester_human_id: null,
      },
      {
        id: '40000000-0000-4000-a000-000000000009',
        requester_agent_id: RECREATED_AGENT,
        requester_human_id: null,
      },
      {
        id: '40000000-0000-4000-a000-000000000011',
        requester_agent_id: RECREATED_AGENT,
        requester_human_id: null,
      },
      {
        id: '40000000-0000-4000-a000-000000000012',
        requester_agent_id: AGENT,
        requester_human_id: null,
      },
    ]);

    const columns = await pool.query<{ column_name: string }>(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'signing_requests'
        AND column_name IN ('agent_id', 'requested_by')
    `);
    expect(columns.rows).toEqual([]);

    await expect(
      pool.query(`
        INSERT INTO signing_requests (message, expires_at)
        VALUES ('no requester', now())
      `),
    ).rejects.toThrow(/signing_requests_requester_xor/);
  }, 120_000);
});
