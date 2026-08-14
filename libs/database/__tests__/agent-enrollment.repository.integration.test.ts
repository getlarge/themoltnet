import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createAgentEnrollmentRepository } from '../src/repositories/agent-enrollment.repository.js';
import { agentEnrollments, agents, teams } from '../src/schema.js';

describe('AgentEnrollmentRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repository: ReturnType<typeof createAgentEnrollmentRepository>;
  let stopContainer: () => Promise<void>;

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();
    stopContainer = () => container.stop().then(() => undefined);
    await runMigrations(container.getConnectionUri());
    ({ db, pool } = createDatabase(container.getConnectionUri()));
    repository = createAgentEnrollmentRepository(db);
    await db.insert(agents).values([
      {
        identityId: '00000000-0000-4000-a000-000000000001',
        publicKey: 'ed25519:issuer',
        fingerprint: '0000-0000-0000-0001',
      },
      {
        identityId: '00000000-0000-4000-a000-000000000002',
        publicKey: 'ed25519:first',
        fingerprint: '0000-0000-0000-0002',
      },
      {
        identityId: '00000000-0000-4000-a000-000000000003',
        publicKey: 'ed25519:second',
        fingerprint: '0000-0000-0000-0003',
      },
    ]);
    await db.insert(teams).values({
      id: '00000000-0000-4000-a000-000000000010',
      name: 'Enrollment team',
      personal: false,
      creatorAgentId: '00000000-0000-4000-a000-000000000001',
      status: 'active',
    });
  }, 60_000);

  afterEach(async () => {
    await db.delete(agentEnrollments);
  });

  afterAll(async () => {
    await db.delete(teams);
    await db.delete(agents);
    await pool.end();
    await stopContainer();
  });

  it('stores a hash instead of the raw token', async () => {
    const created = await repository.create({
      creator: {
        kind: 'agent',
        id: '00000000-0000-4000-a000-000000000001',
      },
      expiresAt: new Date(Date.now() + 900_000),
      teamId: '00000000-0000-4000-a000-000000000010',
    });
    expect(created.enrollment.tokenHash).not.toBe(created.token);
    expect(created.enrollment.tokenHash).toMatch(/^[a-f0-9]{64}$/);
    const [stored] = await db
      .select()
      .from(agentEnrollments)
      .where(eq(agentEnrollments.id, created.enrollment.id));
    expect(JSON.stringify(stored)).not.toContain(created.token);
  });

  it('rejects expired enrollments', async () => {
    const created = await repository.create({
      creator: {
        kind: 'agent',
        id: '00000000-0000-4000-a000-000000000001',
      },
      expiresAt: new Date(Date.now() - 1_000),
      teamId: '00000000-0000-4000-a000-000000000010',
    });
    await expect(
      repository.findPendingByTokenHash(created.enrollment.tokenHash),
    ).resolves.toBeNull();
    await expect(
      repository.redeem(
        created.enrollment.tokenHash,
        '00000000-0000-4000-a000-000000000002',
      ),
    ).resolves.toBeNull();
  });

  it('rejects revoked enrollments', async () => {
    const created = await repository.create({
      creator: {
        kind: 'agent',
        id: '00000000-0000-4000-a000-000000000001',
      },
      expiresAt: new Date(Date.now() + 900_000),
      teamId: '00000000-0000-4000-a000-000000000010',
    });
    await expect(
      repository.revoke(
        created.enrollment.id,
        '00000000-0000-4000-a000-000000000010',
      ),
    ).resolves.toMatchObject({ revokedAt: expect.any(Date) });
    await expect(
      repository.findPendingByTokenHash(created.enrollment.tokenHash),
    ).resolves.toBeNull();
    await expect(
      repository.redeem(
        created.enrollment.tokenHash,
        '00000000-0000-4000-a000-000000000002',
      ),
    ).resolves.toBeNull();
  });

  it('allows exactly one concurrent redemption winner', async () => {
    const created = await repository.create({
      creator: {
        kind: 'agent',
        id: '00000000-0000-4000-a000-000000000001',
      },
      expiresAt: new Date(Date.now() + 900_000),
      teamId: '00000000-0000-4000-a000-000000000010',
    });
    const tokenHash = created.enrollment.tokenHash;
    const [first, second] = await Promise.all([
      repository.redeem(tokenHash, '00000000-0000-4000-a000-000000000002'),
      repository.redeem(tokenHash, '00000000-0000-4000-a000-000000000003'),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });

  it('deletes enrollment history when its team is deleted', async () => {
    const teamId = '00000000-0000-4000-a000-000000000011';
    await db.insert(teams).values({
      id: teamId,
      name: 'Disposable enrollment team',
      personal: false,
      creatorAgentId: '00000000-0000-4000-a000-000000000001',
      status: 'active',
    });
    const created = await repository.create({
      creator: {
        kind: 'agent',
        id: '00000000-0000-4000-a000-000000000001',
      },
      expiresAt: new Date(Date.now() + 900_000),
      teamId,
    });

    await db.delete(teams).where(eq(teams.id, teamId));

    const enrollment = await db
      .select()
      .from(agentEnrollments)
      .where(eq(agentEnrollments.id, created.enrollment.id));
    expect(enrollment).toEqual([]);
  });
});
