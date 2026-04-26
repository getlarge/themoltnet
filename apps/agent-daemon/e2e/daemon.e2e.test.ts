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
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { finalizeTask } from '../src/lib/finalize.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

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
      log: () => {},
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
      log: () => {},
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
      log: () => {},
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
        log: () => {},
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

  it('survives imposer-side cancel without crashing the loop and reports nothing on the cancelled task', async () => {
    // NOTE: This test asserts what's robust today, not what the cancel
    // contract was originally designed to deliver. #938 intended the
    // reporter's heartbeat to observe cancelled:true and abort
    // cancelSignal so the executor returns status:'cancelled' promptly.
    // In practice the heartbeat 403s after cancel because the workflow's
    // terminal persist tx removes the Keto claimant tuple before the
    // next heartbeat fires (#949). Until that's fixed, the visible
    // contract is narrower:
    //   - the daemon does not crash
    //   - finalizeTask() does not throw on the cancelled task (it skips
    //     reporting because the row is already terminal)
    //   - the server task ends in 'cancelled' with the supplied reason
    // The runtime override at runtime.ts:130 still ensures we never
    // report 'completed' on a cancelled task; the executor's actual
    // exit (here it times out and throws → 'failed') is irrelevant
    // because finalizeTask doesn't try to report it.
    const created = await imposeCuratePackTask();

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['curate_pack'],
        leaseTtlSec: 60,
        stopWhenEmpty: true,
        log: () => {},
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

        // Wait for either cancelSignal (the contract that #949 will
        // restore) or a 1s budget (current reality — heartbeats 403,
        // signal never fires). The runtime is fine either way.
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            resolve();
          };
          const timer = setTimeout(done, 1_000);
          if (reporter.cancelSignal.aborted) done();
          else
            reporter.cancelSignal.addEventListener('abort', done, {
              once: true,
            });
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

    // finalizeTask must not throw on cancelled output regardless of
    // whether the executor itself returned 'cancelled' (signal worked)
    // or the runtime forced it post-execute via the override
    // (runtime.ts:130 fires when reporter.cancelSignal.aborted).
    await finalizeTask(agent, output);

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('cancelled');
    expect(final.cancelReason).toBe('e2e test cancellation');
  }, 30_000);
});
