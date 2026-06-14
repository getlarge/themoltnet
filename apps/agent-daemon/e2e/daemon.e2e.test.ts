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
import { DatabaseSync } from 'node:sqlite';

import { computeJsonCid } from '@moltnet/crypto-service';
import {
  type DaemonSlotIdentity,
  DaemonSlotRegistry,
  resolveLatestPiSessionPath,
} from '@themoltnet/agent-daemon-state';
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

import { createExecutionPlanCache } from '../src/lib/execution-plan-cache.js';
import { finalizeTask } from '../src/lib/finalize.js';
import {
  resolveRuntimeProfile,
  validateRuntimeProfilePrerequisites,
} from '../src/lib/runtime-profile.js';
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
        brief: 'Exercise daemon slot persistence in e2e',
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

  function proposeRunEvalTask(
    correlationId: string,
    variantLabel = 'baseline',
  ) {
    return agent.tasks.create({
      taskType: 'run_eval',
      teamId,
      diaryId,
      correlationId,
      input: {
        scenario: { prompt: 'e2e eval scenario' },
        variantLabel,
        execution: { mode: 'vitro', workspace: 'none' },
        context: [],
        successCriteria: { version: 1 },
      },
    });
  }

  function proposeJudgeEvalAttemptTask(
    correlationId: string,
    targetTaskId: string,
  ) {
    return agent.tasks.create({
      taskType: 'judge_eval_attempt',
      teamId,
      diaryId,
      correlationId,
      input: {
        targetTaskId,
        targetAttemptN: 1,
        successCriteria: {
          version: 1,
          rubric: {
            rubricId: 'e2e-judge-attach',
            version: 'v1',
            scope: 'eval',
            criteria: [
              {
                id: 'c1',
                description: 'judge can inspect the attempt',
                weight: 1,
                scoring: 'llm_score',
              },
            ],
          },
        },
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

  it('reuses daemon slot resources across fulfill_brief tasks and reaps them on expiry', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-slot-e2e-'));
    tempRoots.push(mountRoot);

    const stateDirs = ensureDaemonStateDirs(mountRoot);
    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    const slotIdentity: DaemonSlotIdentity = {
      agentName: 'e2e-daemon',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };
    const correlationId = randomUUID();
    const warmSessionTtlSec = 60;

    try {
      const first = await proposeFulfillBriefTask(correlationId);
      const firstOutput = await runStubbedSlotAwareTask({
        agent,
        taskId: first.id,
        mountRoot,
        stateDirs,
        slotRegistry,
        slotIdentity,
        warmSessionTtlSec,
      });
      expect(firstOutput.output.status).toBe('completed');

      const afterFirst = readDaemonSlotState(stateDirs.registryDbPath);
      expect(afterFirst.slots).toHaveLength(1);
      expect(afterFirst.sessions).toHaveLength(1);
      expect(afterFirst.workspaces).toHaveLength(1);
      expect(afterFirst.slots[0]?.taskType).toBe('fulfill_brief');
      expect(afterFirst.slots[0]?.state).toBe('idle');
      expect(afterFirst.slots[0]?.lastTaskId).toBe(first.id);

      const firstSessionDir = afterFirst.sessions[0]?.sessionDir;
      const firstSessionPath = afterFirst.sessions[0]?.sessionPath;
      const firstWorktreePath = afterFirst.workspaces[0]?.worktreePath;
      expect(firstSessionDir).toBeTruthy();
      expect(firstSessionPath).toBeTruthy();
      expect(firstWorktreePath).toBeTruthy();
      expect(existsSync(firstSessionDir!)).toBe(true);
      expect(existsSync(firstSessionPath!)).toBe(true);
      expect(existsSync(firstWorktreePath!)).toBe(true);

      const second = await proposeFulfillBriefTask(correlationId);
      const secondOutput = await runStubbedSlotAwareTask({
        agent,
        taskId: second.id,
        mountRoot,
        stateDirs,
        slotRegistry,
        slotIdentity,
        warmSessionTtlSec,
      });
      expect(secondOutput.output.status).toBe('completed');

      const afterSecond = readDaemonSlotState(stateDirs.registryDbPath);
      expect(afterSecond.slots).toHaveLength(1);
      expect(afterSecond.sessions).toHaveLength(1);
      expect(afterSecond.workspaces).toHaveLength(1);
      expect(afterSecond.slots[0]?.slotKey).toBe(afterFirst.slots[0]?.slotKey);
      expect(afterSecond.sessions[0]?.sessionDir).toBe(firstSessionDir);
      expect(afterSecond.sessions[0]?.sessionPath).toBe(firstSessionPath);
      expect(afterSecond.workspaces[0]?.worktreePath).toBe(firstWorktreePath);
      expect(afterSecond.slots[0]?.lastTaskId).toBe(second.id);

      const persistedSessionLog = readFileSync(firstSessionPath!, 'utf8');
      expect(persistedSessionLog).toContain(first.id);
      expect(persistedSessionLog).toContain(second.id);

      const finalFirst = await agent.tasks.get(first.id);
      const finalSecond = await agent.tasks.get(second.id);
      expect(finalFirst.status).toBe('completed');
      expect(finalSecond.status).toBe('completed');

      const expired = await slotRegistry.reapExpiredSlots(Date.now() + 120_000);
      expect(expired).toHaveLength(1);
      expect(expired[0]?.slot.slotKey).toBe(afterSecond.slots[0]?.slotKey);
      expect(existsSync(firstSessionDir!)).toBe(false);
      expect(existsSync(firstWorktreePath!)).toBe(false);

      const afterReap = readDaemonSlotState(stateDirs.registryDbPath);
      expect(afterReap.slots).toHaveLength(0);
      expect(afterReap.sessions).toHaveLength(0);
      expect(afterReap.workspaces).toHaveLength(0);
    } finally {
      await slotRegistry.close();
    }
  }, 60_000);

  it('fails judge_eval_attempt after producer warm-slot reap', async () => {
    const mountRoot = mkdtempSync(join(tmpdir(), 'daemon-judge-attach-e2e-'));
    tempRoots.push(mountRoot);

    const stateDirs = ensureDaemonStateDirs(mountRoot);
    const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
    const slotIdentity: DaemonSlotIdentity = {
      agentName: 'e2e-daemon',
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    };
    const correlationId = randomUUID();
    const warmSessionTtlSec = 60;
    try {
      const producer = await proposeRunEvalTask(correlationId);
      const producerRun = await runStubbedSlotAwareTask({
        agent,
        taskId: producer.id,
        mountRoot,
        stateDirs,
        slotRegistry,
        slotIdentity,
        warmSessionTtlSec,
      });
      expect(producerRun.output.status).toBe('completed');
      expect(producerRun.executionPlan.workspaceMode).toBe('scratch_mount');

      const afterProducer = readDaemonSlotState(stateDirs.registryDbPath);
      expect(afterProducer.slots).toHaveLength(1);
      expect(afterProducer.sessions).toHaveLength(1);
      expect(afterProducer.workspaces).toHaveLength(1);

      const producerSessionPath = afterProducer.sessions[0]?.sessionPath;
      const producerWorkspacePath = afterProducer.workspaces[0]?.worktreePath;
      expect(producerSessionPath).toBeTruthy();
      expect(producerWorkspacePath).toBeTruthy();
      expect(existsSync(producerSessionPath!)).toBe(true);
      expect(existsSync(producerWorkspacePath!)).toBe(true);
      const expired = await slotRegistry.reapExpiredSlots(Date.now() + 120_000);
      expect(expired).toHaveLength(1);
      expect(existsSync(producerSessionPath!)).toBe(false);
      expect(existsSync(producerWorkspacePath!)).toBe(false);

      const judge = await proposeJudgeEvalAttemptTask(
        correlationId,
        producer.id,
      );
      const judgeRun = await runStubbedSlotAwareTask({
        agent,
        taskId: judge.id,
        mountRoot,
        stateDirs,
        slotRegistry,
        slotIdentity,
        warmSessionTtlSec,
      });

      expect(judgeRun.output.status).toBe('failed');
      expect(judgeRun.output.error?.code).toBe('executor_threw');
      expect(judgeRun.output.error?.message).toContain(
        'No live producer daemon slot found',
      );
      expect(judgeRun.executionPlan).toBeNull();
    } finally {
      await slotRegistry.close();
    }
  }, 60_000);

  describe('freeform tasks_continue warm-slot affinity', () => {
    // Canonical fake-parent scenario for #1287: seed a freeform warm
    // slot via the stub harness (real task row + slot registry rows,
    // no LLM, no Pi boot), then create a continuation. Affinity filter
    // claims on the daemon that owns the slot; skips on the daemon
    // that doesn't.

    it('claims a continuation when the warm slot is alive on this daemon', async () => {
      const mountRoot = mkdtempSync(
        join(tmpdir(), 'daemon-continue-claim-e2e-'),
      );
      tempRoots.push(mountRoot);

      const stateDirs = ensureDaemonStateDirs(mountRoot);
      const slotRegistry = new DaemonSlotRegistry(stateDirs.registryDbPath);
      const slotIdentity: DaemonSlotIdentity = {
        agentName: 'e2e-daemon',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
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
          slotRegistry,
          slotIdentity,
          warmSessionTtlSec,
        });
        expect(parentRun.output.status).toBe('completed');

        const seeded = readDaemonSlotState(stateDirs.registryDbPath);
        expect(seeded.slots).toHaveLength(1);
        expect(seeded.sessions).toHaveLength(1);
        const seededSessionPath = seeded.sessions[0]?.sessionPath as string;
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

        // 3. Drive a PollingApiTaskSource WITH the warm slot registry.
        //    The affinity filter should let this claim through.
        const claimingSource = new PollingApiTaskSource({
          agent,
          teamId,
          taskTypes: ['freeform'],
          leaseTtlSec: 60,
          stopWhenEmpty: true,
          slotRegistry,
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
          slotRegistry,
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
          reason: 'cleanup after warm-slot continuation claim assertion',
        });
      } finally {
        await slotRegistry.close();
      }
    }, 60_000);

    it('skips a continuation when this daemon has no slot for it', async () => {
      // Two registries: one ("owner") seeds a parent; the other
      // ("stranger") simulates a daemon that never ran the parent.
      // The stranger's affinity filter should refuse to claim.
      const ownerRoot = mkdtempSync(join(tmpdir(), 'daemon-continue-owner-'));
      const strangerRoot = mkdtempSync(
        join(tmpdir(), 'daemon-continue-stranger-'),
      );
      tempRoots.push(ownerRoot, strangerRoot);

      const ownerStateDirs = ensureDaemonStateDirs(ownerRoot);
      const strangerStateDirs = ensureDaemonStateDirs(strangerRoot);
      const ownerRegistry = new DaemonSlotRegistry(
        ownerStateDirs.registryDbPath,
      );
      const strangerRegistry = new DaemonSlotRegistry(
        strangerStateDirs.registryDbPath,
      );
      const slotIdentity: DaemonSlotIdentity = {
        agentName: 'e2e-daemon',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
      };
      const correlationId = randomUUID();
      const warmSessionTtlSec = 600;

      try {
        const parent = await proposeFreeformTask(correlationId);
        const parentRun = await runStubbedSlotAwareTask({
          agent,
          taskId: parent.id,
          mountRoot: ownerRoot,
          stateDirs: ownerStateDirs,
          slotRegistry: ownerRegistry,
          slotIdentity,
          warmSessionTtlSec,
        });
        expect(parentRun.output.status).toBe('completed');

        const continuationCorrelationId = randomUUID();
        const continuation = await proposeFreeformTask(
          continuationCorrelationId,
          { taskId: parent.id, attemptN: parentRun.output.attemptN },
        );

        // Stranger source: drain mode + empty slot registry. The
        // affinity filter sees no slot for the source attempt and
        // refuses to claim; the source returns null instead of looping.
        const strangerSource = new PollingApiTaskSource({
          agent,
          teamId,
          taskTypes: ['freeform'],
          leaseTtlSec: 60,
          stopWhenEmpty: true,
          slotRegistry: strangerRegistry,
          logger: silentLogger,
        });
        const claimed = await strangerSource.claim();
        expect(claimed).toBeNull();

        // The continuation row remains queued — no attempt was opened
        // against it by the stranger.
        const continuationRow = await agent.tasks.get(continuation.id);
        expect(continuationRow.status).toBe('queued');

        // Tidy.
        await agent.tasks.cancel(continuation.id, {
          reason: 'cleanup after warm-slot continuation skip assertion',
        });
      } finally {
        await ownerRegistry.close();
        await strangerRegistry.close();
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
  slotRegistry: DaemonSlotRegistry;
  slotIdentity: DaemonSlotIdentity;
  warmSessionTtlSec: number;
}

async function runStubbedSlotAwareTask(args: StubbedSlotAwareTaskArgs) {
  const executionPlans = createExecutionPlanCache({
    stateDirs: args.stateDirs,
    slotIdentity: args.slotIdentity,
    warmSessionTtlSec: args.warmSessionTtlSec,
    slotRegistry: args.slotRegistry,
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
      await args.slotRegistry.reapExpiredSlots();
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

        await args.slotRegistry.beginSlot({
          ...args.slotIdentity,
          slotKey: executionPlan.slotKey,
          taskType: claimedTask.task.taskType,
          sessionDir: executionPlan.sessionPersistence.sessionDir,
          sessionPath,
          workspaceId: executionPlan.workspaceId,
          worktreePath,
          worktreeBranch: executionPlan.worktreeBranch,
          lastTaskId: claimedTask.task.id,
          lastAttemptN: claimedTask.attemptN,
          ttlSec: args.warmSessionTtlSec,
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
        await args.slotRegistry.finishSlot(
          args.slotIdentity,
          executionPlan.slotKey,
          args.warmSessionTtlSec,
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
  // Mirror the production daemon: forward the warm-slot expiry through to
  // /complete so freeform attempts report a non-null `slotResumableUntil`,
  // which is what `validateFreeformInputAsync` requires for continuation
  // tasks to pass create-time async validation.
  const plan = usedExecutionPlan;
  const taskForCtx =
    plan && plan.slotKey ? await args.agent.tasks.get(args.taskId) : null;
  const slotForCtx =
    plan && plan.slotKey
      ? ((
          await args.slotRegistry.findLatestProducerSlotByTaskAttempt(
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
        summary: `stubbed daemon slot e2e output for ${claimedTask.task.id}`,
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
        summary: `stubbed daemon slot e2e output for ${claimedTask.task.id}`,
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
        summary: `stubbed daemon slot e2e output for ${claimedTask.task.id}`,
      };
  }
}

interface DaemonSlotState {
  slots: Array<Record<string, unknown>>;
  sessions: Array<Record<string, unknown>>;
  workspaces: Array<Record<string, unknown>>;
}

function readDaemonSlotState(dbPath: string): DaemonSlotState {
  const db = new DatabaseSync(dbPath);
  try {
    return {
      slots: db
        .prepare(
          'SELECT slot_key as slotKey, task_type as taskType, state, last_task_id as lastTaskId FROM daemon_slots',
        )
        .all() as unknown as Array<Record<string, unknown>>,
      sessions: db
        .prepare(
          'SELECT slot_key as slotKey, session_dir as sessionDir, session_path as sessionPath FROM daemon_slot_sessions',
        )
        .all() as unknown as Array<Record<string, unknown>>,
      workspaces: db
        .prepare(
          'SELECT slot_key as slotKey, workspace_id as workspaceId, worktree_path as worktreePath FROM daemon_slot_workspaces',
        )
        .all() as unknown as Array<Record<string, unknown>>,
    };
  } finally {
    db.close();
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
