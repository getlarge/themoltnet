/**
 * E2E: judge_eval_attempt duplicate protection
 *
 * Verifies the production behavior of the per-attempt eval-judge
 * uniqueness guard end-to-end against the Docker stack:
 *
 * 1. Two concurrent `judge_eval_attempt` creates against the same
 *    producer attempt + rubric identity -> exactly one wins.
 * 2. A subsequent sequential create against the same producer attempt
 *    -> rejected by the preflight duplicate validator.
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

describe('judge_eval_attempt duplicate protection', () => {
  let harness: TestHarness;
  let client: Client;
  let proposer: TestAgent;
  let claimer: TestAgent;

  const judgeSuccessCriteria = {
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

    [proposer, claimer] = await Promise.all([
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
      auth: () => proposer.accessToken,
      path: { id: proposer.privateDiaryId },
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

  async function proposeRunEval(correlationId: string): Promise<string> {
    const { data, error } = await createTask({
      client,
      auth: () => proposer.accessToken,
      headers: { 'x-moltnet-team-id': proposer.personalTeamId },
      body: {
        taskType: 'run_eval',
        diaryId: proposer.privateDiaryId,
        correlationId,
        input: {
          scenario: { prompt: 'e2e eval scenario' },
          variantLabel: 'baseline',
          execution: { mode: 'vitro', workspace: 'none' },
          context: [],
          successCriteria: { version: 1 },
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

    await pollUntil(
      async () => {
        const { data } = await getTask({
          client,
          auth: () => proposer.accessToken,
          path: { id: taskId },
        });
        return data!;
      },
      (task) =>
        task.status === 'completed' && task.acceptedAttemptN === attemptN,
      { label: `run_eval.accepted[${taskId.slice(0, 8)}]`, maxAttempts: 30 },
    );
  }

  async function setupCompletedProducer(): Promise<{
    correlationId: string;
    runTaskId: string;
  }> {
    const correlationId = crypto.randomUUID();
    const runTaskId = await proposeRunEval(correlationId);
    await completeRunEval(runTaskId);
    return { correlationId, runTaskId };
  }

  function judgeBody(correlationId: string, runTaskId: string) {
    return {
      taskType: 'judge_eval_attempt',
      diaryId: proposer.privateDiaryId,
      correlationId,
      input: {
        targetTaskId: runTaskId,
        targetAttemptN: 1,
        successCriteria: judgeSuccessCriteria,
      },
    };
  }

  it('keeps a conditional judge task waiting until all promised run evals are accepted', async () => {
    const firstCorrelationId = crypto.randomUUID();
    const secondCorrelationId = crypto.randomUUID();
    const [firstRunTaskId, secondRunTaskId] = await Promise.all([
      proposeRunEval(firstCorrelationId),
      proposeRunEval(secondCorrelationId),
    ]);

    const { data: judge, error: judgeError } = await createTask({
      client,
      auth: () => proposer.accessToken,
      headers: { 'x-moltnet-team-id': proposer.personalTeamId },
      body: {
        ...judgeBody(firstCorrelationId, firstRunTaskId),
        claimCondition: {
          op: 'all',
          conditions: [
            { op: 'task_accepted', taskId: firstRunTaskId },
            { op: 'task_accepted', taskId: secondRunTaskId },
          ],
        },
      },
    });
    expect(judgeError).toBeUndefined();
    expect(judge!.status).toBe('waiting');

    const prematureClaim = await claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: judge!.id },
      body: { leaseTtlSec: 60 },
    });
    expect(prematureClaim.response.status).toBe(409);

    await completeRunEval(firstRunTaskId);
    const halfReadyClaim = await claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: judge!.id },
      body: { leaseTtlSec: 60 },
    });
    expect(halfReadyClaim.response.status).toBe(409);

    const stillWaiting = await pollUntil(
      async () => {
        const { data } = await getTask({
          client,
          auth: () => proposer.accessToken,
          path: { id: judge!.id },
        });
        return data!;
      },
      (task) => task.status === 'waiting',
      { label: 'conditional judge remains waiting', maxAttempts: 5 },
    );
    expect(stillWaiting.status).toBe('waiting');

    await completeRunEval(secondRunTaskId);
    const claimed = await claimTask({
      client,
      auth: () => claimer.accessToken,
      path: { id: judge!.id },
      body: { leaseTtlSec: 60 },
    });
    expect(claimed.error).toBeUndefined();
    expect(claimed.data!.task.status).toBe('dispatched');
  });

  it('two concurrent judge_eval_attempt creates: exactly one wins, one is rejected', async () => {
    const { correlationId, runTaskId } = await setupCompletedProducer();
    const body = judgeBody(correlationId, runTaskId);

    const [first, second] = await Promise.all([
      createTask({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': proposer.personalTeamId },
        body,
      }),
      createTask({
        client,
        auth: () => proposer.accessToken,
        headers: { 'x-moltnet-team-id': proposer.personalTeamId },
        body,
      }),
    ]);

    const statuses = [first.response.status, second.response.status].sort();
    expect(statuses[0]).toBe(201);
    expect([400, 409]).toContain(statuses[1]);
  });

  it('sequential duplicate create is rejected by async validation', async () => {
    const { correlationId, runTaskId } = await setupCompletedProducer();
    const body = judgeBody(correlationId, runTaskId);

    const winner = await createTask({
      client,
      auth: () => proposer.accessToken,
      headers: { 'x-moltnet-team-id': proposer.personalTeamId },
      body,
    });
    expect(winner.response.status).toBe(201);

    const loser = await createTask({
      client,
      auth: () => proposer.accessToken,
      headers: { 'x-moltnet-team-id': proposer.personalTeamId },
      body,
    });
    expect(loser.response.status).toBe(400);
    expect(JSON.stringify(loser.error)).toMatch(
      /already exists|duplicate|targetTaskId/i,
    );
  });
});
