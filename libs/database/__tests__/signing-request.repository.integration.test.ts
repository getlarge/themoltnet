import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createSigningRequestRepository } from '../src/repositories/signing-request.repository.js';
import { signingRequests } from '../src/schema.js';

describe('SigningRequestRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createSigningRequestRepository>;
  let stopContainer: () => Promise<void>;

  const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);

    await runMigrations(container.getConnectionUri());
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    repo = createSigningRequestRepository(db);
  }, 60_000);

  afterEach(async () => {
    await db.delete(signingRequests);
  });

  afterAll(async () => {
    await pool?.end();
    await stopContainer?.();
  });

  it('counts only live pending requests and returns the nearest expiry', async () => {
    const now = Date.now();
    const liveExpiry = new Date(now + 120_000);
    await db.insert(signingRequests).values([
      {
        agentId: AGENT_ID,
        message: 'expired pending',
        expiresAt: new Date(now - 60_000),
      },
      {
        agentId: AGENT_ID,
        message: 'live pending',
        expiresAt: liveExpiry,
      },
      {
        agentId: AGENT_ID,
        message: 'completed request',
        status: 'completed',
        expiresAt: new Date(now + 60_000),
        completedAt: new Date(now - 1_000),
      },
    ]);

    const result = await repo.getActivePendingSummaryByAgent(AGENT_ID);

    expect(result).toEqual({
      count: 1,
      earliestExpiresAt: liveExpiry,
    });
  });
});
