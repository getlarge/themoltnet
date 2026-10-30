/**
 * Integration tests for `upsertByFingerprint`, which registration calls before
 * a Kratos identity exists.
 *
 * These need a real database: the behaviour under test is what Postgres does
 * on a unique-constraint conflict, which a mock cannot reproduce.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  AgentFingerprintConflictError,
  createAgentRepository,
} from '../src/repositories/agent.repository.js';

let db: Database;
let pool: Pool;
let stopContainer: () => Promise<void>;

beforeAll(async () => {
  const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('moltnet')
    .withUsername('moltnet')
    .withPassword('moltnet_secret')
    .start();
  stopContainer = () => container.stop().then(() => undefined);
  const databaseUrl = container.getConnectionUri();
  await runMigrations(databaseUrl);
  ({ db, pool } = createDatabase(databaseUrl));
}, 120_000);

afterAll(async () => {
  await pool.end();
  await stopContainer();
});

describe('AgentRepository — upsertByFingerprint (integration)', () => {
  const KEY_A = 'ed25519:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
  const KEY_B = 'ed25519:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=';

  it('creates a new agent and reports it as created', async () => {
    const repo = createAgentRepository(db);
    const result = await repo.upsertByFingerprint({
      publicKey: KEY_A,
      fingerprint: 'AAAA-0000-0000-0001',
    });

    expect(result.created).toBe(true);
    expect(result.agent.id).toEqual(expect.any(String));
    // The identity is bound later, by a separate step.
    expect(result.agent.identityId).toBeNull();
  });

  it('is idempotent for a genuine retry and reports it as not created', async () => {
    const repo = createAgentRepository(db);
    const first = await repo.upsertByFingerprint({
      publicKey: KEY_A,
      fingerprint: 'AAAA-0000-0000-0002',
    });
    const second = await repo.upsertByFingerprint({
      publicKey: KEY_A,
      fingerprint: 'AAAA-0000-0000-0002',
    });

    expect(second.agent.id).toBe(first.agent.id);
    // `created` is what compensation keys on: a retry that resolves an
    // existing agent must not tear that agent's resources down.
    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
  });

  it('rejects a different key claiming an existing fingerprint', async () => {
    const repo = createAgentRepository(db);
    const original = await repo.upsertByFingerprint({
      publicKey: KEY_A,
      fingerprint: 'AAAA-0000-0000-0003',
    });

    // The fingerprint is a 64-bit display form, so a collision is
    // birthday-attackable. Accepting one would transfer this agent's durable
    // id, its Keto grants and its deterministic OAuth2 client secret to the
    // presented key.
    await expect(
      repo.upsertByFingerprint({
        publicKey: KEY_B,
        fingerprint: 'AAAA-0000-0000-0003',
      }),
    ).rejects.toBeInstanceOf(AgentFingerprintConflictError);

    const unchanged = await repo.findById(original.agent.id);
    expect(unchanged?.publicKey).toBe(KEY_A);
  });
});
