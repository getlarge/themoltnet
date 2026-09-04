import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  createRuntimeModelRepository,
  type GlobalRuntimeModelCatalogEntry,
} from '../src/repositories/runtime-models.repository.js';

const catalog: readonly GlobalRuntimeModelCatalogEntry[] = [
  {
    provider: 'anthropic',
    model: 'catalog-current',
    displayName: 'Anthropic · Current',
    description: 'Refreshed description',
    capabilities: { contextWindow: 200_000, supportsVision: true },
  },
  {
    provider: 'ollama',
    model: 'catalog-local',
    displayName: 'Ollama · Local',
    description: 'Suggestion only',
    capabilities: {},
  },
];

describe('runtime model catalog reconciliation', () => {
  let close: () => Promise<void>;
  let pool: Pool;
  let repo: ReturnType<typeof createRuntimeModelRepository>;
  let db: ReturnType<typeof createDatabase>['db'];
  const agentId = '10000000-0000-4000-a000-000000000001';
  const teamId = '20000000-0000-4000-a000-000000000001';

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    close = () => container.stop().then(() => undefined);
    const url = container.getConnectionUri();
    await runMigrations(url);
    const connection = createDatabase(url);
    db = connection.db;
    pool = connection.pool;
    repo = createRuntimeModelRepository(db);

    await repo.create({
      teamId: null,
      provider: 'anthropic',
      model: 'catalog-current',
      displayName: 'Stale name',
      description: 'Stale description',
      capabilities: {},
      isActive: false,
      createdByAgentId: null,
      createdByHumanId: null,
    });

    await db.execute(
      sql`INSERT INTO agents (identity_id, public_key, fingerprint)
       VALUES (${agentId}, 'ed25519:catalog-test', 'CATA-LOG0-0000-0001')`,
    );
    await db.execute(
      sql`INSERT INTO teams (id, name, creator_agent_id)
       VALUES (${teamId}, 'Catalog team', ${agentId})`,
    );
    await repo.create({
      teamId,
      provider: 'anthropic',
      model: 'catalog-retired',
      displayName: 'Team custom entry',
      description: null,
      capabilities: {},
      isActive: true,
      createdByAgentId: agentId,
      createdByHumanId: null,
    });
  }, 120_000);

  afterAll(async () => {
    await pool.end();
    await close();
  });

  it('is idempotent, refreshes metadata, retires removed globals, and preserves team and legacy rows', async () => {
    await repo.reconcileGlobalCatalog(catalog);
    await repo.reconcileGlobalCatalog(catalog);

    const current = await db.execute<{
      display_name: string;
      description: string;
      is_active: boolean;
    }>(
      sql`SELECT display_name, description, is_active FROM runtime_models WHERE team_id IS NULL AND provider = 'anthropic' AND model = 'catalog-current'`,
    );
    expect(current.rows).toEqual([
      {
        display_name: 'Anthropic · Current',
        description: 'Refreshed description',
        is_active: true,
      },
    ]);

    const retired = await db.execute<{ is_active: boolean }>(
      sql`SELECT is_active FROM runtime_models WHERE team_id IS NULL AND provider = 'anthropic' AND model = 'claude-sonnet-4-5'`,
    );
    expect(retired.rows).toEqual([{ is_active: false }]);

    const teamEntry = await db.execute<{ is_active: boolean }>(
      sql`SELECT is_active FROM runtime_models WHERE team_id = ${teamId} AND model = 'catalog-retired'`,
    );
    expect(teamEntry.rows).toEqual([{ is_active: true }]);

    const legacy = await db.execute<{ is_active: boolean }>(
      sql`SELECT is_active FROM runtime_models WHERE team_id IS NULL AND provider = 'openai' AND model = 'gpt-5.1'`,
    );
    expect(legacy.rows).toEqual([{ is_active: true }]);
  });
});
