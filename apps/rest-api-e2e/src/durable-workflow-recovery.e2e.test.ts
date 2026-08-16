import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  claimTask,
  completeTask,
  createClient,
  createSigningRequest,
  createTask,
  getSigningRequest,
  getTask,
  listTaskAttempts,
  submitSignature,
  taskHeartbeat,
} from '@moltnet/api-client';
import { computeJsonCid, cryptoService } from '@moltnet/crypto-service';
import { signingRequests, taskAttempts, tasks } from '@moltnet/database';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, '../../..');
const composeFile = resolve(repositoryRoot, 'docker-compose.e2e.yaml');

async function waitForRestApi(): Promise<void> {
  await pollUntil(
    async () => {
      try {
        const response = await fetch('http://localhost:8080/health/ready');
        const body = (await response.json()) as {
          components?: {
            database?: { status?: string };
            dbos?: { status?: string };
          };
        };
        // This E2E topology intentionally omits ORY_PROJECT_URL, so aggregate
        // readiness remains degraded. Recovery specifically requires the
        // durable database and DBOS runtime to be ready before requests resume.
        return (
          body.components?.database?.status === 'ok' &&
          body.components.dbos?.status === 'ok'
        );
      } catch {
        return false;
      }
    },
    Boolean,
    {
      label: 'rest-api readiness after container replacement',
      // Readiness is intentionally limited to 12 anonymous requests/minute.
      // Stay below that production budget while DBOS recovers durable work.
      maxAttempts: 20,
      intervalMs: 6_000,
    },
  );
}

async function replaceRestApiContainer(): Promise<void> {
  const env = { ...process.env, COMPOSE_DISABLE_ENV_FILE: 'true' };
  await execFileAsync(
    'docker',
    ['compose', '-f', composeFile, 'kill', 'rest-api'],
    { cwd: repositoryRoot, env },
  );
  await execFileAsync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'up',
      '-d',
      '--no-deps',
      '--force-recreate',
      'rest-api',
    ],
    { cwd: repositoryRoot, env },
  );
  await waitForRestApi();
}

describe('DBOS process recovery', () => {
  let harness: TestHarness;
  let agent: TestAgent;
  const client = createClient({ baseUrl: 'http://localhost:8080' });

  beforeAll(async () => {
    harness = await createTestHarness();
    agent = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('recovers one waiting task-attempt workflow without resetting its lease', async () => {
    const created = await createTask({
      client,
      auth: () => agent.accessToken,
      headers: { 'x-moltnet-team-id': agent.personalTeamId },
      body: {
        taskType: 'freeform',
        title: 'DBOS container recovery',
        diaryId: agent.privateDiaryId,
        input: { brief: 'survive a rest-api process replacement' },
      },
    });
    expect(created.error).toBeUndefined();

    const claimed = await claimTask({
      client,
      auth: () => agent.accessToken,
      path: { id: created.data!.id },
      body: { leaseTtlSec: 120 },
    });
    expect(claimed.error).toBeUndefined();
    const attemptN = claimed.data!.attempt.attemptN;

    await pollUntil(
      () =>
        getTask({
          client,
          auth: () => agent.accessToken,
          path: { id: created.data!.id },
        }).then((result) => result.data!),
      (task) => task.status === 'dispatched',
      { label: 'task workflow waiting for first progress event' },
    );
    const [beforeRestart] = await harness.db
      .select({ claimExpiresAt: tasks.claimExpiresAt })
      .from(tasks)
      .where(eq(tasks.id, created.data!.id));
    expect(beforeRestart.claimExpiresAt).not.toBeNull();

    await replaceRestApiContainer();

    const [afterRestart] = await harness.db
      .select({ claimExpiresAt: tasks.claimExpiresAt })
      .from(tasks)
      .where(eq(tasks.id, created.data!.id));
    expect(afterRestart.claimExpiresAt).toEqual(beforeRestart.claimExpiresAt);

    const heartbeat = await taskHeartbeat({
      client,
      auth: () => agent.accessToken,
      path: { id: created.data!.id, n: attemptN },
      body: { leaseTtlSec: 120 },
    });
    expect(heartbeat.error).toBeUndefined();

    const output = {
      summary: 'Recovered exactly once.',
      verification: {
        inputCid: created.data!.inputCid,
        results: [],
        passed: true,
      },
    };
    const completed = await completeTask({
      client,
      auth: () => agent.accessToken,
      path: { id: created.data!.id, n: attemptN },
      body: {
        output,
        outputCid: await computeJsonCid(output),
        usage: { model: 'recovery-e2e', inputTokens: 1, outputTokens: 1 },
      },
    });
    expect(completed.error).toBeUndefined();

    await pollUntil(
      () =>
        getTask({
          client,
          auth: () => agent.accessToken,
          path: { id: created.data!.id },
        }).then((result) => result.data!),
      (task) => task.status === 'completed',
      { label: 'recovered task workflow completion', maxAttempts: 60 },
    );
    const attempts = await listTaskAttempts({
      client,
      auth: () => agent.accessToken,
      path: { id: created.data!.id },
    });
    expect(attempts.data).toHaveLength(1);
    expect(attempts.data![0]).toMatchObject({
      attemptN,
      status: 'completed',
    });

    const [attemptRow] = await harness.db
      .select({ workflowId: taskAttempts.workflowId })
      .from(taskAttempts)
      .where(eq(taskAttempts.taskId, created.data!.id));
    const workflowRows = await harness.db.execute<{
      recovery_attempts: string;
      status: string;
    }>(sql`
      SELECT status, recovery_attempts
      FROM dbos.workflow_status
      WHERE workflow_uuid = ${attemptRow.workflowId}
    `);
    expect(workflowRows.rows).toHaveLength(1);
    expect(workflowRows.rows[0].status).toBe('SUCCESS');
    expect(Number(workflowRows.rows[0].recovery_attempts)).toBeGreaterThan(0);
  });

  it('recovers one signing workflow and preserves its original deadline', async () => {
    const created = await createSigningRequest({
      client,
      auth: () => agent.accessToken,
      body: { message: 'sign after DBOS recovery' },
    });
    expect(created.error).toBeUndefined();
    const originalExpiry = created.data!.expiresAt;

    const [requestRow] = await harness.db
      .select({ workflowId: signingRequests.workflowId })
      .from(signingRequests)
      .where(eq(signingRequests.id, created.data!.id));
    expect(requestRow.workflowId).toEqual(expect.any(String));

    await replaceRestApiContainer();

    const recovered = await getSigningRequest({
      client,
      auth: () => agent.accessToken,
      path: { id: created.data!.id },
    });
    expect(recovered.data!.status).toBe('pending');
    expect(recovered.data!.expiresAt).toBe(originalExpiry);

    const signature = await cryptoService.signWithNonce(
      created.data!.message,
      created.data!.nonce,
      agent.keyPair.privateKey,
    );
    const submitted = await submitSignature({
      client,
      auth: () => agent.accessToken,
      path: { id: created.data!.id },
      body: { signature },
    });
    expect(submitted.error).toBeUndefined();
    expect(submitted.data).toMatchObject({ status: 'completed', valid: true });

    const workflowRows = await harness.db.execute<{
      recovery_attempts: string;
      status: string;
    }>(sql`
      SELECT status, recovery_attempts
      FROM dbos.workflow_status
      WHERE workflow_uuid = ${requestRow.workflowId!}
    `);
    expect(workflowRows.rows).toHaveLength(1);
    expect(workflowRows.rows[0].status).toBe('SUCCESS');
    expect(Number(workflowRows.rows[0].recovery_attempts)).toBeGreaterThan(0);
  });
});
