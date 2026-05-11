/**
 * E2E: judge_eval_variant concurrency (#1101 review M6)
 *
 * Verifies the production behavior of the correlation_seal +
 * advisory-lock + transactional-create wiring (#1096) end-to-end
 * against the Docker stack:
 *
 *   1. Two concurrent `judge_eval_variant` creates against one
 *      correlation_id → exactly one wins, one is rejected.
 *   2. A subsequent sequential create against the now-sealed
 *      group → rejected by the pre-tx service-level seal check.
 *
 * Setup per test: two `run_eval` producer tasks sharing one
 * correlation_id, byte-identical `successCriteria`, both completed
 * with an accepted attempt. The judge's async validator requires
 * all three.
 */

import {
  claimTask,
  type Client,
  completeTask,
  createClient,
  createDiaryGrant,
  createTask,
  getTask,
  taskHeartbeat,
} from '@moltnet/api-client';
import { computeJsonCid } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, pollUntil, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('judge_eval_variant concurrency (#1101 M6)', () => {
  let harness: TestHarness;
  let client: Client;
  let imposer: TestAgent;
  let claimer: TestAgent;

  // Shared rubric used by every producer + judge input in this file.
  // Byte-identical across variants — the judge's async validator
  // rejects creates whose targets disagree on `successCriteria`.
  const sharedSuccessCriteria = {
    version: 1 as const,
    rubric: {
      version: 'v1',
      rubricId: 'e2e-r1',
      criteria: [
        { id: 'c1', description: 'first', weight: 0.6, scoring: 'llm_score' },
        { id: 'c2', description: 'second', weight: 0.4, scoring: 'llm_score' },
      ],
    },
  };

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

  async function imposeRunEval(
    correlationId: string,
    variantLabel: string,
  ): Promise<string> {
    const { data, error } = await createTask({
      client,
      auth: () => imposer.accessToken,
      body: {
        taskType: 'run_eval',
        teamId: imposer.personalTeamId,
        diaryId: imposer.privateDiaryId,
        correlationId,
        input: {
          scenario: { prompt: 'e2e eval scenario' },
          variantLabel,
          context: [],
          successCriteria: sharedSuccessCriteria,
        },
      },
    });
    expect(error).toBeUndefined();
    return data!.id;
  }

  async function completeRunEval(taskId: string): Promise<void> {
    const { data: claimed, error: claimErr } = await claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: taskId },
      body: { leaseTtlSec: 60 },
    });
    expect(claimErr).toBeUndefined();
    const attemptN = claimed!.attempt.attemptN;

    // Heartbeat to move past `claimed → running` before /complete.
    await taskHeartbeat({
      client,
      auth: () => claimer.accessToken,
      path: { id: taskId, n: attemptN },
      body: { leaseTtlSec: 60 },
    });

    const output = {
      response: 'eval output',
      totalTokens: 10,
      durationMs: 100,
      traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      // input.successCriteria is set → verification is required.
      verification: {
        inputCid: 'bafye2eeval',
        results: [],
        passed: true,
      },
    };
    const outputCid = await computeJsonCid(output);

    const { error: completeErr } = await completeTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: taskId, n: attemptN },
      body: {
        output,
        outputCid,
        usage: { model: 'test-model', inputTokens: 5, outputTokens: 5 },
      },
    });
    expect(completeErr).toBeUndefined();

    // Wait for the DBOS workflow to flip the row to `completed`. The
    // judge's async validator requires `status === 'completed'` AND
    // `acceptedAttemptN !== null`, so we cannot proceed until the
    // workflow has signed off.
    await pollUntil(
      async () => {
        const { data } = await getTask({
          client,
          auth: () => imposer.accessToken,
          path: { id: taskId },
        });
        return data!;
      },
      (t) => t.status === 'completed' || t.status === 'failed',
      { label: `run_eval.complete[${taskId.slice(0, 8)}]`, maxAttempts: 30 },
    );
  }

  async function setupSealedVariantPair(): Promise<{
    correlationId: string;
    runA: string;
    runB: string;
  }> {
    const correlationId = crypto.randomUUID();
    const runA = await imposeRunEval(correlationId, 'baseline');
    const runB = await imposeRunEval(correlationId, 'variant');
    await Promise.all([completeRunEval(runA), completeRunEval(runB)]);
    return { correlationId, runA, runB };
  }

  it('two concurrent judge_eval_variant creates: exactly one wins, one is rejected', async () => {
    const { runA, runB } = await setupSealedVariantPair();

    const judgeBody = {
      taskType: 'judge_eval_variant',
      teamId: imposer.personalTeamId,
      diaryId: imposer.privateDiaryId,
      input: {
        runTaskIds: [runA, runB],
        successCriteria: sharedSuccessCriteria,
      },
    };

    const [first, second] = await Promise.all([
      createTask({
        client,
        auth: () => imposer.accessToken,
        body: judgeBody,
      }),
      createTask({
        client,
        auth: () => imposer.accessToken,
        body: judgeBody,
      }),
    ]);

    const statuses = [first.response.status, second.response.status].sort();
    // Exactly one wins (201). The loser is either:
    //   - 409 if it lost the lock-protected in-tx re-check (the
    //     winning create committed its seal first), OR
    //   - 400 if its pre-tx async validator already saw the seal
    //     (the winner committed before the loser's validator pass).
    // Both are correct rejections; the service rejects, the loser
    // does not get a queued task, exactly one seal exists.
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
  });

  it('sequential create after the seal: rejected by the pre-tx service-level check (400 invalid)', async () => {
    const { runA, runB } = await setupSealedVariantPair();

    const judgeBody = {
      taskType: 'judge_eval_variant',
      teamId: imposer.personalTeamId,
      diaryId: imposer.privateDiaryId,
      input: {
        runTaskIds: [runA, runB],
        successCriteria: sharedSuccessCriteria,
      },
    };

    const winner = await createTask({
      client,
      auth: () => imposer.accessToken,
      body: judgeBody,
    });
    expect(winner.response.status).toBe(201);

    const loser = await createTask({
      client,
      auth: () => imposer.accessToken,
      body: judgeBody,
    });
    expect(loser.response.status).toBe(400);

    // The error body surfaces the seal — proves the rejection came
    // from the seal check, not from some unrelated validation.
    const body = (await loser.response.clone().json()) as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(body)).toMatch(/sealed/i);
  });
});
