/**
 * Producer baseline runner (issue #1588).
 *
 * Measures the MEASURED baseline the eval-engineering discipline requires: run
 * every committed `evals-v2/` scenario N times against one pinned model,
 * gate-graded, counting EVERY run (not retry-until-pass), and report the raw
 * per-scenario pass rate + failure-mode histogram. The producer is trap-blind —
 * it only ever sees `prompt.md`.
 *
 * Standalone; needs the e2e Docker stack up and `OLLAMA_API_KEY`. Invoke via:
 *
 *   BASELINE_MODEL=gpt-oss:120b-cloud BASELINE_REPEATS=4 OLLAMA_API_KEY=... \
 *   pnpm exec tsx apps/agent-daemon-e2e/src/baseline-runner.ts
 *
 * Emits `baseline-report.json` (override with BASELINE_OUT) and prints the
 * human summary to stderr.
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
// eslint-disable-next-line @nx/enforce-module-boundaries -- This eval runner intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { type Agent, connect } from '@themoltnet/sdk';

import { createDaemonTestHarness } from './setup.js';

const PROVIDER = 'ollama-cloud';
const CORPUS_ROOT = resolve(import.meta.dirname, '../../..', 'evals-v2');

function loadScenarios(): Scenario[] {
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readScenario(join(CORPUS_ROOT, entry.name)));
}

async function createProfile(
  agent: Agent,
  teamId: string,
  model: string,
): Promise<{ id: string }> {
  return agent.runtimeProfiles.create(
    {
      name: `baseline-${model}-${randomUUID()}`,
      runtimeKind: 'gondolin_pi',
      provider: PROVIDER,
      model,
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
}

/** Run the daemon once, TOLERATING a non-zero exit (a failed producer run is a
 * recorded baseline data point, not a fatal error). */
async function runTaskOnceTolerant(input: {
  agentName: string;
  agentRoot: string;
  piDir: string;
  sandboxRoot: string;
  teamId: string;
  profileId: string;
  taskId: string;
}): Promise<void> {
  const oldPiDir = process.env.PI_CODING_AGENT_DIR;
  const oldCwd = process.cwd();
  process.env.PI_CODING_AGENT_DIR = input.piDir;
  try {
    process.chdir(input.sandboxRoot);
    await runOnce([
      '--task-id',
      input.taskId,
      '--agent',
      input.agentName,
      '--profile',
      input.profileId,
      '--team',
      input.teamId,
      '--agent-root',
      input.agentRoot,
      // Short warm TTL: each baseline run must be independent sampling, not a
      // warm-slot continuation of the previous run.
      '--warm-session-ttl-sec',
      '1',
      '--max-turns',
      '14',
      '--max-bash-timeouts',
      '1',
    ]);
  } catch {
    // Swallow: the task's terminal status (read next) is the source of truth.
  } finally {
    process.chdir(oldCwd);
    if (oldPiDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = oldPiDir;
    }
  }
}

async function main(): Promise<void> {
  if (!process.env.OLLAMA_API_KEY) {
    throw new Error('baseline-runner requires OLLAMA_API_KEY');
  }
  const model = process.env.BASELINE_MODEL ?? 'gpt-oss:120b-cloud';
  const repeats = Number(process.env.BASELINE_REPEATS ?? '4');
  const scenarios = loadScenarios();
  const outPath = resolve(
    process.env.BASELINE_OUT ?? join(process.cwd(), 'baseline-report.json'),
  );

  const log = (m: string): void => console.error(`[baseline] ${m}`);
  log(`model=${model} repeats=${repeats} scenarios=${scenarios.length}`);

  const harness = await createDaemonTestHarness();
  const tempRoots: string[] = [];
  let report: BaselineReport;
  try {
    const creds = await harness.createAgent('baseline-runner');
    const agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const teamId = creds.personalTeamId;
    const diaryId = creds.privateDiaryId;

    const agentRoot = mkdtempSync(join(tmpdir(), 'baseline-agent-'));
    const piDir = mkdtempSync(join(tmpdir(), 'baseline-pi-'));
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'baseline-sbx-'));
    tempRoots.push(agentRoot, piDir, sandboxRoot);
    writeAgentCredentials({
      agentRoot,
      agentName: creds.name,
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
      publicKey: creds.keyPair.publicKey,
      privateKey: creds.keyPair.privateKey,
      fingerprint: creds.keyPair.fingerprint,
    });
    writePiConfig({ piDir, provider: PROVIDER, model });
    const profile = await createProfile(agent, teamId, model);

    report = await runBaseline(scenarios, model, repeats, {
      log,
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
        await runTaskOnceTolerant({
          agentName: creds.name,
          agentRoot,
          piDir,
          sandboxRoot,
          teamId,
          profileId: profile.id,
          taskId: task.id,
        });
        const final = await agent.tasks.get(task.id);
        return {
          taskId: task.id,
          attemptN:
            final.status === 'completed' && final.acceptedAttemptN
              ? final.acceptedAttemptN
              : null,
        };
      },
      runGates: (scenario, producer) =>
        checkGates(agent, producer.taskId, producer.attemptN, scenario.gates, {
          model,
          workspace: scenario.execution.workspace,
          teamId,
          taskType: scenario.taskType,
        }),
    });
  } finally {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    await harness.teardown();
  }

  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.error(summarizeBaseline(report));
  log(`wrote ${outPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
