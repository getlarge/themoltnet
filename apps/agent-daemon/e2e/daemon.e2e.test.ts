/**
 * E2E: Agent daemon picks up tasks correctly.
 *
 * Insurance against regressions in the polling/claim loop. Runs against
 * the live Docker Compose stack (rest-api + Ory + DB). Does NOT exercise
 * the pi/Gondolin executor — that lives in its own integration suites.
 * The executor is stubbed so we can assert on the lifecycle end-to-end
 * without booting a VM.
 */

import { computeJsonCid } from '@moltnet/crypto-service';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finalizeTask } from '../src/lib/finalize.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

/**
 * The realistic local-daemon scenario is "one agent, one team, one
 * daemon" — the same agent imposes a task and runs the daemon that
 * claims it. Cross-agent claiming requires team membership (canAccessTeam
 * on /tasks list); a diary grant alone is not sufficient for the list
 * endpoint, only for individual claim/heartbeat/complete by id.
 */
describe('Agent daemon (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-daemon');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
  }, 120_000);

  afterAll(async () => {
    await harness?.teardown();
  });

  function imposeCuratePackTask() {
    return agent.tasks.create({
      taskType: 'curate_pack',
      teamId,
      diaryId,
      input: {
        diaryId,
        taskPrompt: 'e2e daemon smoke',
      },
    });
  }

  it('PollingApiTaskSource claims a queued task and exits drain mode when empty', async () => {
    const created = await imposeCuratePackTask();

    const source = new PollingApiTaskSource({
      agent: agent,
      teamId: teamId,
      taskTypes: ['curate_pack'],
      leaseTtlSec: 60,
      stopWhenEmpty: true,
      logger: silentLogger,
    });

    const claimed = await source.claim();
    expect(claimed?.task.id).toBe(created.id);
    expect(claimed?.attemptN).toBe(1);

    // Drain mode: next claim sees an empty queue (the task is now running)
    // and resolves null instead of looping.
    const second = await source.claim();
    expect(second).toBeNull();

    // Tidy: cancel the task so the row moves to terminal `cancelled`
    // and doesn't leak into the next test's listing. Cancel works
    // regardless of attempt state — `fail` would race the workflow's
    // claimed → running transition (the heartbeat returns before the
    // workflow has actually flipped attempt.status).
    await agent.tasks.cancel(created.id, {
      reason: 'cleanup after polling source assertion',
    });
  });

  it('two parallel claim() calls race on the same task — server CAS picks one winner', async () => {
    const created = await imposeCuratePackTask();

    const sourceA = new PollingApiTaskSource({
      agent: agent,
      teamId: teamId,
      taskTypes: ['curate_pack'],
      leaseTtlSec: 60,
      stopWhenEmpty: true,
      logger: silentLogger,
    });
    // Same agent identity for both sources — what we're testing is the
    // server-side CAS, not multi-tenant behaviour. The HTTP layer treats
    // the two claim() calls as independent races regardless.
    const sourceB = new PollingApiTaskSource({
      agent: agent,
      teamId: teamId,
      taskTypes: ['curate_pack'],
      leaseTtlSec: 60,
      stopWhenEmpty: true,
      logger: silentLogger,
    });

    const [a, b] = await Promise.all([sourceA.claim(), sourceB.claim()]);
    const winners = [a, b].filter((c) => c?.task.id === created.id);
    const losers = [a, b].filter((c) => c === null);
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);

    // Tidy. Cancel rather than fail to avoid the heartbeat-vs-workflow
    // race (see test 1 for the same trick).
    await agent.tasks.cancel(created.id, {
      reason: 'cleanup after race assertion',
    });
  });

  it('runtime.start() drives a full claim → execute → complete loop', async () => {
    const created = await imposeCuratePackTask();

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['curate_pack'],
        leaseTtlSec: 60,
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
          leaseTtlSec: 60,
          // 0 disables the periodic timer; the reporter still fires the
          // immediate startup heartbeat which is what we need to satisfy
          // DBOS recv('started').
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        // Real executors (pi-extension) call reporter.open() first to fire
        // the startup heartbeat that satisfies DBOS recv('started') and
        // moves the attempt from claimed → running. Without it, /complete
        // returns 409 "attempt has not been started".
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });
        // Stub output that satisfies CuratePackOutput. The server runs
        // validateTaskOutput against this on /complete, so we can't get
        // away with a degenerate {packId} payload (#882 added per-type
        // output validation).
        const stubOutput = {
          packId: '00000000-0000-4000-8000-000000000001',
          packCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
          entries: [
            {
              entryId: '00000000-0000-4000-8000-000000000002',
              rank: 1,
              rationale: 'e2e stub entry',
            },
          ],
          recipeParams: {},
          summary:
            'e2e stub curation summary, two sentences satisfy minLength.',
        };
        const output = {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'completed' as const,
          output: stubOutput,
          // Server validates outputCid matches the canonical CID over the
          // output bytes. Compute it instead of using a placeholder.
          outputCid: await computeJsonCid(stubOutput),
          usage: { inputTokens: 1, outputTokens: 1 },
          durationMs: 1,
        };
        await reporter.finalize(output.usage);
        await reporter.close();
        return output;
      },
    });

    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    const [output] = outputs;
    expect(output.taskId).toBe(created.id);
    expect(output.status).toBe('completed');

    // The runtime hands the output off; the daemon is responsible for
    // reporting it. Use the daemon's actual finalize helper.
    await finalizeTask(agent, output);

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
  }, 60_000);

  it('honors imposer-side cancel — reporter heartbeat trips cancelSignal, runtime returns cancelled', async () => {
    // The full cancel contract from #938: imposer cancels the task while
    // the executor is running. The reporter's periodic heartbeat (250ms)
    // observes cancelled:true on the next tick, aborts cancelSignal, and
    // the executor (which awaits the signal) returns status:'cancelled'
    // promptly. The runtime ensures the final output is 'cancelled' even
    // if the executor returned anything else. finalizeTask is a no-op
    // because the row is already terminal.
    const created = await imposeCuratePackTask();

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['curate_pack'],
        leaseTtlSec: 60,
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
          leaseTtlSec: 60,
          heartbeatIntervalMs: 250,
        }),
      executeTask: async (claimedTask, reporter) => {
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });

        // Cancel from the imposer side after the first heartbeat.
        setTimeout(() => {
          void agent.tasks.cancel(claimedTask.task.id, {
            reason: 'e2e test cancellation',
          });
        }, 50);

        // Wait for cancelSignal to fire — the reporter's next heartbeat
        // (within 250ms of the cancel) sees cancelled:true and aborts.
        // Hard-fail with a 5s budget so a regression doesn't hang.
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error('cancelSignal did not fire within 5s')),
            5_000,
          );
          if (reporter.cancelSignal.aborted) {
            clearTimeout(timer);
            resolve();
            return;
          }
          reporter.cancelSignal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });

        const out = {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'cancelled' as const,
          output: null,
          outputCid: null,
          usage: { inputTokens: 0, outputTokens: 0 },
          durationMs: 0,
          error: {
            code: 'task_cancelled',
            message: reporter.cancelReason ?? 'cancelled by imposer during e2e',
            retryable: false,
          },
        };
        await reporter.close();
        return out;
      },
    });

    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    const [output] = outputs;
    expect(output.taskId).toBe(created.id);
    expect(output.status).toBe('cancelled');

    // finalizeTask is a no-op for cancelled outputs — calling /complete
    // or /fail after cancel returns 409 because the row is already
    // terminal.
    await finalizeTask(agent, output);

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('cancelled');
    expect(final.cancelReason).toBe('e2e test cancellation');
  }, 30_000);
});
