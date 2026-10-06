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
import { rmSync } from 'node:fs';

import {
  buildExecutorRegistrationAttestationPayload,
  computeBytesCid,
  computeExecutorManifestCid,
  computeJsonCid,
  signExecutorAttestation,
} from '@moltnet/crypto-service';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This suite exercises daemon lifecycle finalization.
import { finalizeTask } from '@themoltnet/agent-daemon/lib/finalize.js';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  PollingApiTaskSource,
  resolveRuntimeProfile,
  validateRuntimeProfilePrerequisites,
} from '@themoltnet/agent-runtime';
import { type Agent, connect, MoltNetError } from '@themoltnet/sdk';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { buildProducerVerification } from './fixtures.js';
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
  let agentPrivateKey: string;
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
    agentPrivateKey = creds.keyPair.privateKey;
  }, 120_000);

  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  function proposeCuratePackTask(options?: { maxAttempts?: number }) {
    return agent.tasks.create(
      {
        taskType: 'curate_pack',
        diaryId,
        ...(options?.maxAttempts ? { maxAttempts: options.maxAttempts } : {}),
        input: {
          diaryId,
          taskPrompt: 'e2e daemon smoke',
        },
      },
      { teamId },
    );
  }

  function proposeFreeformTask(
    correlationId: string,
    continueFrom?: { taskId: string; attemptN: number },
  ) {
    return agent.tasks.create(
      {
        taskType: 'freeform',
        title: 'Freeform continuation e2e',
        diaryId,
        correlationId,
        input: {
          brief: 'Exercise freeform tasks_continue path in e2e',
          ...(continueFrom ? { continueFrom } : {}),
        },
      },
      { teamId },
    );
  }

  function proposePrReviewTask() {
    return agent.tasks.create(
      {
        taskType: 'pr_review',
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
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
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

  it('retries after ambiguous attempt failure when daemon triage says retry', async () => {
    const created = await agent.tasks.create(
      {
        taskType: 'curate_pack',
        diaryId,
        input: {
          diaryId,
          taskPrompt: 'e2e daemon retry triage',
        },
        maxAttempts: 2,
      },
      { teamId },
    );

    const seenAttempts: number[] = [];
    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent,
        teamId,
        taskTypes: ['curate_pack'],
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        seenAttempts.push(claimedTask.attemptN);
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });

        if (claimedTask.attemptN === 1) {
          const output = {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'failed' as const,
            output: null,
            outputCid: null,
            usage: { inputTokens: 1, outputTokens: 0 },
            durationMs: 1,
            error: {
              code: 'executor_unexpected_error',
              message: 'ambiguous runtime failure after local recovery',
              retryable: false,
            },
          };
          await reporter.close();
          return output;
        }

        const stubOutput = {
          packId: '00000000-0000-4000-8000-000000000001',
          packCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
          entries: [
            {
              entryId: '00000000-0000-4000-8000-000000000002',
              rank: 1,
              rationale: 'e2e retry stub entry',
            },
          ],
          recipeParams: {},
          summary: 'e2e retry curation summary after requeue.',
          verification: buildProducerVerification(claimedTask.task.inputCid),
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
      onTaskFinished: (output, claimedTask) =>
        finalizeTask(agent, output, {
          task: claimedTask.task,
          retryTriage: () =>
            Promise.resolve({
              decision: 'retry',
              confidence: 'medium',
              reason:
                'e2e injected triage says this ambiguous failure can recover.',
            }),
        }),
    });

    const outputs = await runtime.start();
    expect(outputs.map((output) => output.attemptN)).toEqual([1, 2]);
    expect(seenAttempts).toEqual([1, 2]);
    expect(outputs[0].status).toBe('failed');
    expect(outputs[1].status).toBe('completed');

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(2);
    const attempts = await agent.tasks.listAttempts(created.id);
    const failedAttempt = attempts.find((attempt) => attempt.attemptN === 1);
    expect(failedAttempt?.status).toBe('failed');
    expect(failedAttempt?.error).toMatchObject({
      code: 'executor_unexpected_error',
      retryable: true,
      retry: {
        source: 'triage',
        decision: 'retry',
        confidence: 'medium',
      },
    });
  }, 60_000);

  it('does not fail an attempt after /complete workflow result timeout', async () => {
    const created = await proposeCuratePackTask({ maxAttempts: 2 });
    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent,
        teamId,
        taskTypes: ['curate_pack'],
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });
        const stubOutput = {
          packId: '00000000-0000-4000-8000-000000001571',
          packCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
          entries: [
            {
              entryId: '00000000-0000-4000-8000-000000001572',
              rank: 1,
              rationale: 'e2e complete timeout stub entry',
            },
          ],
          recipeParams: {},
          summary: 'e2e complete timeout curation summary.',
          verification: buildProducerVerification(claimedTask.task.inputCid),
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

    const [output] = await runtime.start();
    const timeout = new MoltNetError('Conflict', {
      code: 'https://themolt.net/problems/conflict',
      statusCode: 409,
      detail: 'Complete workflow timed out waiting for result',
    });
    const complete = vi.fn().mockRejectedValue(timeout);
    const failAttempt = vi.fn(agent.tasks.failAttempt.bind(agent.tasks));
    const timeoutAgent = {
      ...agent,
      tasks: {
        ...agent.tasks,
        complete,
        failAttempt,
      },
    } as unknown as Agent;

    try {
      await expect(
        finalizeTask(timeoutAgent, output, { task: created }),
      ).rejects.toBe(timeout);
      expect(complete).toHaveBeenCalledWith(
        created.id,
        1,
        expect.objectContaining({ output: output.output }),
      );
      expect(failAttempt).not.toHaveBeenCalled();
      const current = await agent.tasks.get(created.id);
      expect(current.status).toBe('running');
    } finally {
      await agent.tasks.cancel(created.id, {
        reason: 'complete-timeout e2e cleanup',
      });
    }
  }, 60_000);

  it('runtime execution can upload and transmit task artifact CIDs', async () => {
    const correlationId = randomUUID();
    const created = await proposeFreeformTask(correlationId);

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['freeform'],
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });
        const artifactBytes = new TextEncoder().encode(
          `daemon artifact for ${claimedTask.task.id}`,
        );
        const artifactCid = await computeBytesCid(artifactBytes);
        const artifact = await agent.tasks.artifacts.upload(
          {
            attemptN: claimedTask.attemptN,
            taskId: claimedTask.task.id,
          },
          artifactBytes,
          {
            contentType: 'text/plain',
            kind: 'report',
            title: 'daemon-artifact.txt',
          },
          { teamId },
        );
        expect(artifact.cid).toBe(artifactCid);

        const stubOutput = {
          summary: `daemon artifact output for ${claimedTask.task.id}`,
          artifacts: [
            {
              kind: 'report',
              title: 'daemon-artifact.txt',
              cid: artifact.cid,
              contentType: artifact.contentType,
              sizeBytes: artifact.sizeBytes,
            },
          ],
          verification: buildProducerVerification(claimedTask.task.inputCid),
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
    await finalizeTask(agent, outputs[0]);

    const reader = await agent.tasks.readResult(created.id);
    const artifactRef = reader.artifactRef('report', 'context');
    expect(artifactRef).toMatchObject({
      taskId: created.id,
      artifact: {
        attemptN: 1,
        kind: 'report',
        title: 'daemon-artifact.txt',
      },
    });
    const artifacts = await agent.tasks.artifacts.list(created.id, { teamId });
    expect(artifacts.map((artifact) => artifact.cid)).toContain(
      artifactRef.artifact?.cid,
    );
  }, 60_000);

  it('runtime.start() can drive a full pr_review judgment loop with a stub executor', async () => {
    const created = await proposePrReviewTask();

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['pr_review'],
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
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
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
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
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
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
    const created = await agent.tasks.create(
      {
        taskType: 'curate_pack',
        diaryId,
        input: { diaryId, taskPrompt: 'e2e daemon shutdown abort' },
        maxAttempts: 2,
      },
      { teamId },
    );

    let abortedAttemptN: number | null = null;
    let runtime: AgentRuntime | null = null;
    runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: agent,
        teamId: teamId,
        taskTypes: ['curate_pack'],
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: agent.tasks,
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
          output: null,
          outputCid: null,
          usage: { inputTokens: 0, outputTokens: 0 },
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
          models: {
            generation: { provider: 'anthropic', model: 'claude-sonnet-4-5' },
          },

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
      return agent.tasks.create(
        {
          taskType: 'curate_pack',
          diaryId,
          input: { diaryId, taskPrompt: 'e2e allowedProfiles smoke' },
          allowedProfiles,
        },
        { teamId },
      );
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
        const result = await agent.tasks.list(
          {
            status: 'queued',
            profileId: otherProfile.id,
            limit: 50,
          },
          { teamId },
        );
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
        const result = await agent.tasks.list(
          {
            status: 'queued',
            profileId: profile.id,
            limit: 50,
          },
          { teamId },
        );
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
        const result = await agent.tasks.list(
          {
            status: 'queued',
            profileId: profile.id,
            limit: 50,
          },
          { teamId },
        );
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
        network: {
          allowedHosts: ['api.github.com', 'api.linear.app'],
          allowedInternalHosts: ['onboard-api.internal'],
        },
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
        expect(resolved.models.generation!.provider).toBe('anthropic');
        expect(resolved.models.generation!.model).toBe('claude-sonnet-4-5');
        expect(resolved.sandboxConfig).toEqual(allowedProfile.sandbox);

        const executorManifest = {
          schemaVersion: 'moltnet:executor-manifest:v1',
          runtime: {
            kind: resolved.runtimeKind,
            engine: 'pi',
            sandbox: 'gondolin',
            id: 'agent-daemon-e2e',
            version: '1',
          },
          profile: {
            id: resolved.id,
            definitionCid: resolved.definitionCid,
          },
          vm: {
            templateId: 'agent-daemon-e2e',
            templateVersion: '1',
            templateFingerprint: 'bafyreidaemon-e2e-template',
            guestAssetBuildId: 'agent-daemon-e2e',
          },
          tools: [],
          extensions: [],
          executables: [],
        };
        const executorFingerprint =
          computeExecutorManifestCid(executorManifest);
        const executorSignature = await signExecutorAttestation(
          buildExecutorRegistrationAttestationPayload({
            executorFingerprint,
          }),
          agentPrivateKey,
        );
        await agent.tasks.registerExecutorManifest({
          executorManifest,
          executorFingerprint,
          executorSignature,
        });

        const source = new PollingApiTaskSource({
          agent,
          teamId,
          taskTypes: ['curate_pack'],
          profileId: resolved.id,
          stopWhenEmpty: true,
          logger: silentLogger,
          executorFingerprints: {
            [resolved.id]: executorFingerprint,
          },
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
          validateRuntimeProfilePrerequisites(
            resolved,
            {},
            {
              tools: [],
              executables: [],
            },
          ),
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
