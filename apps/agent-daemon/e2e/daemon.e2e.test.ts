/**
 * E2E: Agent daemon picks up tasks correctly.
 *
 * Insurance against regressions in the polling/claim loop. Runs against
 * the live Docker Compose stack (rest-api + Ory + DB). Does NOT exercise
 * the pi/Gondolin executor — that lives in its own integration suites.
 * The executor is stubbed so we can assert on the lifecycle end-to-end
 * without booting a VM.
 */

import { randomUUID } from 'node:crypto';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  ApiTaskSource,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { resolveTaskWorktreePath } from '@themoltnet/pi-extension';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { DaemonSlotIdentity } from '../src/lib/daemon-slot-identity.js';
import {
  createExecutionPlanCache,
  type RuntimeSlotStore,
} from '../src/lib/execution-plan-cache.js';
import { finalizeTask } from '../src/lib/finalize.js';
import {
  resolveRuntimeProfile,
  validateRuntimeProfilePrerequisites,
} from '../src/lib/runtime-profile.js';
import { createApiRuntimeSlotStore } from '../src/lib/runtime-slots.js';
import { resolveLatestPiSessionPath } from '../src/lib/session-files.js';
import { ensureDaemonStateDirs } from '../src/lib/state-dir.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

type RuntimeProfileSandbox = Awaited<
  ReturnType<Agent['runtimeProfiles']['get']>
>['sandbox'];

function buildProducerVerification(inputCid: string) {
  return {
    inputCid,
    results: [
      {
        id: 'submit-output',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail: 'submit tool criterion satisfied in daemon e2e stub',
      },
    ],
    passed: true,
  };
}

/**
 * The realistic local-daemon scenario is "one agent, one team, one
 * daemon" — the same agent proposes a task and runs the daemon that
 * claims it. Cross-agent claiming requires team membership (canAccessTeam
 * on /tasks list); a diary grant alone is not sufficient for the list
 * endpoint, only for individual claim/heartbeat/complete by id.
 */
describe('Agent daemon (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;
  const tempRoots: string[] = [];

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

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  function proposeCuratePackTask() {
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

  function proposeFulfillBriefTask(correlationId: string) {
    return agent.tasks.create({
      taskType: 'fulfill_brief',
      title: 'Warm session e2e',
      teamId,
      diaryId,
      correlationId,
      input: {
        brief: 'Exercise runtime slot persistence in e2e',
        scopeHint: 'daemon-e2e',
      },
    });
  }

  function proposeFreeformTask(
    correlationId: string,
    continueFrom?: { taskId: string; attemptN: number },
  ) {
    return agent.tasks.create({
      taskType: 'freeform',
      title: 'Freeform warm-resume e2e',
      teamId,
      diaryId,
      correlationId,
      input: {
        brief: 'Exercise freeform tasks_continue warm-resume path in e2e',
        ...(continueFrom ? { continueFrom } : {}),
      },
    });
  }

  function proposePrReviewTask() {
    return agent.tasks.create({
      taskType: 'pr_review',
      teamId,
      diaryId,
      input: {
        subject: {
          title: 'PR #1: Complexity review smoke',
          summary:
            'Judge the complexity and reviewability of a change under a binary rubric.',
          inspectionHints: ['Use the local workspace if needed.'],
        },
        taskPrompt:
          'Treat this as a local smoke test. Do not attempt any network mutation.',
        successCriteria: {
          version: 1,
          rubric: {
            rubricId: 'pr-complexity-binary-e2e',
            version: 'v1',
            preamble: 'Assess reviewability and complexity only.',
            criteria: [
              {
                id: 'cognitive_load',
                description: 'The change is easy to review in one pass.',
                weight: 0.6,
                scoring: 'boolean',
              },
              {
                id: 'blast_radius',
                description: 'The change is narrowly scoped.',
                weight: 0.4,
                scoring: 'boolean',
              },
            ],
          },
        },
      },
    });
  }

  function createRuntimeProfile(name: string) {
    return agent.runtimeProfiles.create(
      {
        name,
        runtimeKind: 'gondolin_pi',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        leaseTtlSec: 900,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 10,
        sandbox: {},
      },
      { teamId },
    );
  }

  it('PollingApiTaskSource claims a queued task and exits drain mode when empty', async () => {
    const created = await proposeCuratePackTask();

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
    const created = await proposeCuratePackTask();

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
    const created = await proposeCuratePackTask();

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
          verification: buildProducerVerification(claimedTask.task.inputCid),
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

  it('runtime.start() can drive a full pr_review judgment loop with a stub executor', async () => {
    const created = await proposePrReviewTask();

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['pr_review'],
        leaseTtlSec: 60,
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
          leaseTtlSec: 60,
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });

        const stubOutput = {
          scores: [
            {
              criterionId: 'cognitive_load',
              score: 1,
              rationale: 'The diff stays focused and reviewer-oriented.',
            },
            {
              criterionId: 'blast_radius',
              score: 0,
              rationale: 'The change still touches a shared path.',
            },
          ],
          composite: 0.6,
          verdict: 'Moderate review cost with one clear risk axis.',
        };
        const output = {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'completed' as const,
          output: stubOutput,
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

    await finalizeTask(agent, output);

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
  }, 60_000);

  it('fails a claimed attempt when executor throws before reporter.open()', async () => {
    const created = await proposeCuratePackTask();

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
          heartbeatIntervalMs: 0,
        }),
      onTaskFinished: (output) => finalizeTask(agent, output),
      executeTask: async () => {
        throw new Error('resume failed before reporter open');
      },
    });

    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    const [output] = outputs;
    expect(output.taskId).toBe(created.id);
    expect(output.status).toBe('failed');
    expect(output.error?.code).toBe('executor_threw');

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('failed');
  }, 60_000);

  it('honors proposer-side cancel — reporter heartbeat trips cancelSignal, runtime returns cancelled', async () => {
    // The full cancel contract from #938: proposer cancels the task while
    // the executor is running. The reporter's periodic heartbeat (250ms)
    // observes cancelled:true on the next tick, aborts cancelSignal, and
    // the executor (which awaits the signal) returns status:'cancelled'
    // promptly. The runtime ensures the final output is 'cancelled' even
    // if the executor returned anything else. finalizeTask is a no-op
    // because the row is already terminal.
    const created = await proposeCuratePackTask();

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

        // Cancel from the proposer side after the first heartbeat.
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
            message:
              reporter.cancelReason ?? 'cancelled by proposer during e2e',
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

  it('daemon shutdown aborts the active attempt without cancelling the task (#1382)', async () => {
    // maxAttempts:2 so the requeued task is reclaimable after the abort.
    const created = await agent.tasks.create({
      taskType: 'curate_pack',
      teamId,
      diaryId,
      input: { diaryId, taskPrompt: 'e2e daemon shutdown abort' },
      maxAttempts: 2,
    });

    let abortedAttemptN: number | null = null;
    let runtime: AgentRuntime | null = null;
    runtime = new AgentRuntime({
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
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        // open() fires the startup heartbeat → attempt claimed → running,
        // matching the real pi-extension lifecycle before a SIGTERM.
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });
        // Simulate the daemon's `drain` handler firing on SIGINT/SIGTERM
        // mid-execution: stop the loop (so it doesn't re-claim the
        // requeued task) and abort the active attempt server-side.
        abortedAttemptN = claimedTask.attemptN;
        runtime?.stop('e2e simulated SIGTERM');
        await agent.tasks.abortAttempt(
          claimedTask.task.id,
          claimedTask.attemptN,
          { reason: 'runner_sigterm' },
        );
        await reporter.close();
        // Local executor returns a cancelled-shaped output (what
        // pi-extension yields when its cancelSignal fires). The daemon
        // does not finalize an interrupted attempt.
        return {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'cancelled' as const,
          durationMs: 1,
        };
      },
    });

    await runtime.start();
    expect(abortedAttemptN).toBe(1);

    // abortAttempt() polls server-side until the workflow settles, so by the
    // time it resolved (inside the executor) the task already requeued.
    // The aborted attempt is recorded as `aborted` (not cancelled/failed).
    const attempts = await agent.tasks.listAttempts(created.id);
    expect(attempts.find((a) => a.attemptN === 1)!.status).toBe('aborted');

    // The task is requeued and reclaimable — NOT terminal-cancelled, and no
    // cancellation metadata written.
    const requeued = await agent.tasks.get(created.id);
    expect(requeued.status).toBe('queued');
    expect(requeued.cancelReason).toBeFalsy();
  }, 30_000);

  it('reuses remote runtime slot resources across fulfill_brief tasks', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-slot-e2e-'));
    tempRoots.push(mountRoot);

    const stateDirs = ensureDaemonStateDirs(mountRoot);
    const slotStore = createApiRuntimeSlotStore({
      agent,
    });
    const runtimeProfile = await createRuntimeProfile(
      `slot-reuse-${randomUUID()}`,
    );
    const slotIdentity: DaemonSlotIdentity = {
      agentName: 'e2e-daemon',
      runtimeProfileId: runtimeProfile.id,
    };
    const correlationId = randomUUID();
    const warmSessionTtlSec = 60;

    const first = await proposeFulfillBriefTask(correlationId);
    const firstOutput = await runStubbedSlotAwareTask({
      agent,
      taskId: first.id,
      mountRoot,
      stateDirs,
      slotStore,
      slotIdentity,
      provider: runtimeProfile.provider,
      model: runtimeProfile.model,
      warmSessionTtlSec,
    });
    expect(firstOutput.output.status).toBe('completed');

    const firstSlot = await slotStore.findLatestSlotByTaskAttempt(
      teamId,
      first.id,
      firstOutput.output.attemptN,
    );
    expect(firstSlot?.session?.sessionDir).toBeTruthy();
    expect(firstSlot?.session?.sessionPath).toBeTruthy();
    expect(firstSlot?.workspace?.worktreePath).toBeTruthy();
    expect(existsSync(firstSlot!.session!.sessionDir)).toBe(true);
    expect(existsSync(firstSlot!.session!.sessionPath!)).toBe(true);
    expect(existsSync(firstSlot!.workspace!.worktreePath)).toBe(true);

    const second = await proposeFulfillBriefTask(correlationId);
    const secondOutput = await runStubbedSlotAwareTask({
      agent,
      taskId: second.id,
      mountRoot,
      stateDirs,
      slotStore,
      slotIdentity,
      provider: runtimeProfile.provider,
      model: runtimeProfile.model,
      warmSessionTtlSec,
    });
    expect(secondOutput.output.status).toBe('completed');

    const secondSlot = await slotStore.findLatestSlotByTaskAttempt(
      teamId,
      second.id,
      secondOutput.output.attemptN,
    );
    expect(secondSlot?.session?.sessionDir).toBe(
      firstSlot!.session!.sessionDir,
    );
    expect(secondSlot?.session?.sessionPath).toBe(
      firstSlot!.session!.sessionPath,
    );
    expect(secondSlot?.workspace?.worktreePath).toBe(
      firstSlot!.workspace!.worktreePath,
    );

    const persistedSessionLog = readFileSync(
      firstSlot!.session!.sessionPath!,
      'utf8',
    );
    expect(persistedSessionLog).toContain(first.id);
    expect(persistedSessionLog).toContain(second.id);

    const finalFirst = await agent.tasks.get(first.id);
    const finalSecond = await agent.tasks.get(second.id);
    expect(finalFirst.status).toBe('completed');
    expect(finalSecond.status).toBe('completed');
  }, 60_000);

  describe('freeform tasks_continue runtime-slot affinity', () => {
    // Canonical fake-parent scenario for #1287: seed a freeform runtime
    // slot via the stub harness (real task row + remote runtime slot rows,
    // no LLM, no Pi boot), then create a continuation. The affinity filter
    // claims when the remote slot points at a local session directory.

    it('claims a continuation when the runtime slot is available to this daemon', async () => {
      const mountRoot = mkdtempSync(
        join(tmpdir(), 'daemon-continue-claim-e2e-'),
      );
      tempRoots.push(mountRoot);

      const stateDirs = ensureDaemonStateDirs(mountRoot);
      const slotStore = createApiRuntimeSlotStore({
        agent,
      });
      const runtimeProfile = await createRuntimeProfile(
        `slot-continue-${randomUUID()}`,
      );
      const slotIdentity: DaemonSlotIdentity = {
        agentName: 'e2e-daemon',
        runtimeProfileId: runtimeProfile.id,
      };
      const correlationId = randomUUID();
      // Long TTL so the affinity filter's existsSync(sessionDir) check
      // and the server-side `slotResumableUntil` future-check both pass
      // by the time the continuation task is created and polled.
      const warmSessionTtlSec = 600;

      try {
        // 1. Run a real freeform parent task through the stub harness.
        //    This seeds: a `freeform` row + completed attempt with
        //    daemonState.slotResumableUntil; a daemon_slots row keyed by
        //    `freeform:correlation:<corr>`; a session row pointing at a
        //    .jsonl on disk under stateDirs.piSessionsDir.
        const parent = await proposeFreeformTask(correlationId);
        const parentRun = await runStubbedSlotAwareTask({
          agent,
          taskId: parent.id,
          mountRoot,
          stateDirs,
          slotStore,
          slotIdentity,
          provider: runtimeProfile.provider,
          model: runtimeProfile.model,
          warmSessionTtlSec,
        });
        expect(parentRun.output.status).toBe('completed');

        const seeded = await slotStore.findLatestSlotByTaskAttempt(
          teamId,
          parent.id,
          parentRun.output.attemptN,
        );
        const seededSessionPath = seeded?.session?.sessionPath as string;
        expect(seededSessionPath).toBeTruthy();
        expect(existsSync(seededSessionPath)).toBe(true);
        // Stamp a distinctive marker into the seeded JSONL so we can
        // assert the continuation plan's forkFromSessionPath points
        // back at the same byte sequence.
        const seededMarker = `seed-marker-${parent.id}`;
        appendFileSync(seededSessionPath, `${seededMarker}\n`, 'utf8');

        // Sanity: the parent's completion reported a future slotResumableUntil
        // (otherwise the server will reject the continuation with
        // freeform.sourceNotResumeEligible before the daemon ever sees it).
        const parentRow = await agent.tasks.get(parent.id);
        const parentAttempts = await agent.tasks.listAttempts(parent.id);
        const acceptedAttempt = parentAttempts.find(
          (a) => a.attemptN === parentRow.acceptedAttemptN,
        ) as
          | { daemonState?: { slotResumableUntil?: string | null } }
          | undefined;
        expect(acceptedAttempt?.daemonState?.slotResumableUntil).toBeTruthy();

        // 2. Create the continuation task.
        const continuationCorrelationId = randomUUID();
        const continuation = await proposeFreeformTask(
          continuationCorrelationId,
          { taskId: parent.id, attemptN: parentRun.output.attemptN },
        );

        // 3. Drive a PollingApiTaskSource WITH the runtime slot store.
        //    The affinity filter should let this claim through.
        const claimingSource = new PollingApiTaskSource({
          agent,
          teamId,
          taskTypes: ['freeform'],
          leaseTtlSec: 60,
          stopWhenEmpty: true,
          slotRegistry: slotStore,
          logger: silentLogger,
        });
        const claimed = await claimingSource.claim();
        expect(claimed?.task.id).toBe(continuation.id);

        // 4. Build the execution plan the daemon would build at this
        //    point — same path as the production runtime.
        const planCache = createExecutionPlanCache({
          stateDirs,
          slotIdentity,
          warmSessionTtlSec,
          slotRegistry: slotStore,
        });
        const continuationPlan = await planCache.getOrCreate(claimed!);
        expect(continuationPlan.workspaceMode).toBe('dedicated_worktree');
        expect(continuationPlan.sessionPersistence?.forkFromSessionPath).toBe(
          seededSessionPath,
        );
        // Assert the prepared sessionDir is the per-continuation directory
        // (the daemon will fork the seed into it before booting Pi).
        expect(continuationPlan.sessionPersistence?.sessionDir).toContain(
          `continue-${continuation.id}-attempt-${claimed!.attemptN}`,
        );
        // The forkFromSessionPath must point at the seeded JSONL on disk,
        // verbatim. Read it back to confirm the marker we stamped is there.
        const forkPath =
          continuationPlan.sessionPersistence!.forkFromSessionPath!;
        expect(existsSync(forkPath)).toBe(true);
        const forkContents = readFileSync(forkPath, 'utf8');
        expect(forkContents).toContain(seededMarker);

        // Tidy.
        await agent.tasks.cancel(continuation.id, {
          reason: 'cleanup after runtime-slot continuation claim assertion',
        });
      } finally {
        await slotStore.close();
      }
    }, 60_000);
  });

  describe('Task.allowedProfiles filter', () => {
    // Empty allowlist tasks remain visible to every daemon. A pinned
    // task is only listed when the daemon asks for one of the task's
    // allowed profiles. Mirrors the advisory routing of `--task-types`:
    // server filters at SQL level, daemon also pre-filters at the source
    // level. No claim-time rejection.

    async function createProfile(
      name: string,
      sandbox: RuntimeProfileSandbox = {},
      overrides: Partial<
        Parameters<Agent['runtimeProfiles']['create']>[0]
      > = {},
    ) {
      return agent.runtimeProfiles.create(
        {
          name,
          runtimeKind: 'gondolin_pi',
          provider: 'anthropic',
          model: 'claude-sonnet-4-5',
          leaseTtlSec: 900,
          heartbeatIntervalMs: 15_000,
          maxBatchSize: 10,
          sandbox,
          ...overrides,
        },
        { teamId },
      );
    }

    function deleteProfile(profileId: string) {
      return agent.runtimeProfiles.delete(profileId);
    }

    function proposePinnedCuratePackTask(
      allowedProfiles: { profileId: string }[],
    ) {
      return agent.tasks.create({
        taskType: 'curate_pack',
        teamId,
        diaryId,
        input: { diaryId, taskPrompt: 'e2e allowedProfiles smoke' },
        allowedProfiles,
      });
    }

    it('persists allowedProfiles profile refs', async () => {
      const profile = await createProfile(`daemon-e2e-${randomUUID()}`);
      const created = await proposePinnedCuratePackTask([
        { profileId: profile.id },
      ]);
      try {
        expect(created.allowedProfiles).toEqual([{ profileId: profile.id }]);
      } finally {
        await agent.tasks.cancel(created.id, { reason: 'cleanup' });
        await deleteProfile(profile.id);
      }
    });

    it('filters out pinned tasks for a non-matching profile', async () => {
      const allowedProfile = await createProfile(`daemon-e2e-${randomUUID()}`);
      const otherProfile = await createProfile(`daemon-e2e-${randomUUID()}`);
      const pinned = await proposePinnedCuratePackTask([
        { profileId: allowedProfile.id },
      ]);
      try {
        const result = await agent.tasks.list({
          teamId,
          status: 'queued',
          profileId: otherProfile.id,
          limit: 50,
        });
        expect(result.items.find((t) => t.id === pinned.id)).toBeUndefined();
      } finally {
        await agent.tasks.cancel(pinned.id, { reason: 'cleanup' });
        await deleteProfile(allowedProfile.id);
        await deleteProfile(otherProfile.id);
      }
    });

    it('returns pinned tasks to a matching profile', async () => {
      const profile = await createProfile(`daemon-e2e-${randomUUID()}`);
      const pinned = await proposePinnedCuratePackTask([
        { profileId: profile.id },
      ]);
      try {
        const result = await agent.tasks.list({
          teamId,
          status: 'queued',
          profileId: profile.id,
          limit: 50,
        });
        expect(result.items.find((t) => t.id === pinned.id)).toBeDefined();
      } finally {
        await agent.tasks.cancel(pinned.id, { reason: 'cleanup' });
        await deleteProfile(profile.id);
      }
    });

    it('returns unrestricted tasks regardless of runtime profile', async () => {
      const profile = await createProfile(`daemon-e2e-${randomUUID()}`);
      const unrestricted = await proposeCuratePackTask();
      try {
        const result = await agent.tasks.list({
          teamId,
          status: 'queued',
          profileId: profile.id,
          limit: 50,
        });
        expect(
          result.items.find((t) => t.id === unrestricted.id),
        ).toBeDefined();
      } finally {
        await agent.tasks.cancel(unrestricted.id, { reason: 'cleanup' });
        await deleteProfile(profile.id);
      }
    });

    it('resolves a remote runtime profile and claims only matching pinned tasks', async () => {
      const profileName = `daemon-e2e-${randomUUID()}`;
      const allowedProfile = await createProfile(profileName, {
        snapshot: { allowedHosts: ['api.github.com'] },
        resources: { cpus: 4, memory: '4G' },
      });
      const otherProfile = await createProfile(`daemon-e2e-${randomUUID()}`);
      const otherPinned = await proposePinnedCuratePackTask([
        { profileId: otherProfile.id },
      ]);
      const matchingPinned = await proposePinnedCuratePackTask([
        { profileId: allowedProfile.id },
      ]);

      try {
        const resolved = await resolveRuntimeProfile({
          agent,
          profile: profileName,
          teamId,
          cwd: process.cwd(),
        });
        expect(resolved.id).toBe(allowedProfile.id);
        expect(resolved.provider).toBe('anthropic');
        expect(resolved.model).toBe('claude-sonnet-4-5');
        expect(resolved.leaseTtlSec).toBe(900);
        expect(resolved.heartbeatIntervalMs).toBe(15_000);
        expect(resolved.maxBatchSize).toBe(10);
        expect(resolved.sandboxConfig).toEqual(allowedProfile.sandbox);

        const source = new PollingApiTaskSource({
          agent,
          teamId,
          taskTypes: ['curate_pack'],
          profileId: resolved.id,
          leaseTtlSec: resolved.leaseTtlSec,
          stopWhenEmpty: true,
          logger: silentLogger,
        });

        const claimed = await source.claim();
        expect(claimed?.task.id).toBe(matchingPinned.id);
        expect(claimed?.task.allowedProfiles).toEqual([
          { profileId: allowedProfile.id },
        ]);
      } finally {
        await agent.tasks.cancel(matchingPinned.id, {
          reason: 'cleanup after remote profile daemon claim assertion',
        });
        await agent.tasks.cancel(otherPinned.id, {
          reason: 'cleanup after remote profile daemon claim assertion',
        });
        await deleteProfile(allowedProfile.id);
        await deleteProfile(otherProfile.id);
      }
    });

    it('refuses a remote profile with missing prerequisites before claiming', async () => {
      const profileName = `daemon-e2e-${randomUUID()}`;
      const profile = await createProfile(
        profileName,
        {},
        {
          requiredEnv: ['MOLTNET_E2E_REQUIRED_ENV_DOES_NOT_EXIST'],
          requiredTools: ['moltnet-e2e-required-tool-does-not-exist'],
        },
      );
      const pinned = await proposePinnedCuratePackTask([
        { profileId: profile.id },
      ]);

      try {
        const resolved = await resolveRuntimeProfile({
          agent,
          profile: profileName,
          teamId,
          cwd: process.cwd(),
        });

        expect(() =>
          validateRuntimeProfilePrerequisites(resolved, {}, ''),
        ).toThrow(/prerequisites are not satisfied/);

        const taskAfterValidationFailure = await agent.tasks.get(pinned.id);
        expect(taskAfterValidationFailure.status).toBe('queued');
        const attempts = await agent.tasks.listAttempts(pinned.id);
        expect(attempts).toEqual([]);
      } finally {
        await agent.tasks.cancel(pinned.id, {
          reason: 'cleanup after profile prerequisite assertion',
        });
        await deleteProfile(profile.id);
      }
    });
  });
});

interface StubbedSlotAwareTaskArgs {
  agent: Agent;
  taskId: string;
  mountRoot: string;
  stateDirs: ReturnType<typeof ensureDaemonStateDirs>;
  slotStore: RuntimeSlotStore;
  slotIdentity: DaemonSlotIdentity;
  provider: string;
  model: string;
  warmSessionTtlSec: number;
}

async function runStubbedSlotAwareTask(args: StubbedSlotAwareTaskArgs) {
  const executionPlans = createExecutionPlanCache({
    stateDirs: args.stateDirs,
    slotIdentity: args.slotIdentity,
    warmSessionTtlSec: args.warmSessionTtlSec,
    slotRegistry: args.slotStore,
  });
  let usedExecutionPlan: Awaited<
    ReturnType<typeof executionPlans.getOrCreate>
  > | null = null;

  const runtime = new AgentRuntime({
    source: new ApiTaskSource({
      agent: args.agent,
      taskId: args.taskId,
      leaseTtlSec: 60,
    }),
    makeReporter: () =>
      new ApiTaskReporter({
        tasks: args.agent.tasks,
        leaseTtlSec: 60,
        heartbeatIntervalMs: 0,
      }),
    executeTask: async (claimedTask, reporter) => {
      const executionPlan = await executionPlans.getOrCreate(claimedTask);
      usedExecutionPlan = executionPlan;
      const worktreePath = resolveRecordedWorkspacePath(
        args.mountRoot,
        executionPlan,
      );

      if (executionPlan.slotKey && executionPlan.sessionPersistence) {
        mkdirSync(executionPlan.sessionPersistence.sessionDir, {
          recursive: true,
        });
        if (worktreePath) mkdirSync(worktreePath, { recursive: true });

        const sessionPath =
          resolveLatestPiSessionPath(
            executionPlan.sessionPersistence.sessionDir,
          ) ??
          join(
            executionPlan.sessionPersistence.sessionDir,
            '20260514T000000.jsonl',
          );
        if (existsSync(sessionPath)) {
          appendFileSync(sessionPath, `${claimedTask.task.id}\n`, 'utf8');
        } else {
          writeFileSync(sessionPath, `${claimedTask.task.id}\n`, 'utf8');
        }
        if (worktreePath) {
          writeFileSync(
            join(worktreePath, 'task-marker.txt'),
            claimedTask.task.id,
            'utf8',
          );
        }

        await args.slotStore.beginSlot({
          ...args.slotIdentity,
          teamId: claimedTask.task.teamId,
          provider: args.provider,
          model: args.model,
          slotKey: executionPlan.slotKey,
          taskType: claimedTask.task.taskType,
          sessionDir: executionPlan.sessionPersistence.sessionDir,
          sessionPath,
          workspaceId: executionPlan.workspaceId,
          worktreePath,
          worktreeBranch: executionPlan.worktreeBranch,
          lastTaskId: claimedTask.task.id,
          lastAttemptN: claimedTask.attemptN,
        });
      }

      await reporter.open({
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
      });

      const taskOutput = await buildStubbedTaskOutput(
        claimedTask,
        executionPlan,
      );
      const output = {
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
        status: 'completed' as const,
        output: taskOutput,
        outputCid: await computeJsonCid(taskOutput),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      };
      await reporter.finalize(output.usage);
      await reporter.close();
      if (executionPlan.slotKey) {
        await args.slotStore.finishSlot(
          claimedTask.task.teamId,
          claimedTask.task.id,
          claimedTask.attemptN,
          args.slotIdentity,
          executionPlan.slotKey,
          args.provider,
          args.model,
          executionPlan.sessionPersistence
            ? resolveLatestPiSessionPath(
                executionPlan.sessionPersistence.sessionDir,
              )
            : null,
        );
      }

      return output;
    },
  });

  const outputs = await runtime.start();
  expect(outputs).toHaveLength(1);
  const [output] = outputs;
  // Mirror the production daemon: forward the runtime-slot expiry through to
  // /complete so freeform attempts report a non-null `slotResumableUntil`,
  // which is what `validateFreeformInputAsync` requires for continuation
  // tasks to pass create-time async validation.
  const plan = usedExecutionPlan;
  const taskForCtx =
    plan && plan.slotKey ? await args.agent.tasks.get(args.taskId) : null;
  const slotForCtx =
    plan && plan.slotKey
      ? ((
          await args.slotStore.findLatestSlotByTaskAttempt(
            taskForCtx.teamId,
            args.taskId,
            output.attemptN,
          )
        )?.slot ?? null)
      : null;
  await finalizeTask(args.agent, output, {
    task: taskForCtx ?? undefined,
    slot: slotForCtx ? { expiresAtMs: slotForCtx.expiresAtMs } : null,
  });
  return {
    output,
    executionPlan: usedExecutionPlan,
  };
}

async function buildStubbedTaskOutput(
  claimedTask: {
    task: {
      id: string;
      taskType: string;
      input: Record<string, unknown>;
    };
    attemptN: number;
  },
  executionPlan: {
    worktreeBranch: string | null;
  },
): Promise<Record<string, unknown>> {
  switch (claimedTask.task.taskType) {
    case 'run_eval':
      return {
        response: `stubbed run_eval output for ${claimedTask.task.id}`,
        totalTokens: 10,
        durationMs: 100,
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
        verification: buildProducerVerification(claimedTask.task.inputCid),
      };
    case 'freeform':
      return {
        summary: `stubbed freeform output for ${claimedTask.task.id}`,
        // The server auto-injects a `submit-output` success criterion on
        // freeform task creation, so the producer-side verification record
        // is required even when the proposer didn't supply criteria.
        verification: buildProducerVerification(claimedTask.task.inputCid),
      };
    case 'fulfill_brief':
      return {
        branch: executionPlan.worktreeBranch ?? 'feat/daemon-e2e',
        commits: [],
        pullRequestUrl: null,
        diaryEntryIds: [],
        summary: `stubbed runtime slot e2e output for ${claimedTask.task.id}`,
        verification: buildProducerVerification(claimedTask.task.inputCid),
      };
    case 'curate_pack':
      return {
        packId: '00000000-0000-4000-8000-000000000001',
        packCid: 'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
        entries: [
          {
            entryId: '00000000-0000-4000-8000-000000000002',
            rank: 1,
            rationale: 'e2e stub entry',
          },
        ],
        recipeParams: {},
        summary: `stubbed runtime slot e2e output for ${claimedTask.task.id}`,
        verification: buildProducerVerification(claimedTask.task.inputCid),
      };
    case 'judge_eval_attempt':
      return {
        targetTaskId:
          (claimedTask.task.input.targetTaskId as string | undefined) ??
          'missing-target',
        targetAttemptN:
          (claimedTask.task.input.targetAttemptN as number | undefined) ?? 1,
        variantLabel: 'baseline',
        scores: [{ criterionId: 'c1', score: 1, rationale: 'stubbed pass' }],
        composite: 1,
        verdict: 'judge attached producer context successfully',
        traceparent: '00-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa-bbbbbbbbbbbbbbbb-01',
      };
    default:
      return {
        branch: executionPlan.worktreeBranch ?? 'feat/daemon-e2e',
        commits: [],
        pullRequestUrl: null,
        diaryEntryIds: [],
        summary: `stubbed runtime slot e2e output for ${claimedTask.task.id}`,
      };
  }
}

function resolveRecordedWorkspacePath(
  mountRoot: string,
  executionPlan: {
    workspaceId: string | null;
    workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  },
): string | null {
  if (!executionPlan.workspaceId) return null;
  return executionPlan.workspaceMode === 'scratch_mount'
    ? join(
        mountRoot,
        '.moltnet',
        'd',
        'task-workspaces',
        executionPlan.workspaceId,
      )
    : resolveTaskWorktreePath(mountRoot, executionPlan.workspaceId);
}
