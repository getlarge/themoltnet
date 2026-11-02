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
const HUMAN = '11000000-0000-4000-a000-000000000053';
const IDENTITY = '90000000-0000-4000-a000-000000000053';
const UNKNOWN = '90000000-0000-4000-a000-000000000054';

describe('migration 0053 internal human signer IDs', () => {
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
      join(tmpdir(), 'moltnet-pre-0053-migrations-'),
    );
    await mkdir(join(oldMigrationsFolder, 'meta'));
    const migrationFiles = (await readdir(migrationFolder)).filter(
      (name) => name.endsWith('.sql') && !name.startsWith('0053_'),
    );
    await Promise.all(
      migrationFiles.map((name) =>
        cp(join(migrationFolder, name), join(oldMigrationsFolder, name)),
      ),
    );
    const journal = JSON.parse(
      await readFile(join(migrationFolder, 'meta/_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number }> };
    journal.entries = journal.entries.filter((entry) => entry.idx < 53);
    await writeFile(
      join(oldMigrationsFolder, 'meta/_journal.json'),
      `${JSON.stringify(journal, null, 2)}\n`,
    );
    await migrate(drizzle(pool), { migrationsFolder: oldMigrationsFolder });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    await stopContainer?.();
    if (oldMigrationsFolder) {
      await rm(oldMigrationsFolder, { recursive: true, force: true });
    }
  });

  it('rewrites bound identities and refuses an unresolved active constraint', async () => {
    await pool.query(`
      INSERT INTO agents (id, public_key, fingerprint)
      VALUES ('10000000-0000-4000-a000-000000000053', 'ed25519:a', 'MIGR-ATIO-N005-3001');
      INSERT INTO humans (id, identity_id) VALUES ('${HUMAN}', '${IDENTITY}');
      INSERT INTO teams (id, name, creator_agent_id)
      VALUES ('20000000-0000-4000-a000-000000000053', 'Team',
        '10000000-0000-4000-a000-000000000053');
      INSERT INTO signing_requests (
        id, requester_agent_id, message, expires_at,
        verification_method, team_id, purpose, signer_constraint
      ) VALUES
        ('40000000-0000-4000-a000-000000000053',
         '10000000-0000-4000-a000-000000000053', 'bound', now() + interval '1 day',
         'human-hardware-previewsign',
         '20000000-0000-4000-a000-000000000053', 'Approval',
         '{"type":"human","id":"${IDENTITY}"}'),
        ('40000000-0000-4000-a000-000000000054',
         '10000000-0000-4000-a000-000000000053', 'unresolved',
         now() + interval '1 day', 'human-hardware-previewsign',
         '20000000-0000-4000-a000-000000000053', 'Approval',
         '{"type":"human","id":"${UNKNOWN}"}');
    `);

    await expect(
      migrate(drizzle(pool), { migrationsFolder: migrationFolder }),
    ).rejects.toThrow(
      'Active human signer constraints need manual ID reconciliation',
    );

    await pool.query(`
      UPDATE signing_requests SET status = 'expired'
      WHERE id = '40000000-0000-4000-a000-000000000054';
    `);
    await migrate(drizzle(pool), { migrationsFolder: migrationFolder });

    const { rows } = await pool.query<{
      id: string;
      signer_id: string;
    }>(`
      SELECT id, signer_constraint->>'id' AS signer_id
      FROM signing_requests ORDER BY id;
    `);
    expect(rows).toEqual([
      { id: '40000000-0000-4000-a000-000000000053', signer_id: HUMAN },
      { id: '40000000-0000-4000-a000-000000000054', signer_id: UNKNOWN },
    ]);
  });
});
