/**
 * E2E: Agent daemon picks up tasks correctly.
 *
 * Insurance against regressions in the polling/claim loop. Runs against
 * the live Docker Compose stack (rest-api + Ory + DB). Does NOT exercise
 * the pi/Gondolin executor — that lives in its own integration suites.
 * The executor is stubbed so we can assert on the lifecycle end-to-end
 * without booting a VM.
 */

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

    // Tidy: fail the attempt so the task moves to a terminal state and
    // doesn't leak into the next test's listing.
    await agent.tasks.heartbeat(created.id, 1, {});
    await agent.tasks.fail(created.id, 1, {
      error: {
        code: 'test_cleanup',
        message: 'cleanup after polling source assertion',
        retryable: false,
      },
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

    // Tidy.
    await agent.tasks.heartbeat(created.id, 1, {});
    await agent.tasks.fail(created.id, 1, {
      error: {
        code: 'test_cleanup',
        message: 'cleanup after race assertion',
        retryable: false,
      },
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
        const output = {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'completed' as const,
          output: { packId: '00000000-0000-4000-8000-000000000000' },
          outputCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
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
    const created = await imposeCuratePackTask();

    // The realistic path: the imposer cancels the task while the
    // executor is running. The reporter's periodic heartbeat observes
    // cancelled:true on the next tick, aborts cancelSignal, and the
    // executor (which awaits the signal) returns promptly. The runtime
    // ensures the final output is status:'cancelled' regardless of what
    // the executor returned (#938).
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
          // Short interval so the reporter notices the cancel quickly.
          heartbeatIntervalMs: 250,
        }),
      executeTask: async (claimedTask, reporter) => {
        // Real executors (pi-extension) call reporter.open() first; this
        // fires the startup heartbeat AND starts the periodic timer that
        // observes cancelled:true on the next tick.
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });

        // Trigger the cancel from a separate microtask so the
        // reporter's heartbeat timer (250ms) gets a chance to fire
        // AFTER the cancel takes effect server-side.
        setTimeout(() => {
          void agent.tasks.cancel(claimedTask.task.id, {
            reason: 'e2e test cancellation',
          });
        }, 50);

        // Wait for cancelSignal to fire (the reporter's next heartbeat
        // sees cancelled:true). Bound the wait so a regression doesn't
        // hang the test — abort with a hard timeout if the signal
        // doesn't fire within 5s.
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

        // Honoring the cancel: return cancelled with the observed reason.
        // Close the reporter so the periodic heartbeat timer doesn't leak
        // into the next test or hang the process.
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

    // finalizeTask must be a no-op for cancelled outputs — calling
    // /complete or /fail after cancel returns 409.
    await finalizeTask(agent, output);

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('cancelled');
    expect(final.cancelReason).toBe('e2e test cancellation');
  }, 30_000);
});
