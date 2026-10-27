import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createSigningRequestRepository } from '../src/repositories/signing-request.repository.js';
import { agents, signingRequests } from '../src/schema.js';

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
    await db.insert(agents).values({
      id: AGENT_ID,
      publicKey: 'ed25519:signing-request-integration',
      fingerprint: 'SIGN-REQU-ESTS-0001',
    });
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
        requesterAgentId: AGENT_ID,
        message: 'expired pending',
        expiresAt: new Date(now - 60_000),
      },
      {
        requesterAgentId: AGENT_ID,
        message: 'live pending',
        expiresAt: liveExpiry,
      },
      {
        requesterAgentId: AGENT_ID,
        message: 'completed request',
        status: 'completed',
        expiresAt: new Date(now + 60_000),
        completedAt: new Date(now - 1_000),
      },
    ]);

    const result = await repo.getActivePendingSummaryByRequester({
      kind: 'agent',
      id: AGENT_ID,
    });

    expect(result).toEqual({
      count: 1,
      earliestExpiresAt: liveExpiry,
    });
  });

  describe('findValidBySignature', () => {
    const insert = (row: {
      message: string;
      signature: string;
      valid: boolean | null;
      createdAt?: Date;
    }) =>
      db
        .insert(signingRequests)
        .values({
          agentId: AGENT_ID,
          expiresAt: new Date(Date.now() + 60_000),
          status: 'completed',
          ...row,
        })
        .returning();

    it('returns the completed request whose signature verified over the message', async () => {
      const [request] = await insert({
        message: 'bafy-hash',
        signature: 'sig',
        valid: true,
      });

      await expect(
        repo.findValidBySignature('bafy-hash', 'sig'),
      ).resolves.toMatchObject({ id: request.id });
    });

    it('ignores a request whose signature did not verify', async () => {
      await insert({ message: 'bafy-hash', signature: 'sig', valid: false });

      await expect(
        repo.findValidBySignature('bafy-hash', 'sig'),
      ).resolves.toBeNull();
    });

    it('ignores a request over a different message', async () => {
      await insert({ message: 'bafy-other', signature: 'sig', valid: true });

      await expect(
        repo.findValidBySignature('bafy-hash', 'sig'),
      ).resolves.toBeNull();
    });

    it('returns the newest of several matches', async () => {
      await insert({
        message: 'bafy-hash',
        signature: 'sig',
        valid: true,
        createdAt: new Date(Date.now() - 60_000),
      });
      const [newest] = await insert({
        message: 'bafy-hash',
        signature: 'sig',
        valid: true,
      });

      await expect(
        repo.findValidBySignature('bafy-hash', 'sig'),
      ).resolves.toMatchObject({ id: newest.id });
    });
  });
});
