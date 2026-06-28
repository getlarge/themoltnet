/**
 * TaskArtifactRepository Integration Tests
 *
 * Exercises the unique `(team_id, task_id, attempt_n, cid)` constraint and
 * repository fallback against real Postgres so duplicate upload behavior stays
 * aligned with the migration-backed schema.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import { createTaskArtifactRepository } from '../src/repositories/task-artifact.repository.js';
import {
  agents,
  diaries,
  taskArtifacts,
  taskAttempts,
  tasks,
  teams,
} from '../src/schema.js';

describe('TaskArtifactRepository (integration)', () => {
  let db: Database;
  let pool: Pool;
  let repo: ReturnType<typeof createTaskArtifactRepository>;
  let stopContainer: () => Promise<void>;

  const TEAM_ID = '11111111-1111-4111-8111-111111111181';
  const AGENT_ID = '22222222-2222-4222-8222-222222222282';
  const DIARY_ID = '33333333-3333-4333-8333-333333333383';
  const TASK_ID = '44444444-4444-4444-8444-444444444484';

  beforeAll(async () => {
    const container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
      .withDatabase('moltnet')
      .withUsername('moltnet')
      .withPassword('moltnet_secret')
      .start();

    const databaseUrl = container.getConnectionUri();
    stopContainer = () => container.stop().then(() => undefined);

    await runMigrations(databaseUrl);
    ({ db, pool } = createDatabase(databaseUrl));
    repo = createTaskArtifactRepository(db);

    await db.insert(agents).values({
      identityId: AGENT_ID,
      publicKey: 'ed25519:task-artifacts',
      fingerprint: 'TASK-ARTIFACTS-0001',
    });
    await db.insert(teams).values({
      id: TEAM_ID,
      name: 'task-artifact-test-team',
      personal: true,
      creatorAgentId: AGENT_ID,
    });
    await db.insert(diaries).values({
      id: DIARY_ID,
      name: 'task-artifact-test-diary',
      creatorAgentId: AGENT_ID,
      teamId: TEAM_ID,
    });
    await db.insert(tasks).values({
      id: TASK_ID,
      taskType: 'freeform',
      teamId: TEAM_ID,
      diaryId: DIARY_ID,
      outputKind: 'artifact',
      input: { brief: 'persist artifacts' },
      inputSchemaCid: 'cid-placeholder-input-schema',
      inputCid: 'cid-placeholder-input',
      proposedByAgentId: AGENT_ID,
      status: 'running',
      claimAgentId: AGENT_ID,
      maxAttempts: 2,
    });
    await db.insert(taskAttempts).values([
      {
        taskId: TASK_ID,
        attemptN: 1,
        claimedByAgentId: AGENT_ID,
        workflowId: `task:${TASK_ID}:attempt:1`,
        status: 'running',
      },
      {
        taskId: TASK_ID,
        attemptN: 2,
        claimedByAgentId: AGENT_ID,
        workflowId: `task:${TASK_ID}:attempt:2`,
        status: 'running',
      },
    ]);
  }, 60_000);

  afterEach(async () => {
    await db.delete(taskArtifacts);
  });

  afterAll(async () => {
    if (db) {
      await db.delete(taskArtifacts);
      await db.delete(taskAttempts);
      await db.delete(tasks);
      await db.delete(diaries);
      await db.delete(teams);
      await db.delete(agents);
    }
    await pool?.end();
    await stopContainer();
  });

  function artifactInput(overrides: {
    attemptN?: number;
    cid: string;
    kind?: string;
  }) {
    const attemptN = overrides.attemptN ?? 1;
    return {
      attemptN,
      cid: overrides.cid,
      contentEncoding: null,
      contentType: 'application/json',
      createdByAgentId: AGENT_ID,
      kind: overrides.kind ?? 'json',
      objectKey: `teams/${TEAM_ID}/artifacts/${overrides.cid}`,
      sha256: 'a'.repeat(64),
      sizeBytes: 11,
      taskId: TASK_ID,
      teamId: TEAM_ID,
      title: `attempt-${attemptN}.json`,
    };
  }

  it('returns the existing row for duplicate CID on the same attempt', async () => {
    const first = await repo.createForAttempt(
      artifactInput({ cid: 'bafkreiduplicate' }),
    );
    const second = await repo.createForAttempt(
      artifactInput({ cid: 'bafkreiduplicate' }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.artifact.id).toBe(first.artifact.id);
    expect(second.artifact.cid).toBe('bafkreiduplicate');
  });

  it('allows the same CID on different attempts', async () => {
    const first = await repo.createForAttempt(
      artifactInput({ attemptN: 1, cid: 'bafkreiretry' }),
    );
    const second = await repo.createForAttempt(
      artifactInput({ attemptN: 2, cid: 'bafkreiretry' }),
    );

    expect(first.created).toBe(true);
    expect(second.created).toBe(true);
    expect(second.artifact.id).not.toBe(first.artifact.id);
    expect(second.artifact.cid).toBe(first.artifact.cid);
  });

  it('finds artifacts by CID only within the requested attempt', async () => {
    await repo.createForAttempt(
      artifactInput({ attemptN: 2, cid: 'bafkreiattempt2' }),
    );

    await expect(
      repo.findByCidForAttempt({
        attemptN: 1,
        cid: 'bafkreiattempt2',
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    ).resolves.toBeNull();

    await expect(
      repo.findByCidForAttempt({
        attemptN: 2,
        cid: 'bafkreiattempt2',
        taskId: TASK_ID,
        teamId: TEAM_ID,
      }),
    ).resolves.toMatchObject({
      attemptN: 2,
      cid: 'bafkreiattempt2',
      taskId: TASK_ID,
      teamId: TEAM_ID,
    });
  });
});
