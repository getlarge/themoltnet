import { readFile } from 'node:fs/promises';

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { expect, it } from 'vitest';

import { runMigrations } from '../src/migrate.js';

it('migrates existing model selections and settings without changing profile identity', async () => {
  const container = await new PostgreSqlContainer(
    'pgvector/pgvector:pg16',
  ).start();
  const pool = new Pool({
    connectionString: container.getConnectionUri(),
    max: 1,
  });
  try {
    // Also exercise the complete migration chain on an empty database.
    await runMigrations(container.getConnectionUri());
    const client = await pool.connect();
    try {
      // Temporary table shadows the migrated table only for this connection.
      await client.query(`CREATE TEMP TABLE runtime_profiles (
        provider text, model text, thinking_level text, temperature double precision,
        top_p double precision, top_k integer, max_output_tokens integer,
        revision integer, definition_cid text,
        CONSTRAINT runtime_profiles_thinking_level_valid CHECK (true),
        CONSTRAINT runtime_profiles_temperature_range CHECK (true),
        CONSTRAINT runtime_profiles_top_p_range CHECK (true),
        CONSTRAINT runtime_profiles_top_k_positive CHECK (true),
        CONSTRAINT runtime_profiles_max_output_tokens_positive CHECK (true)
      )`);
      const sql = await readFile(
        new URL('../drizzle/0050_sleepy_pride.sql', import.meta.url),
        'utf8',
      );
      const statements = sql
        .split('--> statement-breakpoint')
        .map((part) => part.trim())
        .filter((part) =>
          /^(ALTER TABLE|UPDATE) "runtime_profiles"/.test(part),
        );
      // The first statement introduces the pending classifier field; seed both
      // selections to prove the consolidation preserves either configuration.
      await client.query(statements[0]);
      await client.query(`INSERT INTO runtime_profiles VALUES
        ('chat', 'generator', 'high', 0.2, 0.9, 40, 12000, 7, 'existing-cid', '{"provider":"classifier","model":"labels"}'),
        ('custom', 'default-settings', NULL, NULL, NULL, NULL, NULL, 2, 'other-cid', NULL)`);
      for (const statement of statements.slice(1))
        await client.query(statement);
      const result = await client.query(
        'SELECT models, revision, definition_cid FROM runtime_profiles ORDER BY revision DESC',
      );
      expect(result.rows).toEqual([
        {
          models: {
            generation: {
              provider: 'chat',
              model: 'generator',
              thinkingLevel: 'high',
              temperature: 0.2,
              topP: 0.9,
              topK: 40,
              maxOutputTokens: 12000,
            },
            classification: { provider: 'classifier', model: 'labels' },
          },
          revision: 7,
          definition_cid: 'existing-cid',
        },
        {
          models: {
            generation: {
              provider: 'custom',
              model: 'default-settings',
              thinkingLevel: null,
              temperature: null,
              topP: null,
              topK: null,
              maxOutputTokens: null,
            },
          },
          revision: 2,
          definition_cid: 'other-cid',
        },
      ]);
      await expect(
        client.query("INSERT INTO runtime_profiles(models) VALUES ('{}')"),
      ).rejects.toThrow('runtime_profiles_models_nonempty');
      for (const models of [
        { generation: null },
        { classification: { provider: '', model: 'labels' } },
        { classification: { provider: 'provider' } },
        { generation: { provider: 'provider', model: 42 } },
      ]) {
        await expect(
          client.query('INSERT INTO runtime_profiles(models) VALUES ($1)', [
            models,
          ]),
        ).rejects.toThrow('runtime_profiles_model_selections_valid');
      }
      const selection = { provider: 'provider', model: 'model' };
      for (const settings of [
        { thinkingLevel: 'unsupported' },
        { temperature: -0.1 },
        { topP: 1.1 },
        { topK: 1.5 },
        { maxOutputTokens: 0 },
      ]) {
        await expect(
          client.query('INSERT INTO runtime_profiles(models) VALUES ($1)', [
            { generation: { ...selection, ...settings } },
          ]),
        ).rejects.toThrow('runtime_profiles_generation_settings_valid');
      }
      await expect(
        client.query('INSERT INTO runtime_profiles(models) VALUES ($1)', [
          { classification: selection },
        ]),
      ).resolves.toBeDefined();
      await expect(
        client.query('INSERT INTO runtime_profiles(models) VALUES ($1)', [
          {
            generation: {
              ...selection,
              thinkingLevel: null,
              temperature: 2,
              topP: 1,
              topK: 10_000,
              maxOutputTokens: 1_000_000,
            },
          },
        ]),
      ).resolves.toBeDefined();
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
    await container.stop();
  }
}, 60_000);
