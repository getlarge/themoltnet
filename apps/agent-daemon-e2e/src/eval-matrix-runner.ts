/**
 * Nightly model-matrix eval runner (issue #1588, plan step 8).
 *
 * Sweeps the committed `evals-v2/` corpus across N producer models, applies the
 * stage-1 deterministic gates, then scores gate-passing attempts with a single
 * PINNED judge model held constant across the whole matrix. Emits a
 * `score-matrix.json` artifact.
 *
 * This is a standalone runner, NOT part of the per-PR e2e suite. It requires the
 * full e2e Docker stack up and `OLLAMA_API_KEY` set. Invoke via:
 *
 *   MODELS="qwen3-coder:480b-cloud,glm-4.6:cloud" \
 *   MOLTNET_EVAL_JUDGE_MODEL="qwen3-coder:480b-cloud" \
 *   OLLAMA_API_KEY=... \
 *   pnpm exec tsx apps/agent-daemon-e2e/src/eval-matrix-runner.ts
 *
 * WARM-SLOT CONSTRAINT: `judge_eval_attempt` resolves the producer's runtime
 * slot (see apps/agent-daemon/src/lib/execution-plan-cache.ts,
 * ProducerContextResolutionError). That resolution is DB-backed
 * (`runtime_slots` / `runtime_sessions`), so it survives across separate
 * `runOnce` invocations as long as the producer slot has not expired — the same
 * mechanism the live-ollama continuation test relies on. We therefore run the
 * producer, then the judge, as two `runOnce` calls with a long
 * `--warm-session-ttl-sec`. No new daemon CLI export is needed.
 *
 * NOTE: the judge leg is the least-verified path — it has not been exercised
 * against a live stack yet. Validate end-to-end before trusting composites.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildJudgeInput,
  buildRunEvalInput,
  checkGates,
  readScenario,
  runMatrix,
  type Scenario,
  type ScoreMatrix,
  summarizeMatrix,
  writeAgentCredentials,
  writePiConfig,
} from '@moltnet/agent-eval';
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { type Agent, connect } from '@themoltnet/sdk';

import { createDaemonTestHarness } from './setup.js';

const PROVIDER = 'ollama-cloud';
const CORPUS_ROOT = resolve(import.meta.dirname, '../../..', 'evals-v2');
const WARM_TTL_SEC = '1200';

function parseModels(): string[] {
  const raw = process.env.MODELS ?? 'qwen3-coder:480b-cloud';
  return raw
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

function loadScenarios(): Scenario[] {
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readScenario(join(CORPUS_ROOT, entry.name)));
}

async function main(): Promise<void> {
  if (!process.env.OLLAMA_API_KEY) {
    throw new Error('eval-matrix-runner requires OLLAMA_API_KEY');
  }
  const models = parseModels();
  const judgeModel =
    process.env.MOLTNET_EVAL_JUDGE_MODEL ?? 'qwen3-coder:480b-cloud';
  const scenarios = loadScenarios();
  const outPath = resolve(
    process.env.EVAL_MATRIX_OUT ?? join(process.cwd(), 'score-matrix.json'),
  );

  const log = (m: string): void => console.error(`[eval-matrix] ${m}`);
  log(
    `models=${models.join(',')} judge=${judgeModel} scenarios=${scenarios.length}`,
  );

  const harness = await createDaemonTestHarness();
  const tempRoots: string[] = [];
  let matrix: ScoreMatrix;
  try {
    const creds = await harness.createAgent('eval-matrix-runner');
    const agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const teamId = creds.personalTeamId;
    const diaryId = creds.privateDiaryId;

    const agentRoot = mkdtempSync(join(tmpdir(), 'eval-matrix-agent-'));
    tempRoots.push(agentRoot);
    writeAgentCredentials({
      agentRoot,
      agentName: creds.name,
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    // One judge profile + one Pi config for the judge, pinned and reused across
    // the whole matrix so the judge model never varies.
    const judgeProfile = await createProfile(agent, teamId, judgeModel);
    const judgePiDir = mkdtempSync(join(tmpdir(), 'eval-matrix-judge-pi-'));
    tempRoots.push(judgePiDir);
    writePiConfig({ piDir: judgePiDir, provider: PROVIDER, model: judgeModel });

    // One producer profile + Pi config per model, reused across scenarios.
    const perModel = new Map<string, { profileId: string; piDir: string }>();
    for (const model of models) {
      const profile = await createProfile(agent, teamId, model);
      const piDir = mkdtempSync(join(tmpdir(), 'eval-matrix-pi-'));
      tempRoots.push(piDir);
      writePiConfig({ piDir, provider: PROVIDER, model });
      perModel.set(model, { profileId: profile.id, piDir });
    }

    const sandboxRoot = mkdtempSync(join(tmpdir(), 'eval-matrix-sbx-'));
    tempRoots.push(sandboxRoot);

    matrix = await runMatrix(models, scenarios, judgeModel, {
      log,
      runProducer: async (model, scenario) => {
        const cfg = perModel.get(model)!;
        const task = await agent.tasks.create(
          {
            taskType: 'run_eval',
            title: `matrix ${model} ${scenario.slug}`,
            diaryId,
            correlationId: randomUUID(),
            maxAttempts: 1,
            input: buildRunEvalInput(scenario, { variant: 'baseline' }),
          },
          { teamId },
        );
        await runTaskOnce({
          agentName: creds.name,
          agentRoot,
          piDir: cfg.piDir,
          sandboxRoot,
          teamId,
          profileId: cfg.profileId,
          taskId: task.id,
        });
        const final = await agent.tasks.get(task.id);
        if (final.status !== 'completed' || !final.acceptedAttemptN) {
          throw new Error(
            `producer task ${task.id} status=${final.status} accepted=${final.acceptedAttemptN}`,
          );
        }
        return { taskId: task.id, attemptN: final.acceptedAttemptN };
      },
      runGates: (model, scenario, producer) =>
        checkGates(agent, producer.taskId, producer.attemptN, scenario.gates, {
          model,
          workspace: scenario.execution.workspace,
        }),
      runJudge: async (scenario, producer) => {
        const judgeTask = await agent.tasks.create(
          {
            taskType: 'judge_eval_attempt',
            title: `judge ${scenario.slug}`,
            diaryId,
            maxAttempts: 1,
            input: buildJudgeInput(scenario, {
              targetTaskId: producer.taskId,
              targetAttemptN: producer.attemptN,
            }),
          },
          { teamId },
        );
        await runTaskOnce({
          agentName: creds.name,
          agentRoot,
          piDir: judgePiDir,
          sandboxRoot,
          teamId,
          profileId: judgeProfile.id,
          taskId: judgeTask.id,
        });
        const judged = await agent.tasks.get(judgeTask.id);
        const attempts = await agent.tasks.listAttempts(judgeTask.id);
        const accepted = attempts.find(
          (a) => a.attemptN === judged.acceptedAttemptN,
        );
        const composite = (accepted?.output as { composite?: number } | null)
          ?.composite;
        if (typeof composite !== 'number') {
          throw new Error(`judge task ${judgeTask.id} produced no composite`);
        }
        return { composite };
      },
    });
  } finally {
    for (const root of tempRoots) {
      rmSync(root, { recursive: true, force: true });
    }
    await harness.teardown();
  }

  writeFileSync(outPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
  console.error(summarizeMatrix(matrix));
  log(`wrote ${outPath}`);
}

async function createProfile(
  agent: Agent,
  teamId: string,
  model: string,
): Promise<{ id: string }> {
  return agent.runtimeProfiles.create(
    {
      name: `matrix-${model}-${randomUUID()}`,
      runtimeKind: 'gondolin_pi',
      provider: PROVIDER,
      model,
      leaseTtlSec: 300,
      heartbeatIntervalMs: 5_000,
      maxBatchSize: 1,
      maxTurns: 14,
      maxBashTimeouts: 1,
      sessionTtlSec: 1_200,
      workspaceTtlSec: 1_200,
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

async function runTaskOnce(input: {
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
    const exitCode = await runOnce([
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
      '--warm-session-ttl-sec',
      WARM_TTL_SEC,
      '--max-turns',
      '14',
      '--max-bash-timeouts',
      '1',
    ]);
    if (exitCode !== 0) {
      throw new Error(`runOnce exited ${exitCode} for task ${input.taskId}`);
    }
  } finally {
    process.chdir(oldCwd);
    if (oldPiDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = oldPiDir;
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
