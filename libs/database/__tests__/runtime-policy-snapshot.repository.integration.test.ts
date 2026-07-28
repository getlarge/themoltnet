import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createRuntimePolicySnapshotRepository } from '../src/repositories/runtime-policy-snapshot.repository.js';
import { runtimePolicySnapshots } from '../src/schema.js';

describe('RuntimePolicySnapshotRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createRuntimePolicySnapshotRepository>;
  let stopContainer: () => Promise<void>;

  const snapshot = {
    hash: `sha256:${'a'.repeat(64)}`,
    schemaVersion: 'effective-policy:v1',
    runtimeKind: 'gondolin_pi',
    capabilityManifestVersion: 'gondolin_pi:v1',
    enforcement: 'enforce',
    allowedTools: ['git', 'read'],
  };

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);

    await runMigrations(container.getConnectionUri());
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    repo = createRuntimePolicySnapshotRepository(db);
  }, 60_000);

  afterEach(async () => {
    await db.delete(runtimePolicySnapshots);
  });

  afterAll(async () => {
    await pool?.end();
    await stopContainer?.();
  });

  it('reuses identical content and rejects different content at the same hash', async () => {
    const created = await repo.persist(snapshot);
    const reused = await repo.persist(snapshot);

    expect(reused).toEqual(created);
    await expect(
      repo.persist({ ...snapshot, allowedTools: ['write'] }),
    ).rejects.toThrow(/hash collision/);
    await expect(repo.findByHash(snapshot.hash)).resolves.toEqual(created);
  });
});
