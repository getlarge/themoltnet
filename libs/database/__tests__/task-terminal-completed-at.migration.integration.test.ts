import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool, PoolClient } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { agents, diaries, teams } from '../src/schema.js';

const MIGRATION_URL = new URL(
  '../drizzle/0039_uneven_rafael_vega.sql',
  import.meta.url,
);

describe('task terminal completed_at migration (integration)', () => {
  let pool: Pool;
  let stopContainer: (() => Promise<void>) | undefined;
  let migrationStatements: string[];

  const TEAM_ID = '11111111-1111-4111-8111-111111111121';
  const AGENT_ID = '22222222-2222-4222-8222-222222222222';
  const DIARY_ID = '33333333-3333-4333-8333-333333333323';

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);

    const databaseUrl = container.getConnectionUri();
    await runMigrations(databaseUrl);
    const connection = createDatabase(databaseUrl);
    pool = connection.pool;

    await connection.db.insert(agents).values({
      identityId: AGENT_ID,
      publicKey: 'ed25519:dGVzdA==',
      fingerprint: 'AAAA-BBBB-CCCC-DDDE',
    });
    await connection.db.insert(teams).values({
      id: TEAM_ID,
      name: 'terminal-migration-test-team',
      personal: true,
      creatorAgentId: AGENT_ID,
    });
    await connection.db.insert(diaries).values({
      id: DIARY_ID,
      name: 'terminal-migration-test-diary',
      creatorAgentId: AGENT_ID,
      teamId: TEAM_ID,
    });

    migrationStatements = (await readFile(MIGRATION_URL, 'utf8'))
      .split('--> statement-breakpoint')
      .map((statement) => statement.trim())
      .filter((statement) =>
        statement.startsWith('UPDATE "tasks"\nSET "completed_at"'),
      );
    expect(migrationStatements).toHaveLength(1);
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    await stopContainer?.();
  });

  async function runMigrationInTransaction(client: PoolClient): Promise<void> {
    await client.query('BEGIN');
    try {
      for (const statement of migrationStatements) {
        await client.query(statement);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }

  async function insertTerminalTask(
    client: PoolClient,
    id: string,
    createdAt: Date,
    updatedAt: Date | null,
  ): Promise<void> {
    await client.query(
      `INSERT INTO tasks (
        id, task_type, team_id, diary_id, output_kind, input,
        input_schema_cid, input_cid, proposed_by_agent_id, status,
        completed_at, created_at, updated_at
      ) VALUES ($1, 'curate_pack', $2, $3, 'artifact', '{}'::jsonb,
        'cid-schema', 'cid-input', $4, 'completed', NULL, $5, $6)`,
      [id, TEAM_ID, DIARY_ID, AGENT_ID, createdAt, updatedAt],
    );
  }

  it('backfills legacy terminal rows without imposing a rolling-deploy constraint', async () => {
    const client = await pool.connect();
    const FROM_ATTEMPT = '44444444-4444-4444-8444-444444444421';
    const FROM_UPDATED = '44444444-4444-4444-8444-444444444422';
    const FROM_CREATED = '44444444-4444-4444-8444-444444444423';
    const createdAt = new Date('2026-04-01T09:00:00Z');
    const updatedAt = new Date('2026-04-02T10:00:00Z');
    const olderAttempt = new Date('2026-04-03T11:00:00Z');
    const latestAttempt = new Date('2026-04-04T12:00:00Z');

    try {
      await client.query(
        'ALTER TABLE tasks ALTER COLUMN updated_at DROP NOT NULL',
      );
      await insertTerminalTask(client, FROM_ATTEMPT, createdAt, updatedAt);
      await insertTerminalTask(client, FROM_UPDATED, createdAt, updatedAt);
      await insertTerminalTask(client, FROM_CREATED, createdAt, null);
      await client.query(
        `INSERT INTO task_attempts (
          task_id, attempt_n, claimed_by_agent_id, workflow_id, status,
          completed_at
        ) VALUES
          ($1, 1, $2, $3, 'completed', $4),
          ($1, 2, $2, $5, 'completed', $6)`,
        [
          FROM_ATTEMPT,
          AGENT_ID,
          `task:${FROM_ATTEMPT}:attempt:1`,
          olderAttempt,
          `task:${FROM_ATTEMPT}:attempt:2`,
          latestAttempt,
        ],
      );

      await runMigrationInTransaction(client);

      const result = await client.query<{
        id: string;
        completed_at: Date;
      }>(
        `SELECT id, completed_at
         FROM tasks
         WHERE id = ANY($1::uuid[])
         ORDER BY id`,
        [[FROM_ATTEMPT, FROM_UPDATED, FROM_CREATED]],
      );
      const completedAtById = new Map(
        result.rows.map((row) => [row.id, row.completed_at]),
      );
      expect(completedAtById.get(FROM_ATTEMPT)).toEqual(latestAttempt);
      expect(completedAtById.get(FROM_UPDATED)).toEqual(updatedAt);
      expect(completedAtById.get(FROM_CREATED)).toEqual(createdAt);
    } finally {
      await client.query('DELETE FROM tasks');
      await client.query(
        'ALTER TABLE tasks ALTER COLUMN updated_at SET NOT NULL',
      );
      client.release();
    }
  });
});
