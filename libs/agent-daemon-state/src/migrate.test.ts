import { DatabaseSync } from 'node:sqlite';

import { afterEach, describe, expect, it } from 'vitest';

import { applySqliteMigrations } from './migrate.js';

describe('applySqliteMigrations', () => {
  const clients: DatabaseSync[] = [];

  afterEach(() => {
    for (const client of clients.splice(0)) {
      try {
        client.close();
      } catch {
        // already closed
      }
    }
  });

  function openMemoryDb(): DatabaseSync {
    const client = new DatabaseSync(':memory:');
    clients.push(client);
    client.exec('PRAGMA foreign_keys = ON');
    return client;
  }

  it('creates all daemon-state tables from the generated baseline', () => {
    const client = openMemoryDb();

    applySqliteMigrations(client);

    const tables = client
      .prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`,
      )
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('daemon_slots');
    expect(names).toContain('daemon_slot_sessions');
    expect(names).toContain('daemon_slot_workspaces');
  });

  it('enforces ON DELETE CASCADE from daemon_slots to dependent rows', () => {
    const client = openMemoryDb();
    applySqliteMigrations(client);

    const slotCols = `'a','anthropic','m','k'`;
    client.exec(
      `INSERT INTO daemon_slots
         (agent_name, provider, model, slot_key, task_type, state,
          last_task_id, last_attempt_n, created_at_ms, last_used_at_ms,
          expires_at_ms)
       VALUES (${slotCols}, 'freeform', 'idle', 't', 1, 0, 0, 0)`,
    );
    client.exec(
      `INSERT INTO daemon_slot_sessions
         (agent_name, provider, model, slot_key, session_dir)
       VALUES (${slotCols}, '/tmp/s')`,
    );

    client.exec(
      `DELETE FROM daemon_slots WHERE agent_name = 'a' AND provider = 'anthropic'
         AND model = 'm' AND slot_key = 'k'`,
    );

    const remaining = client
      .prepare(`SELECT COUNT(*) AS n FROM daemon_slot_sessions`)
      .get() as { n: number };
    expect(remaining.n).toBe(0);
  });

  it('rejects an invalid state value via the CHECK constraint', () => {
    const client = openMemoryDb();
    applySqliteMigrations(client);

    expect(() =>
      client.exec(
        `INSERT INTO daemon_slots
           (agent_name, provider, model, slot_key, task_type, state,
            last_task_id, last_attempt_n, created_at_ms, last_used_at_ms,
            expires_at_ms)
         VALUES ('a','p','m','k','freeform','bogus','t',1,0,0,0)`,
      ),
    ).toThrow();
  });

  it('is idempotent when applied twice', () => {
    const client = openMemoryDb();

    applySqliteMigrations(client);
    expect(() => applySqliteMigrations(client)).not.toThrow();
  });
});
