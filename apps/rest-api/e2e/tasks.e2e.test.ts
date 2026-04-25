/**
 * E2E: Tasks API
 *
 * Tests the full task lifecycle against a running Docker Compose stack:
 * create → list → get → claim → heartbeat → complete/fail/cancel
 * and the message append/list flow.
 *
 * Two agents are created: an imposer (creates tasks) and a claimer
 * (claims and executes them). Both share the imposer's diary via a
 * diary grant so the claimer has write access (required by canClaimTask
 * which checks Task/Claim traversing the diary Keto tuple).
 */

import {
  appendTaskMessages,
  cancelTask,
  claimTask,
  type Client,
  completeTask,
  createClient,
  createDiaryGrant,
  createTask,
  failTask,
  getTask,
  listTaskAttempts,
  listTaskMessages,
  listTasks,
  taskHeartbeat,
} from '@moltnet/api-client';
import {
  buildExecutorClaimAttestationPayload,
  buildExecutorCompleteAttestationPayload,
  computeExecutorManifestCid,
  computeJsonCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Tasks API', () => {
  let harness: TestHarness;
  let client: Client;
  let imposer: TestAgent;
  let claimer: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    [imposer, claimer] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);

    // Grant claimer write access to imposer's private diary so it can claim
    // tasks imposed against that diary (canClaimTask traverses diary write).
    await createDiaryGrant({
      client,
      auth: () => imposer.accessToken,
      path: { id: imposer.privateDiaryId },
      body: {
        subjectId: claimer.identityId,
        subjectNs: 'Agent',
        role: 'writer',
      },
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function impose(input: Record<string, unknown> = {}, overrides = {}) {
    return createTask({
      client,
      auth: () => imposer.accessToken,
      body: {
        taskType: 'curate_pack',
        teamId: imposer.personalTeamId,
        diaryId: imposer.privateDiaryId,
        input: {
          diaryId: imposer.privateDiaryId,
          taskPrompt: 'e2e test curation',
          ...input,
        },
        ...overrides,
      },
    });
  }

  function claim(taskId: string, leaseTtlSec = 30) {
    return claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: taskId },
      body: { leaseTtlSec: leaseTtlSec },
    });
  }

  async function signedExecutorClaim(taskId: string, manifest: object) {
    const executorFingerprint = computeExecutorManifestCid(manifest);
    const payload = buildExecutorClaimAttestationPayload({
      taskId,
      executorFingerprint,
    });
    const executorSignature = await signExecutorAttestation(
      payload,
      claimer.keyPair.privateKey,
    );
    return { executorFingerprint, executorSignature };
  }

  async function signedExecutorComplete(
    taskId: string,
    attemptN: number,
    outputCid: string,
    manifest: object,
  ) {
    const executorFingerprint = computeExecutorManifestCid(manifest);
    const payload = buildExecutorCompleteAttestationPayload({
      taskId,
      attemptN,
      outputCid,
      executorFingerprint,
    });
    const executorSignature = await signExecutorAttestation(
      payload,
      claimer.keyPair.privateKey,
    );
    return { executorFingerprint, executorSignature };
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe('auth', () => {
    it('returns 401 without a token', async () => {
      const { response } = await listTasks({
        client,
        query: { teamId: imposer.personalTeamId },
      });
      expect(response.status).toBe(401);
    });

    it('returns 400 when teamId is missing from list', async () => {
      const { response } = await listTasks({
        client,
        auth: () => imposer.accessToken,
        // @ts-expect-error intentionally omitting required teamId
        query: {},
      });
      expect(response.status).toBe(400);
    });
  });

  // ── Create ───────────────────────────────────────────────────────────────────

  describe('POST /tasks', () => {
    it('creates a task and returns queued status', async () => {
      const { data, error } = await impose();
      expect(error).toBeUndefined();
      expect(data).toBeDefined();
      expect(data!.status).toBe('queued');
      expect(data!.taskType).toBe('curate_pack');
      expect(data!.diaryId).toBe(imposer.privateDiaryId);
      expect(data!.teamId).toBe(imposer.personalTeamId);
      expect(data!.inputSchemaCid).toBeTruthy();
      expect(data!.inputCid).toBeTruthy();
    });

    it('returns 400 for unknown taskType', async () => {
      const { response } = await createTask({
        client,
        auth: () => imposer.accessToken,
        body: {
          taskType: 'does_not_exist',
          teamId: imposer.personalTeamId,
          diaryId: imposer.privateDiaryId,
          input: {},
        },
      });
      expect(response.status).toBe(400);
    });

    it('returns 403 when imposing on a diary the caller cannot write', async () => {
      // imposer has no write access to claimer's private diary
      const { response } = await createTask({
        client,
        auth: () => imposer.accessToken,
        body: {
          taskType: 'curate_pack',
          teamId: imposer.personalTeamId,
          diaryId: claimer.privateDiaryId,
          input: {
            diaryId: claimer.privateDiaryId,
            taskPrompt: 'unauthorized curation attempt',
          },
        },
      });
      expect(response.status).toBe(403);
    });
  });

  // ── List / Get ───────────────────────────────────────────────────────────────

  describe('GET /tasks and GET /tasks/:id', () => {
    let taskId: string;

    beforeAll(async () => {
      const { data } = await impose();
      taskId = data!.id;
    });

    it('lists tasks for the team', async () => {
      const { data, error } = await listTasks({
        client,
        auth: () => imposer.accessToken,
        query: { teamId: imposer.personalTeamId },
      });
      expect(error).toBeUndefined();
      expect(data!.items.length).toBeGreaterThan(0);
      expect(data!.total).toBeGreaterThan(0);
      const found = data!.items.find((t) => t.id === taskId);
      expect(found).toBeDefined();
    });

    it('returns 403 when listing another team the caller cannot access', async () => {
      const { response } = await listTasks({
        client,
        auth: () => claimer.accessToken,
        query: { teamId: imposer.personalTeamId },
      });
      expect(response.status).toBe(403);
    });

    it('gets a task by id', async () => {
      const { data, error } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(error).toBeUndefined();
      expect(data!.id).toBe(taskId);
    });

    it('returns 403 for non-existent task id', async () => {
      // Task.view traverses Task→Diary→read; a non-existent task has no
      // parent diary tuple, so Keto returns "not permitted" (403) rather
      // than leaking existence via 404.
      const { response } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(response.status).toBe(403);
    });
  });

  // ── Claim → Complete lifecycle ────────────────────────────────────────────────

  describe('claim → heartbeat → complete', () => {
    let taskId: string;
    let attemptN: number;

    beforeAll(async () => {
      const { data } = await impose();
      taskId = data!.id;

      const { data: claimed, error } = await claim(taskId);
      expect(error).toBeUndefined();
      attemptN = claimed!.attempt.attemptN;
    });

    it('task is dispatched after claim', async () => {
      const { data } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(['dispatched', 'running']).toContain(data!.status);
    });

    it('only one agent can claim a dispatched task', async () => {
      const { response } = await claim(taskId);
      expect(response.status).toBe(409);
    });

    it('heartbeat extends the lease', async () => {
      const { data: hb1, error: err1 } = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { leaseTtlSec: 30 },
      });
      expect(err1).toBeUndefined();
      const firstExpiry = new Date(hb1!.claimExpiresAt).getTime();

      const { data: hb2, error: err2 } = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { leaseTtlSec: 120 },
      });
      expect(err2).toBeUndefined();
      const secondExpiry = new Date(hb2!.claimExpiresAt).getTime();

      expect(secondExpiry).toBeGreaterThan(firstExpiry);
      expect(secondExpiry).toBeGreaterThan(Date.now());
    });

    it('completes the task and returns completed status', async () => {
      const output = {
        packId: '11111111-1111-4111-8111-111111111111',
        packCid: 'bafycuratepackreceipt',
        entries: [
          {
            entryId: '22222222-2222-4222-8222-222222222222',
            rank: 1,
            rationale: 'Most relevant entry for the requested pack.',
          },
        ],
        recipeParams: { recipe: 'topic-focused-v1' },
        summary: 'Created a pack receipt for the curated diary entries.',
      };
      const outputCid = await computeJsonCid(output);

      const { data, error } = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          output,
          outputCid: outputCid,
          usage: { model: 'test-model', inputTokens: 100, outputTokens: 50 },
        },
      });
      expect(error).toBeUndefined();

      // Poll until DBOS workflow finishes and status is terminal
      const final = await pollUntil(
        () =>
          getTask({
            client,
            auth: () => imposer.accessToken,
            path: { id: taskId },
          }).then((r) => r.data!),
        (t) => t.status === 'completed' || t.status === 'failed',
        { label: 'task.complete', maxAttempts: 20, intervalMs: 500 },
      );
      expect(final.status).toBe('completed');
      expect(data).toBeDefined();
    });

    it('rejects invalid output with field-level validation errors', async () => {
      const { data } = await impose({
        taskPrompt: 'Produce a malformed completion.',
      });
      const invalidTaskId = data!.id;

      const { data: claimed } = await claim(invalidTaskId);
      const invalidAttemptN = claimed!.attempt.attemptN;

      const badOutput = { summary: 42 };
      const badOutputCid = await computeJsonCid(badOutput);

      const { response, error } = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: invalidTaskId, n: invalidAttemptN },
        body: {
          output: badOutput,
          outputCid: badOutputCid,
          usage: { model: 'test-model', inputTokens: 1, outputTokens: 1 },
        },
      });

      expect(response.status).toBe(400);
      expect(error).toMatchObject({
        code: 'VALIDATION_FAILED',
        errors: expect.arrayContaining([
          expect.objectContaining({ field: 'output/packId' }),
        ]),
      });
    });

    it('lists the completed attempt', async () => {
      const { data, error } = await listTaskAttempts({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(error).toBeUndefined();
      expect(data!.length).toBe(1);
      expect(data![0].attemptN).toBe(attemptN);
      expect(data![0].status).toBe('completed');
    });
  });

  // Regression: a worker that claims a task and then calls /complete or /fail
  // without ever sending a /heartbeat used to deadlock the HTTP handler. The
  // DBOS workflow blocks on recv('started') (sent only by /heartbeat) before
  // it accepts a result, so /complete's send to recv('result') went unheard
  // and the handler's poll loop hit EVENT_TIMEOUT_SECONDS. Fixed by rejecting
  // /complete and /fail with 409 when attempt.status === 'claimed'.
  describe('complete/fail without heartbeat', () => {
    it('rejects /complete with 409 when no heartbeat was sent', async () => {
      const { data: task } = await impose({
        taskPrompt: 'complete-without-heartbeat regression',
      });
      const taskId = task!.id;
      const { data: claimed } = await claim(taskId);
      const attemptN = claimed!.attempt.attemptN;

      const output = {
        packId: '33333333-3333-4333-8333-333333333333',
        packCid: 'bafynoheartbeat',
        entries: [
          {
            entryId: '44444444-4444-4444-8444-444444444444',
            rank: 1,
            rationale: 'irrelevant — request should fail before validation.',
          },
        ],
        recipeParams: { recipe: 'topic-focused-v1' },
        summary: 'should never land',
      };
      const outputCid = await computeJsonCid(output);

      const { response, error } = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          output,
          outputCid,
          usage: { model: 'test-model', inputTokens: 1, outputTokens: 1 },
        },
      });

      expect(response.status).toBe(409);
      expect(error).toMatchObject({
        message: expect.stringMatching(/heartbeat/i),
      });

      // Task is still claimed; recovery path is to call /heartbeat then retry.
      const { data: still } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(still!.status).toBe('dispatched');
    });

    it('rejects /fail with 409 when no heartbeat was sent', async () => {
      const { data: task } = await impose({
        taskPrompt: 'fail-without-heartbeat regression',
      });
      const taskId = task!.id;
      const { data: claimed } = await claim(taskId);
      const attemptN = claimed!.attempt.attemptN;

      const { response, error } = await failTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          error: {
            code: 'task_failed',
            message: 'should never land',
            retryable: false,
          },
        },
      });

      expect(response.status).toBe(409);
      expect(error).toMatchObject({
        message: expect.stringMatching(/heartbeat/i),
      });
    });

    it('completes successfully when heartbeat is sent first', async () => {
      const { data: task } = await impose({
        taskPrompt: 'heartbeat-then-complete happy path',
      });
      const taskId = task!.id;
      const { data: claimed } = await claim(taskId);
      const attemptN = claimed!.attempt.attemptN;

      const { error: hbErr } = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { leaseTtlSec: 30 },
      });
      expect(hbErr).toBeUndefined();

      const output = {
        packId: '55555555-5555-4555-8555-555555555555',
        packCid: 'bafyheartbeatok',
        entries: [
          {
            entryId: '66666666-6666-4666-8666-666666666666',
            rank: 1,
            rationale: 'baseline happy path entry.',
          },
        ],
        recipeParams: { recipe: 'topic-focused-v1' },
        summary: 'heartbeat-then-complete should succeed',
      };
      const outputCid = await computeJsonCid(output);

      const { error } = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          output,
          outputCid,
          usage: { model: 'test-model', inputTokens: 1, outputTokens: 1 },
        },
      });
      expect(error).toBeUndefined();

      const final = await pollUntil(
        () =>
          getTask({
            client,
            auth: () => imposer.accessToken,
            path: { id: taskId },
          }).then((r) => r.data!),
        (t) => t.status === 'completed' || t.status === 'failed',
        {
          label: 'task.complete.afterHeartbeat',
          maxAttempts: 20,
          intervalMs: 500,
        },
      );
      expect(final.status).toBe('completed');
    });
  });

  describe('executor manifest trust enforcement', () => {
    it('stores optional selfDeclared claim executor manifests without a signature', async () => {
      const executorManifest = {
        schemaVersion: 'moltnet:executor-manifest:v1',
        runtime: { kind: 'e2e', version: 'self-declared' },
      };
      const executorFingerprint = computeExecutorManifestCid(executorManifest);
      const { data: task } = await impose({
        taskPrompt: 'self declared executor manifest task',
      });
      const taskId = task!.id;

      const { data: claimed, error: claimError } = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId },
        body: {
          leaseTtlSec: 30,
          executorManifest,
          executorFingerprint,
        },
      });
      expect(claimError).toBeUndefined();
      expect(claimed!.attempt.claimedExecutorFingerprint).toBe(
        executorFingerprint,
      );
      expect(claimed!.attempt.claimedExecutorManifest).toEqual(
        executorManifest,
      );
    });

    it('stores signed claim and complete executor manifests', async () => {
      const executorManifest = {
        schemaVersion: 'moltnet:executor-manifest:v1',
        runtime: { kind: 'e2e', version: '1' },
      };
      const { data: task } = await impose(
        { taskPrompt: 'signed executor manifest task' },
        { requiredExecutorTrustLevel: 'agentSigned' },
      );
      const taskId = task!.id;
      const claimAttestation = await signedExecutorClaim(
        taskId,
        executorManifest,
      );

      const { data: claimed, error: claimError } = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId },
        body: {
          leaseTtlSec: 30,
          executorManifest,
          ...claimAttestation,
        },
      });
      expect(claimError).toBeUndefined();
      expect(claimed!.attempt.claimedExecutorFingerprint).toBe(
        claimAttestation.executorFingerprint,
      );
      expect(claimed!.attempt.claimedExecutorManifest).toEqual(
        executorManifest,
      );

      const attemptN = claimed!.attempt.attemptN;
      await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { leaseTtlSec: 30 },
      });

      const output = {
        packId: '11111111-1111-4111-8111-111111111111',
        packCid: 'bafyexecutortrust',
        entries: [
          {
            entryId: '22222222-2222-4222-8222-222222222222',
            rank: 1,
            rationale: 'Representative executor trust entry.',
          },
        ],
        recipeParams: { recipe: 'executor-trust-v1' },
        summary: 'Completed with signed executor manifest.',
      };
      const outputCid = await computeJsonCid(output);
      const completeAttestation = await signedExecutorComplete(
        taskId,
        attemptN,
        outputCid,
        executorManifest,
      );

      const { error: completeError } = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          output,
          outputCid,
          usage: { model: 'test-model', inputTokens: 10, outputTokens: 5 },
          executorManifest,
          ...completeAttestation,
        },
      });
      expect(completeError).toBeUndefined();

      await pollUntil(
        () =>
          getTask({
            client,
            auth: () => imposer.accessToken,
            path: { id: taskId },
          }).then((r) => r.data!),
        (t) => t.status === 'completed',
        { label: 'task.executorTrust.complete', maxAttempts: 20 },
      );

      const { data: attempts } = await listTaskAttempts({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(attempts![0].completedExecutorFingerprint).toBe(
        completeAttestation.executorFingerprint,
      );
      expect(attempts![0].completedExecutorManifest).toEqual(executorManifest);
    });

    it('rejects releaseVerifiedTool claims until release verifier is wired', async () => {
      const executorManifest = {
        schemaVersion: 'moltnet:executor-manifest:v1',
        runtime: { kind: 'e2e', version: '1' },
      };
      const { data: task } = await impose(
        { taskPrompt: 'release verified executor manifest task' },
        { requiredExecutorTrustLevel: 'releaseVerifiedTool' },
      );
      const taskId = task!.id;
      const claimAttestation = await signedExecutorClaim(
        taskId,
        executorManifest,
      );

      const { response } = await claimTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId },
        body: {
          leaseTtlSec: 30,
          executorManifest,
          ...claimAttestation,
        },
      });
      expect(response.status).toBe(400);

      const { data: unchanged } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(unchanged!.status).toBe('queued');
    });
  });

  // ── Claim → Fail lifecycle ────────────────────────────────────────────────────

  describe('claim → fail', () => {
    let taskId: string;
    let attemptN: number;

    beforeAll(async () => {
      const { data } = await impose({}, { maxAttempts: 1 });
      taskId = data!.id;
      const { data: claimed } = await claim(taskId);
      attemptN = claimed!.attempt.attemptN;
    });

    it('fails the task and DBOS workflow marks it failed', async () => {
      // Heartbeat advances the workflow past the 'started' checkpoint so it
      // can receive the 'result' event sent by fail().
      await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { leaseTtlSec: 30 },
      });

      const { error } = await failTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          error: { code: 'execution_error', message: 'Something went wrong' },
        },
      });
      expect(error).toBeUndefined();

      const final = await pollUntil(
        () =>
          getTask({
            client,
            auth: () => imposer.accessToken,
            path: { id: taskId },
          }).then((r) => r.data!),
        (t) => t.status === 'failed' || t.status === 'queued',
        { label: 'task.fail', maxAttempts: 20, intervalMs: 500 },
      );
      // maxAttempts=1 so no retry — should be permanently failed
      expect(final.status).toBe('failed');
    });
  });

  // ── Cancel ────────────────────────────────────────────────────────────────────

  describe('POST /tasks/:id/cancel', () => {
    it('cancels a queued task', async () => {
      const { data } = await impose();
      const taskId = data!.id;

      const { error } = await cancelTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
        body: { reason: 'no longer needed' },
      });
      expect(error).toBeUndefined();

      const { data: updated } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(updated!.status).toBe('cancelled');
      expect(updated!.cancelReason).toBe('no longer needed');
    });

    it('returns 403 when a non-owner tries to cancel', async () => {
      // Create a task in claimer's own diary; imposer has no access to it.
      const { data } = await createTask({
        client,
        auth: () => claimer.accessToken,
        body: {
          taskType: 'curate_pack',
          teamId: claimer.personalTeamId,
          diaryId: claimer.privateDiaryId,
          input: {
            diaryId: claimer.privateDiaryId,
            taskPrompt: 'claimer-owned task',
          },
        },
      });
      const { response } = await cancelTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: data!.id },
        body: { reason: 'unauthorized cancel attempt' },
      });
      expect(response.status).toBe(403);
    });
  });

  // ── Messages ──────────────────────────────────────────────────────────────────

  describe('task messages', () => {
    let taskId: string;
    let attemptN: number;

    beforeAll(async () => {
      const { data } = await impose();
      taskId = data!.id;
      const { data: claimed } = await claim(taskId);
      attemptN = claimed!.attempt.attemptN;
    });

    it('appends messages and returns count', async () => {
      const { data, error } = await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          messages: [
            { kind: 'info', payload: { step: 'start', pct: 0 } },
            { kind: 'text_delta', payload: { text: 'processing...' } },
          ],
        },
      });
      expect(error).toBeUndefined();
      expect(data!.count).toBe(2);
    });

    it('lists messages in order', async () => {
      const { data, error } = await listTaskMessages({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId, n: attemptN },
        query: {},
      });
      expect(error).toBeUndefined();
      expect(data!.length).toBe(2);
      expect(data![0].kind).toBe('info');
      expect(data![1].kind).toBe('text_delta');
      expect(data![0].seq).toBeLessThan(data![1].seq);
    });

    it('returns 400 when messages array is empty', async () => {
      const { response } = await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { messages: [] },
      });
      expect(response.status).toBe(400);
    });

    it('returns only messages after given seq', async () => {
      // Append a third message
      await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { messages: [{ kind: 'text_delta', payload: { text: 'done' } }] },
      });

      // Fetch all 3 messages (no afterSeq filter)
      const { data: all } = await listTaskMessages({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId, n: attemptN },
        query: {},
      });

      // afterSeq is exclusive — use seq of the second message to get only the third
      const secondSeq = all![1].seq;

      const { data: after } = await listTaskMessages({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId, n: attemptN },
        query: { afterSeq: secondSeq },
      });

      expect(after!.length).toBe(1);
      expect(after![0].kind).toBe('text_delta');
      expect(after![0].payload).toEqual({ text: 'done' });
    });

    // Regression test for issue #921: concurrent appendMessages calls for the
    // same (taskId, attemptN) race on seq generation. Under READ COMMITTED two
    // in-flight statements both read MAX(seq)=N and both INSERT seq=N+1,
    // violating the (task_id, attempt_n, seq) primary key and surfacing as 500s.
    // All calls must succeed and the resulting seqs must form a contiguous
    // monotonically-increasing range with no duplicates.
    it('handles N concurrent appendMessages without PK collisions', async () => {
      // Fresh task + attempt so we don't have to reason about pre-existing
      // messages from sibling tests in this describe block.
      const { data: task } = await impose();
      const concurrentTaskId = task!.id;
      const { data: claimed } = await claim(concurrentTaskId);
      const concurrentAttemptN = claimed!.attempt.attemptN;

      const CONCURRENCY = 20;
      const results = await Promise.all(
        Array.from({ length: CONCURRENCY }, (_, i) =>
          appendTaskMessages({
            client,
            auth: () => claimer.accessToken,
            path: { id: concurrentTaskId, n: concurrentAttemptN },
            body: {
              messages: [
                {
                  kind: 'text_delta',
                  payload: { index: i, text: `chunk-${i}` },
                },
              ],
            },
          }),
        ),
      );

      const statuses = results.map((r) => r.response.status);
      expect(
        statuses,
        `expected all ${CONCURRENCY} concurrent appends to return 200, got ${JSON.stringify(statuses)}`,
      ).toEqual(Array.from({ length: CONCURRENCY }, () => 200));

      const { data: messages, error } = await listTaskMessages({
        client,
        auth: () => imposer.accessToken,
        path: { id: concurrentTaskId, n: concurrentAttemptN },
        query: {},
      });
      expect(error).toBeUndefined();
      expect(messages!.length).toBe(CONCURRENCY);

      const seqs = messages!.map((m) => m.seq).sort((a, b) => a - b);
      const uniqueSeqs = new Set(seqs);
      expect(uniqueSeqs.size).toBe(CONCURRENCY);
      // seq is per-(task,attempt) dense and zero-based, so a brand-new attempt
      // with N appends must produce exactly 0..N-1.
      expect(seqs).toEqual(Array.from({ length: CONCURRENCY }, (_, i) => i));
    });
  });

  // ── Concurrent claim (CAS gate) ────────────────────────────────────────────

  describe('concurrent claim race', () => {
    it('only one claimer wins when two race simultaneously', async () => {
      const { data } = await impose();
      const taskId = data!.id;

      // Two concurrent claim attempts from different identities
      const [r1, r2] = await Promise.all([
        claimTask({
          client,
          auth: () => claimer.accessToken,
          path: { id: taskId },
          body: { leaseTtlSec: 30 },
        }),
        claimTask({
          client,
          auth: () => imposer.accessToken,
          path: { id: taskId },
          body: { leaseTtlSec: 30 },
        }),
      ]);

      const statuses = [r1.response.status, r2.response.status].sort();
      // Exactly one 200, one 409
      expect(statuses).toEqual([200, 409]);
    });
  });
});
