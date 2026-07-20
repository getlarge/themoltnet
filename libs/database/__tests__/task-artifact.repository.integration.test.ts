/**
 * TaskArtifactRepository Integration Tests
 *
 * Exercises the unique `(team_id, task_id, attempt_n, cid)` constraint and
 * repository fallback against real Postgres so duplicate upload behavior stays
 * aligned with the migration-backed schema.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql';
import { eq } from 'drizzle-orm';
import type { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '../src/db.js';
import { runMigrations } from '../src/migrate.js';
import {
  createTaskArtifactRepository,
  decodeTaskArtifactCursor,
  type ListTaskArtifactsInput,
} from '../src/repositories/task-artifact.repository.js';
import {
  agents,
  diaries,
  type TaskArtifact,
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
  const SECOND_TASK_ID = '55555555-5555-4555-8555-555555555585';

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

  function inputArtifactInput(overrides: {
    cid: string;
    kind?: string;
    taskId?: string;
    createdByAgentId?: string | null;
  }) {
    return {
      cid: overrides.cid,
      contentEncoding: null,
      contentType: 'application/json',
      createdByAgentId:
        overrides.createdByAgentId === undefined
          ? null
          : overrides.createdByAgentId,
      kind: overrides.kind ?? 'json',
      objectKey: `teams/${TEAM_ID}/artifacts/${overrides.cid}`,
      sha256: 'b'.repeat(64),
      sizeBytes: 11,
      taskId: overrides.taskId ?? TASK_ID,
      teamId: TEAM_ID,
      title: `input-${overrides.cid}.json`,
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

  it('createManyForTask inserts input rows with null attemptN and null createdByAgentId (human case)', async () => {
    const rows = await repo.createManyForTask([
      inputArtifactInput({
        cid: 'bafkreihumaninput',
        createdByAgentId: null,
      }),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].attemptN).toBeNull();
    expect(rows[0].createdByAgentId).toBeNull();
    expect(rows[0].cid).toBe('bafkreihumaninput');
    expect(rows[0].taskId).toBe(TASK_ID);
  });

  it('paginates across the input/attempt boundary without duplicates or drops', async () => {
    // 1 input artifact (attempt_n NULL) + 2 on attempt 1 + 1 on attempt 2.
    await repo.createManyForTask([
      inputArtifactInput({ cid: 'bafkreiinput0' }),
    ]);
    await repo.createForAttempt(
      artifactInput({ attemptN: 1, cid: 'bafkreia1x' }),
    );
    await repo.createForAttempt(
      artifactInput({ attemptN: 1, cid: 'bafkreia1y' }),
    );
    await repo.createForAttempt(
      artifactInput({ attemptN: 2, cid: 'bafkreia2x' }),
    );

    const seen: TaskArtifact[] = [];
    let cursor: ListTaskArtifactsInput['cursor'];
    // Bounded loop: 4 rows / limit 2 = 2 pages; guard rail prevents a
    // runaway if pagination regresses.
    for (let page = 0; page < 10; page++) {
      const result = await repo.listForTask({
        teamId: TEAM_ID,
        taskId: TASK_ID,
        limit: 2,
        cursor,
      });
      seen.push(...result.artifacts);
      if (!result.nextCursor) break;
      cursor = decodeTaskArtifactCursor(result.nextCursor);
    }

    expect(seen).toHaveLength(4);
    const cids = seen.map((artifact) => artifact.cid);
    expect(new Set(cids).size).toBe(4);
    // Input row (attempt_n NULL, sorted as 0) comes first.
    expect(seen[0].attemptN).toBeNull();
    const orderKeys = seen.map((artifact) => artifact.attemptN ?? 0);
    expect(orderKeys).toEqual([...orderKeys].sort((a, b) => a - b));
  });

  it('findByCidForTask returns the input row when the CID also exists on an attempt', async () => {
    const SHARED_CID = 'bafkreisharedcid';
    await repo.createForAttempt(
      artifactInput({ attemptN: 1, cid: SHARED_CID }),
    );
    await repo.createManyForTask([inputArtifactInput({ cid: SHARED_CID })]);

    const row = await repo.findByCidForTask({
      teamId: TEAM_ID,
      taskId: TASK_ID,
      cid: SHARED_CID,
    });

    expect(row).not.toBeNull();
    expect(row?.attemptN).toBeNull();
    expect(row?.cid).toBe(SHARED_CID);
  });

  it('rejects a duplicate input CID via the partial unique index', async () => {
    await repo.createManyForTask([inputArtifactInput({ cid: 'bafkreidup' })]);

    await expect(
      repo.createManyForTask([inputArtifactInput({ cid: 'bafkreidup' })]),
    ).rejects.toThrow();
  });

  it('listObjectKeysStillReferenced returns only keys with surviving rows', async () => {
    // A second task lets us delete one task's rows and confirm only the
    // still-referenced object key is reported.
    await db.insert(tasks).values({
      id: SECOND_TASK_ID,
      taskType: 'freeform',
      teamId: TEAM_ID,
      diaryId: DIARY_ID,
      outputKind: 'artifact',
      input: { brief: 'second task' },
      inputSchemaCid: 'cid-placeholder-input-schema',
      inputCid: 'cid-placeholder-input-2',
      proposedByAgentId: AGENT_ID,
      status: 'running',
      claimAgentId: AGENT_ID,
      maxAttempts: 1,
    });

    const [keep] = await repo.createManyForTask([
      inputArtifactInput({ cid: 'bafkreikeep' }),
    ]);
    const [gone] = await repo.createManyForTask([
      inputArtifactInput({ cid: 'bafkreigone', taskId: SECOND_TASK_ID }),
    ]);

    // Delete the second task's rows; its object key is now unreferenced.
    await db
      .delete(taskArtifacts)
      .where(eq(taskArtifacts.taskId, SECOND_TASK_ID));

    const referenced = await repo.listObjectKeysStillReferenced([
      keep.objectKey,
      gone.objectKey,
    ]);

    expect(referenced).toEqual([keep.objectKey]);

    // Keep other tests isolated: drop the second task row we seeded.
    await db.delete(tasks).where(eq(tasks.id, SECOND_TASK_ID));
  });
});
