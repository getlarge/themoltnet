import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createRuntimePolicySnapshotRepository } from '../src/repositories/runtime-policy-snapshot.repository.js';
import {
  agents,
  executorManifests,
  runtimePolicySnapshots,
  taskAttempts,
  tasks,
  teams,
} from '../src/schema.js';

function errorChainMessage(error: unknown): string {
  const messages: string[] = [];
  let current = error;
  while (current instanceof Error) {
    messages.push(current.message);
    current = current.cause;
  }
  return messages.join('\n');
}

describe('RuntimePolicySnapshotRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createRuntimePolicySnapshotRepository>;
  let stopContainer: () => Promise<void>;

  const TEAM_ID = '11111111-1111-4111-8111-111111111111';
  const AGENT_ID = '22222222-2222-4222-8222-222222222222';
  // The Kratos identity is deliberately NOT the agent id: since the
  // decoupling they are independent values, and a fixture that reuses one
  // for both cannot catch a lookup that resolves the wrong one.
  const AGENT_IDENTITY_ID = '22222222-2222-4222-8222-2222222222f2';
  const TASK_ID = '33333333-3333-4333-8333-333333333333';
  const PROFILE_ID = '44444444-4444-4444-8444-444444444444';
  const EXECUTOR_FINGERPRINT = 'bafkreiauthorityexecutor';
  const snapshot = {
    hash: `sha256:${'a'.repeat(64)}`,
    schemaVersion: 'effective-policy:v1',
    runtimeKind: 'gondolin_pi',
    enforcement: 'enforce',
    allowedTools: ['git', 'read'],
    allowedShellCommands: [{ argvPrefix: ['git', 'diff'] }],
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

    await db.insert(agents).values({
      id: AGENT_ID,
      identityId: AGENT_IDENTITY_ID,
      publicKey: 'ed25519:runtime-policy-snapshot',
      fingerprint: 'AUTH-SNAPSHOT-0001',
    });
    await db.insert(teams).values({
      id: TEAM_ID,
      name: 'runtime-policy-snapshot-test',
      personal: true,
      creatorAgentId: AGENT_ID,
    });
    await db.insert(tasks).values({
      id: TASK_ID,
      taskType: 'freeform',
      teamId: TEAM_ID,
      outputKind: 'artifact',
      input: { brief: 'test immutable task authority' },
      inputSchemaCid: 'bafkreiauthorityinputschema',
      inputCid: 'bafkreiauthorityinput',
      proposedByAgentId: AGENT_ID,
      status: 'running',
      claimAgentId: AGENT_ID,
    });
    await db.insert(executorManifests).values({
      fingerprint: EXECUTOR_FINGERPRINT,
      schemaVersion: 'moltnet:executor-manifest:v1',
      manifest: {
        schemaVersion: 'moltnet:executor-manifest:v1',
        profile: { id: PROFILE_ID },
        runtime: { kind: 'gondolin_pi' },
      },
    });
  }, 60_000);

  afterEach(async () => {
    await db.delete(taskAttempts);
    await db.delete(runtimePolicySnapshots);
  });

  afterAll(async () => {
    await db?.delete(taskAttempts);
    await db?.delete(tasks);
    await db?.delete(executorManifests);
    await db?.delete(teams);
    await db?.delete(agents);
    await pool?.end();
    await stopContainer?.();
  });

  it('reuses identical content and rejects different content at the same hash', async () => {
    const created = await repo.upsert(snapshot);
    const reused = await repo.upsert(snapshot);

    expect(reused).toEqual(created);
    await expect(
      repo.upsert({ ...snapshot, allowedTools: ['write'] }),
    ).rejects.toThrow(/hash collision/);
    await expect(
      repo.upsert({
        ...snapshot,
        allowedShellCommands: [{ argvPrefix: ['git', 'status'] }],
      }),
    ).rejects.toThrow(/hash collision/);
    await expect(repo.findByHash(snapshot.hash)).resolves.toEqual(created);
  });

  it('persists the full custom runtime-kind boundary', async () => {
    const runtimeKind = `r${'a'.repeat(99)}`;
    const created = await repo.upsert({
      ...snapshot,
      hash: `sha256:${'b'.repeat(64)}`,
      runtimeKind,
    });

    expect(created.runtimeKind).toBe(runtimeKind);
  });

  it('rejects partial attempt authority and accepts the complete immutable tuple', async () => {
    await repo.upsert(snapshot);

    try {
      await db.insert(taskAttempts).values({
        taskId: TASK_ID,
        attemptN: 1,
        claimedByAgentId: AGENT_ID,
        workflowId: `task:${TASK_ID}:attempt:1`,
        leaseId: '55555555-5555-4555-8555-555555555555',
        claimedExecutorFingerprint: EXECUTOR_FINGERPRINT,
      });
      throw new Error('Expected partial task authority to be rejected');
    } catch (error) {
      expect(errorChainMessage(error)).toMatch(
        /task_attempts_authority_binding_all_or_none/,
      );
    }

    const [created] = await db
      .insert(taskAttempts)
      .values({
        taskId: TASK_ID,
        attemptN: 1,
        claimedByAgentId: AGENT_ID,
        workflowId: `task:${TASK_ID}:attempt:1`,
        leaseId: '55555555-5555-4555-8555-555555555555',
        runtimeProfileId: PROFILE_ID,
        runtimeProfileRevision: 1,
        policySnapshotHash: snapshot.hash,
        claimedExecutorFingerprint: EXECUTOR_FINGERPRINT,
      })
      .returning();

    expect(created).toMatchObject({
      runtimeProfileId: PROFILE_ID,
      runtimeProfileRevision: 1,
      policySnapshotHash: snapshot.hash,
      claimedExecutorFingerprint: EXECUTOR_FINGERPRINT,
    });
  });
});
