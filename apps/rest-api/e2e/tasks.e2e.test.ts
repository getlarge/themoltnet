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
import { computeJsonCid } from '@moltnet/crypto-service';
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
        task_type: 'context_distill',
        team_id: imposer.personalTeamId,
        diary_id: imposer.privateDiaryId,
        input: { diary_id: imposer.privateDiaryId, ...input },
        ...overrides,
      },
    });
  }

  function claim(taskId: string, leaseTtlSec = 30) {
    return claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: taskId },
      body: { lease_ttl_sec: leaseTtlSec },
    });
  }

  // ── Auth ─────────────────────────────────────────────────────────────────────

  describe('auth', () => {
    it('returns 401 without a token', async () => {
      const { response } = await listTasks({
        client,
        query: { team_id: imposer.personalTeamId },
      });
      expect(response.status).toBe(401);
    });

    it('returns 400 when team_id is missing from list', async () => {
      const { response } = await listTasks({
        client,
        auth: () => imposer.accessToken,
        // @ts-expect-error intentionally omitting required team_id
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
      expect(data!.task_type).toBe('context_distill');
      expect(data!.diary_id).toBe(imposer.privateDiaryId);
      expect(data!.team_id).toBe(imposer.personalTeamId);
      expect(data!.input_schema_cid).toBeTruthy();
      expect(data!.input_cid).toBeTruthy();
    });

    it('returns 400 for unknown task_type', async () => {
      const { response } = await createTask({
        client,
        auth: () => imposer.accessToken,
        body: {
          task_type: 'does_not_exist',
          team_id: imposer.personalTeamId,
          diary_id: imposer.privateDiaryId,
          input: {},
        },
      });
      expect(response.status).toBe(400);
    });

    it('returns 403 when imposing on a diary the caller cannot write', async () => {
      // claimer tries to impose against imposer diary without manager permission
      const { response } = await createTask({
        client,
        auth: () => claimer.accessToken,
        body: {
          task_type: 'context_distill',
          team_id: claimer.personalTeamId,
          diary_id: imposer.privateDiaryId,
          input: { diary_id: imposer.privateDiaryId },
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
        query: { team_id: imposer.personalTeamId },
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
        query: { team_id: imposer.personalTeamId },
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

    it('returns 404 for non-existent task id', async () => {
      const { response } = await getTask({
        client,
        auth: () => imposer.accessToken,
        path: { id: '00000000-0000-0000-0000-000000000000' },
      });
      expect(response.status).toBe(404);
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
      attemptN = claimed!.attempt.attempt_n;
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
        body: { lease_ttl_sec: 30 },
      });
      expect(err1).toBeUndefined();
      const firstExpiry = new Date(hb1!.claim_expires_at).getTime();

      const { data: hb2, error: err2 } = await taskHeartbeat({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: { lease_ttl_sec: 120 },
      });
      expect(err2).toBeUndefined();
      const secondExpiry = new Date(hb2!.claim_expires_at).getTime();

      expect(secondExpiry).toBeGreaterThan(firstExpiry);
      expect(secondExpiry).toBeGreaterThan(Date.now());
    });

    it('completes the task and returns completed status', async () => {
      const output = { summary: 'test output', score: 0.95 };
      const outputCid = await computeJsonCid(output);

      const { data, error } = await completeTask({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          output,
          output_cid: outputCid,
          usage: { model: 'test-model', input_tokens: 100, output_tokens: 50 },
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

    it('lists the completed attempt', async () => {
      const { data, error } = await listTaskAttempts({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId },
      });
      expect(error).toBeUndefined();
      expect(data!.length).toBe(1);
      expect(data![0].attempt_n).toBe(attemptN);
      expect(data![0].status).toBe('completed');
    });
  });

  // ── Claim → Fail lifecycle ────────────────────────────────────────────────────

  describe('claim → fail', () => {
    let taskId: string;
    let attemptN: number;

    beforeAll(async () => {
      const { data } = await impose({}, { max_attempts: 1 });
      taskId = data!.id;
      const { data: claimed } = await claim(taskId);
      attemptN = claimed!.attempt.attempt_n;
    });

    it('fails the task and DBOS workflow marks it failed', async () => {
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
      // max_attempts=1 so no retry — should be permanently failed
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
      expect(updated!.cancel_reason).toBe('no longer needed');
    });

    it('returns 403 when a non-owner tries to cancel', async () => {
      const { data } = await impose();
      const { response } = await cancelTask({
        client,
        auth: () => claimer.accessToken,
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
      attemptN = claimed!.attempt.attempt_n;
    });

    it('appends messages and returns count', async () => {
      const { data, error } = await appendTaskMessages({
        client,
        auth: () => claimer.accessToken,
        path: { id: taskId, n: attemptN },
        body: {
          messages: [
            { kind: 'progress', payload: { step: 'start', pct: 0 } },
            { kind: 'log', payload: { text: 'processing...' } },
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
        query: { after_seq: 0 },
      });
      expect(error).toBeUndefined();
      expect(data!.length).toBe(2);
      expect(data![0].kind).toBe('progress');
      expect(data![1].kind).toBe('log');
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
        body: { messages: [{ kind: 'log', payload: { text: 'done' } }] },
      });

      const { data: all } = await listTaskMessages({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId, n: attemptN },
        query: { after_seq: 0 },
      });

      const secondSeq = all![1].seq;

      const { data: after } = await listTaskMessages({
        client,
        auth: () => imposer.accessToken,
        path: { id: taskId, n: attemptN },
        query: { after_seq: secondSeq },
      });

      expect(after!.length).toBe(1);
      expect(after![0].kind).toBe('log');
      expect(after![0].payload).toEqual({ text: 'done' });
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
          body: { lease_ttl_sec: 30 },
        }),
        claimTask({
          client,
          auth: () => imposer.accessToken,
          path: { id: taskId },
          body: { lease_ttl_sec: 30 },
        }),
      ]);

      const statuses = [r1.response.status, r2.response.status].sort();
      // Exactly one 200, one 409
      expect(statuses).toEqual([200, 409]);
    });
  });
});
