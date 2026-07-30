/**
 * Producer baseline measurement (issue #1588), run as a gated e2e test.
 *
 * The eval-engineering discipline requires a MEASURED baseline: run every
 * committed `evals-v2/` scenario N times against one pinned model, gate-graded,
 * counting EVERY run (not retry-until-pass), and report the raw per-scenario
 * pass rate + failure-mode histogram. The producer is trap-blind — it only ever
 * sees `prompt.md`.
 *
 * This is a MEASUREMENT, not a regression gate, so it lives behind its own flag
 * (`MOLTNET_BASELINE=1`) and only asserts that every scenario was measured — it
 * never fails on a low pass rate (that is the datum). It runs as a vitest e2e so
 * it uses the same workspace module resolution as the rest of the suite (a
 * standalone `tsx` script cannot resolve the source-direct workspace exports).
 * Needs the e2e stack up + `OLLAMA_API_KEY`. Configure via `BASELINE_REPEATS`
 * (default 4), `MOLTNET_AGENT_DAEMON_LIVE_MODEL` (default gpt-oss:120b-cloud),
 * `BASELINE_OUT` (default <cwd>/baseline-report.json).
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  type BaselineReport,
  buildRunEvalInput,
  checkGates,
  readScenario,
  runBaseline,
  type Scenario,
  summarizeBaseline,
  writeAgentCredentials,
  writePiConfig,
} from '@moltnet/agent-eval';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const BASELINE_FLAG = 'MOLTNET_BASELINE';
const LIVE_PROVIDER = 'ollama-cloud';
const LIVE_MODEL =
  process.env.MOLTNET_AGENT_DAEMON_LIVE_MODEL ?? 'gpt-oss:120b-cloud';
const REPEATS = Number(process.env.BASELINE_REPEATS ?? '4');

const describeBaseline = describe.skipIf(process.env[BASELINE_FLAG] !== '1');
const CORPUS_ROOT = join(import.meta.dirname, '../../..', 'evals-v2');

function loadScenarios(): Scenario[] {
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readScenario(join(CORPUS_ROOT, entry.name)));
}

describeBaseline('Producer baseline (live Ollama, e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;
  let agentName: string;
  let profileId: string;
  let agentRoot: string;
  let piDir: string;
  let sandboxRoot: string;
  const tempRoots: string[] = [];
  const scenarios = loadScenarios();

  beforeAll(async () => {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(`${BASELINE_FLAG}=1 requires OLLAMA_API_KEY`);
    }
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('baseline-daemon');
    agentName = creds.name;
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    agentRoot = mkdtempSync(join(tmpdir(), 'baseline-agent-'));
    piDir = mkdtempSync(join(tmpdir(), 'baseline-pi-'));
    sandboxRoot = mkdtempSync(join(tmpdir(), 'baseline-sbx-'));
    tempRoots.push(agentRoot, piDir, sandboxRoot);
    writeAgentCredentials({
      agentRoot,
      agentName,
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      publicKey: creds.keyPair.publicKey,
      privateKey: creds.keyPair.privateKey,
      fingerprint: creds.keyPair.fingerprint,
    });
    writePiConfig({ piDir, provider: LIVE_PROVIDER, model: LIVE_MODEL });

    const profile = await agent.runtimeProfiles.create(
      {
        name: `baseline-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        provider: LIVE_PROVIDER,
        model: LIVE_MODEL,
        leaseTtlSec: 300,
        heartbeatIntervalMs: 5_000,
        maxBatchSize: 1,
        maxTurns: 14,
        maxBashTimeouts: 1,
        sessionTtlSec: 600,
        workspaceTtlSec: 600,
        defaultWorkspaceMode: 'shared_mount',
        allowedWorkspaceModes: ['none', 'shared_mount'],
        requiredEnv: ['OLLAMA_API_KEY'],
        requiredTools: [],
        sandbox: {
          env: { NODE_OPTIONS: '--dns-result-order=ipv4first' },
          resources: { cpus: 2, memory: '2G' },
        },
      },
      { teamId },
    );
    profileId = profile.id;
  }, 120_000);

  afterAll(async () => {
    if (profileId) {
      await agent.runtimeProfiles.delete(profileId).catch(() => undefined);
    }
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    await harness?.teardown();
  });

  it('measures the producer baseline across the corpus', async () => {
    const report: BaselineReport = await runBaseline(
      scenarios,
      LIVE_MODEL,
      REPEATS,
      {
        log: (m) => console.log(`[baseline] ${m}`),
        runProducer: async (scenario) => {
          // Fresh task (fresh correlationId => fresh session key) per run so the
          // sampling is independent. Build the producer for this task type.
          const built =
            scenario.taskType === 'freeform'
              ? agent.tasks
                  .buildFreeform({
                    brief: scenario.prompt,
                    execution: { workspace: scenario.execution.workspace },
                  })
                  .title(`baseline ${scenario.slug}`)
                  .diary(diaryId)
                  .correlationId(randomUUID())
                  .maxAttempts(1)
                  .team(teamId)
                  .build()
              : agent.tasks
                  .buildRunEval(
                    buildRunEvalInput(scenario, { variant: 'baseline' }),
                  )
                  .title(`baseline ${scenario.slug}`)
                  .diary(diaryId)
                  .correlationId(randomUUID())
                  .maxAttempts(1)
                  .team(teamId)
                  .build();
          const task = await agent.tasks.create(built);

          const oldPiDir = process.env.PI_CODING_AGENT_DIR;
          const oldCwd = process.cwd();
          process.env.PI_CODING_AGENT_DIR = piDir;
          try {
            process.chdir(sandboxRoot);
            // Short warm TTL: each run is independent sampling, not a warm-slot
            // continuation. Tolerate a non-zero exit — a failed producer is a
            // recorded data point.
            await runOnce([
              '--task-id',
              task.id,
              '--agent',
              agentName,
              '--profile',
              profileId,
              '--team',
              teamId,
              '--agent-root',
              agentRoot,
              '--warm-session-ttl-sec',
              '1',
              '--max-turns',
              '14',
              '--max-bash-timeouts',
              '1',
            ]).catch(() => undefined);
          } finally {
            process.chdir(oldCwd);
            if (oldPiDir === undefined) {
              delete process.env.PI_CODING_AGENT_DIR;
            } else {
              process.env.PI_CODING_AGENT_DIR = oldPiDir;
            }
          }

          const final = await agent.tasks.get(task.id);
          if (final.status === 'completed' && final.acceptedAttemptN) {
            return { taskId: task.id, attemptN: final.acceptedAttemptN };
          }
          // Not completed: surface the failed attempt's terminal error code so
          // the baseline histogram distinguishes submit-format failures
          // (output_validation_failed) from tool/snapshot/cap failures.
          const attempts = await agent.tasks.listAttempts(task.id);
          const failed = [...attempts].reverse().find((a) => a.error);
          return {
            taskId: task.id,
            attemptN: null,
            failureCode: failed?.error?.code,
          };
        },
        runGates: (scenario, producer) =>
          checkGates(
            agent,
            producer.taskId,
            producer.attemptN,
            scenario.gates,
            {
              model: LIVE_MODEL,
              workspace: scenario.execution.workspace,
              teamId,
              taskType: scenario.taskType,
            },
          ),
      },
    );

    const outPath = resolve(
      process.env.BASELINE_OUT ?? join(process.cwd(), 'baseline-report.json'),
    );
    writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
    console.log('\n' + summarizeBaseline(report) + `\n(wrote ${outPath})`);

    // This is a measurement, not a regression gate: assert only that every
    // scenario was measured, never that a pass rate cleared a bar.
    expect(report.scenarios).toHaveLength(scenarios.length);
    for (const s of report.scenarios) {
      expect(s.cells).toHaveLength(REPEATS);
    }
  }, 3_600_000);
});
