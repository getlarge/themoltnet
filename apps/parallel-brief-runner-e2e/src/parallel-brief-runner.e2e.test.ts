import { randomUUID } from 'node:crypto';

import {
  createE2EAgentHarness,
  type E2EAgentHarness,
} from '@moltnet/bootstrap';
import { computeJsonCid } from '@moltnet/crypto-service';
import {
  createSdkTaskClient,
  type WorkflowContext,
} from '@moltnet/orchestration';
import { runParallelBriefs } from '@themoltnet/parallel-brief-runner';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let harness: E2EAgentHarness;
let agent: Agent;
let teamId: string;
let diaryId: string;

beforeAll(async () => {
  harness = await createE2EAgentHarness({
    restApiUrl: process.env.REST_API_URL,
    databaseUrl: process.env.DATABASE_URL,
    hydraPublicUrl: process.env.ORY_HYDRA_PUBLIC_URL,
    hydraAdminUrl: process.env.ORY_HYDRA_ADMIN_URL,
    ketoReadUrl: process.env.ORY_KETO_PUBLIC_URL,
    ketoWriteUrl: process.env.ORY_KETO_ADMIN_URL,
    kratosAdminUrl: process.env.ORY_KRATOS_ADMIN_URL,
  });
  const creds = await harness.createAgent('e2e-parallel-brief-runner');
  agent = await connect({
    apiUrl: harness.restApiUrl,
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
  });
  teamId = creds.personalTeamId;
  diaryId = creds.privateDiaryId;
});

afterAll(async () => {
  await harness?.teardown();
});

/**
 * Non-durable context that actually sleeps between polls (unlike `inlineContext`,
 * whose `sleepFor` is a no-op and would busy-poll the live API).
 */
const sleepingContext: WorkflowContext = {
  step: (_name, fn) => fn(),
  sleepFor: (_name, seconds) =>
    new Promise((resolve) => {
      setTimeout(resolve, seconds * 1000);
    }),
};

async function pollUntil<T>(
  fn: () => Promise<T>,
  predicate: (value: T) => boolean,
  { attempts = 60, delayMs = 500 } = {},
): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < attempts; i += 1) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }
  throw new Error('pollUntil timed out');
}

/**
 * Act as the executing agent: claim a freeform task, start it (heartbeat), and
 * complete it. The output carries a `verification` record that satisfies the
 * `submit-output` gate the task-service injects into every producer task's
 * successCriteria at create time.
 */
async function executeFreeform(
  taskId: string,
  inputCid: string,
  summary: string,
): Promise<void> {
  const claimed = await agent.tasks.claim(taskId, { leaseTtlSec: 60 });
  const attemptN = claimed.attempt.attemptN;
  await agent.tasks.heartbeat(taskId, attemptN, { leaseTtlSec: 30 });
  const output = {
    summary,
    verification: {
      inputCid,
      results: [
        {
          id: 'submit-output',
          kind: 'gate' as const,
          status: 'pass' as const,
          detail: 'submit tool criterion satisfied in e2e fixture',
        },
      ],
      passed: true,
    },
  };
  const outputCid = await computeJsonCid(output);
  await agent.tasks.complete(taskId, attemptN, {
    output,
    outputCid,
    usage: { model: 'e2e-test', inputTokens: 1, outputTokens: 1 },
  });
}

describe('parallel-brief-runner e2e', () => {
  it('fans out briefs and joins them into a summary against the live stack', async () => {
    const correlationId = randomUUID();
    const input = {
      teamId,
      diaryId,
      briefs: ['brief one', 'brief two', 'brief three'],
      summaryBrief: 'combine them',
      correlationId,
      pollIntervalSec: 1,
    };

    // Run the orchestration; the test itself plays the executing agent.
    const runPromise = runParallelBriefs(
      input,
      { tasks: createSdkTaskClient(agent) },
      sleepingContext,
    );

    const isBrief = (t: { title?: string | null }) =>
      t.title?.startsWith('Brief') ?? false;
    const isSummary = (t: { title?: string | null }) =>
      t.title === 'Summarize parallel briefs';

    // 1. Wait until all three briefs AND the up-front summary task exist.
    const initial = await pollUntil(
      () => agent.tasks.list({ correlationId }, { teamId }),
      (r) =>
        r.items.filter(isBrief).length === input.briefs.length &&
        r.items.some(isSummary),
    );

    // 2. The summary was declared up front and is gated by the joinCondition, so
    //    before any brief completes it must be `waiting` (the server-enforced
    //    join has not been satisfied yet).
    const summaryTask = initial.items.find(isSummary);
    if (!summaryTask) throw new Error('summary task not found');
    expect(summaryTask.status).toBe('waiting');

    // 3. Complete every brief (the test plays the executing agent).
    await Promise.all(
      initial.items
        .filter(isBrief)
        .map((t, i) => executeFreeform(t.id, t.inputCid, `brief summary ${i}`)),
    );

    // 4. Now that all briefs are completed, the task-service must promote the
    //    summary out of `waiting` (waiting -> queued). This is the transition
    //    the join actually exercises.
    const promoted = await pollUntil(
      () => agent.tasks.get(summaryTask.id),
      (t) => t.status !== 'waiting',
    );
    expect(promoted.status).not.toBe('waiting');

    // 5. Complete the (now claimable) summary.
    await executeFreeform(
      summaryTask.id,
      summaryTask.inputCid,
      'combined summary',
    );

    // 3. The workflow resolves with the joined result.
    const result = await runPromise;
    expect(result.correlationId).toBe(correlationId);
    expect(result.results).toHaveLength(input.briefs.length);
    expect(result.summary).toBe('combined summary');
  });
});
