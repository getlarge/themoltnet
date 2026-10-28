import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createSigningRequestRepository } from '../src/repositories/signing-request.repository.js';
import { agents, humans, signingRequests } from '../src/schema.js';

describe('SigningRequestRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createSigningRequestRepository>;
  let stopContainer: () => Promise<void>;

  const AGENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const HUMAN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

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
    await db.insert(humans).values({ id: HUMAN_ID });
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

  it('keeps agent and human requesters apart', async () => {
    const expiresAt = new Date(Date.now() + 120_000);
    await repo.create({
      requester: { kind: 'agent', id: AGENT_ID },
      message: 'agent request',
      expiresAt,
    });
    await repo.create({
      requester: { kind: 'human', id: HUMAN_ID },
      message: 'human request',
      expiresAt,
    });

    const human = { kind: 'human', id: HUMAN_ID } as const;
    const listed = await repo.list({ requester: human });
    const summary = await repo.getActivePendingSummaryByRequester(human);

    expect(listed.items.map((row) => row.message)).toEqual(['human request']);
    expect(listed.items[0]).toMatchObject({
      requesterAgentId: null,
      requesterHumanId: HUMAN_ID,
    });
    expect(summary.count).toBe(1);
  });

  it('rejects a row with both requesters or neither', async () => {
    const expiresAt = new Date(Date.now() + 120_000);

    await expect(
      db.insert(signingRequests).values({
        requesterAgentId: AGENT_ID,
        requesterHumanId: HUMAN_ID,
        message: 'both',
        expiresAt,
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'signing_requests_requester_xor',
      }),
    });
    await expect(
      db.insert(signingRequests).values({ message: 'neither', expiresAt }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        constraint: 'signing_requests_requester_xor',
      }),
    });
  });

  describe('signature lookups', () => {
    const insert = (row: {
      message: string;
      signature: string;
      valid: boolean | null;
      createdAt?: Date;
    }) =>
      db
        .insert(signingRequests)
        .values({
          requesterAgentId: AGENT_ID,
          expiresAt: new Date(Date.now() + 60_000),
          status: 'completed',
          ...row,
        })
        .returning();

    describe('findVerifiedBySignatureForMessage', () => {
      it('returns the request whose signature verified over the message', async () => {
        const [request] = await insert({
          message: 'bafy-hash',
          signature: 'sig',
          valid: true,
        });

        await expect(
          repo.findVerifiedBySignatureForMessage('bafy-hash', 'sig'),
        ).resolves.toMatchObject({ id: request.id });
      });

      it('ignores a request whose signature did not verify', async () => {
        await insert({ message: 'bafy-hash', signature: 'sig', valid: false });

        await expect(
          repo.findVerifiedBySignatureForMessage('bafy-hash', 'sig'),
        ).resolves.toBeNull();
      });

      it('ignores a request over a different message', async () => {
        await insert({ message: 'bafy-other', signature: 'sig', valid: true });

        await expect(
          repo.findVerifiedBySignatureForMessage('bafy-hash', 'sig'),
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
          repo.findVerifiedBySignatureForMessage('bafy-hash', 'sig'),
        ).resolves.toMatchObject({ id: newest.id });
      });
    });

    describe('findVerifiedBySignature', () => {
      it('ignores newer requests whose signature did not verify', async () => {
        const now = Date.now();
        const [verified] = await insert({
          message: 'bafy-hash',
          signature: 'sig',
          valid: true,
          createdAt: new Date(now - 60_000),
        });
        await insert({
          message: 'bafy-other',
          signature: 'sig',
          valid: false,
          createdAt: new Date(now - 30_000),
        });
        await insert({
          message: 'bafy-pending',
          signature: 'sig',
          valid: null,
          createdAt: new Date(now),
        });

        await expect(
          repo.findVerifiedBySignature('sig'),
        ).resolves.toMatchObject({
          id: verified.id,
        });
      });

      it('returns null when no request verified', async () => {
        await insert({ message: 'bafy-hash', signature: 'sig', valid: false });
        await insert({ message: 'bafy-hash', signature: 'sig', valid: null });

        await expect(repo.findVerifiedBySignature('sig')).resolves.toBeNull();
      });

      it('returns the newest verified request', async () => {
        await insert({
          message: 'bafy-hash',
          signature: 'sig',
          valid: true,
          createdAt: new Date(Date.now() - 60_000),
        });
        const [newest] = await insert({
          message: 'bafy-other',
          signature: 'sig',
          valid: true,
        });

        await expect(
          repo.findVerifiedBySignature('sig'),
        ).resolves.toMatchObject({
          id: newest.id,
        });
      });
    });
  });
});
