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

    // 1. The three brief tasks appear — claim + complete each.
    const briefList = await pollUntil(
      () => agent.tasks.list({ correlationId }, { teamId }),
      (r) =>
        r.items.filter((t) => t.title?.startsWith('Brief')).length ===
        input.briefs.length,
    );
    const briefTasks = briefList.items.filter((t) =>
      t.title?.startsWith('Brief'),
    );
    await Promise.all(
      briefTasks.map((t, i) =>
        executeFreeform(t.id, t.inputCid, `brief summary ${i}`),
      ),
    );

    // 2. The summary task (gated by joinCondition over the briefs) appears and
    //    is claimable (not `waiting`) once the briefs are complete.
    const summaryList = await pollUntil(
      () => agent.tasks.list({ correlationId }, { teamId }),
      (r) => {
        const s = r.items.find((t) => t.title === 'Summarize parallel briefs');
        return !!s && s.status !== 'waiting';
      },
    );
    const summaryTask = summaryList.items.find(
      (t) => t.title === 'Summarize parallel briefs',
    );
    if (!summaryTask) throw new Error('summary task not found');
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
