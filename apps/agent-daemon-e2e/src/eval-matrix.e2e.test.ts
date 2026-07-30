/**
 * Nightly model-matrix eval (issue #1588), run as a gated vitest e2e test.
 *
 * Sweeps the committed `evals-v2/` corpus across the producer models in `MODELS`
 * (comma-separated; default a single model), applies the stage-1 deterministic
 * gates, then scores gate-passing run_eval attempts with a single PINNED judge
 * model. Emits `score-matrix.json`.
 *
 * NOT a per-PR gate — it is gated behind `MOLTNET_EVAL_MATRIX=1` and driven by
 * the scheduled `eval-matrix.yml` workflow, which fans out one runner per model
 * (a GH matrix) so the models run in parallel. It runs as a vitest e2e (not a
 * `tsx` script) so it resolves the workspace's source-direct exports the same
 * way the rest of the suite does.
 *
 * Judge caveat: `judge_eval_attempt` only accepts `run_eval` targets, so freeform
 * scenarios are GATE-scored (composite = 1 when gates pass, judge skipped) until
 * a freeform-capable judge exists. WARM-SLOT: the judge resolves the producer's
 * runtime slot from the DB, so it survives across the two `runOnce` calls as long
 * as the producer slot has not expired (long `--warm-session-ttl-sec`).
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
  seedScenarioWorkspace,
  stageScenarioInputArtifacts,
  summarizeMatrix,
  writeAgentCredentials,
  writePiConfig,
} from '@moltnet/agent-eval';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const MATRIX_FLAG = 'MOLTNET_EVAL_MATRIX';
const PROVIDER = 'ollama-cloud';
const WARM_TTL_SEC = '1200';
const CORPUS_ROOT = join(import.meta.dirname, '../../..', 'evals-v2');

const describeMatrix = describe.skipIf(process.env[MATRIX_FLAG] !== '1');

function parseModels(): string[] {
  return (process.env.MODELS ?? 'gpt-oss:120b-cloud')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

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
      // Model ids contain ':' / '.' which the profile-name pattern rejects.
      name: `matrix-${model.replace(/[^a-zA-Z0-9_-]/g, '-')}-${randomUUID()}`,
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

describeMatrix('Eval matrix (live Ollama, e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;
  let agentName: string;
  let judgePiDir: string;
  let judgeProfileId: string;
  let agentRoot: string;
  const perModel = new Map<string, { profileId: string; piDir: string }>();
  const producerSandboxRoots = new Map<string, string>();
  const tempRoots: string[] = [];
  const models = parseModels();
  const judgeModel =
    process.env.MOLTNET_EVAL_JUDGE_MODEL ?? 'qwen3.5:397b-cloud';
  const scenarios = loadScenarios();

  beforeAll(async () => {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(`${MATRIX_FLAG}=1 requires OLLAMA_API_KEY`);
    }
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('eval-matrix-daemon');
    agentName = creds.name;
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    agentRoot = mkdtempSync(join(tmpdir(), 'eval-matrix-agent-'));
    tempRoots.push(agentRoot);
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

    const judgeProfile = await createProfile(agent, teamId, judgeModel);
    judgeProfileId = judgeProfile.id;
    judgePiDir = mkdtempSync(join(tmpdir(), 'eval-matrix-judge-pi-'));
    tempRoots.push(judgePiDir);
    writePiConfig({ piDir: judgePiDir, provider: PROVIDER, model: judgeModel });

    for (const model of models) {
      const profile = await createProfile(agent, teamId, model);
      const piDir = mkdtempSync(join(tmpdir(), 'eval-matrix-pi-'));
      tempRoots.push(piDir);
      writePiConfig({ piDir, provider: PROVIDER, model });
      perModel.set(model, { profileId: profile.id, piDir });
    }
  }, 300_000);

  afterAll(async () => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    await harness?.teardown();
  });

  it('sweeps the model matrix and scores gate-passing attempts', async () => {
    const matrix: ScoreMatrix = await runMatrix(models, scenarios, judgeModel, {
      log: (m) => console.log(`[eval-matrix] ${m}`),
      runProducer: async (model, scenario) => {
        const cfg = perModel.get(model)!;
        const sandboxRoot = mkdtempSync(join(tmpdir(), 'eval-matrix-sbx-'));
        tempRoots.push(sandboxRoot);
        seedScenarioWorkspace(scenario, sandboxRoot);
        const inputArtifacts = await stageScenarioInputArtifacts(
          agent.tasks.artifacts,
          scenario,
          teamId,
        );
        const builder =
          scenario.taskType === 'freeform'
            ? agent.tasks
                .buildFreeform({
                  brief: scenario.prompt,
                  execution: { workspace: scenario.execution.workspace },
                })
                .title(`matrix ${model} ${scenario.slug}`)
                .diary(diaryId)
                .correlationId(randomUUID())
                .maxAttempts(1)
                .team(teamId)
            : agent.tasks
                .buildRunEval(
                  buildRunEvalInput(scenario, { variant: 'baseline' }),
                )
                .title(`matrix ${model} ${scenario.slug}`)
                .diary(diaryId)
                .correlationId(randomUUID())
                .maxAttempts(1)
                .team(teamId);
        for (const inputArtifact of inputArtifacts) {
          builder.artifactReference(inputArtifact.artifact, inputArtifact.role);
        }
        const built = builder.build();
        const task = await agent.tasks.create(built);
        producerSandboxRoots.set(task.id, sandboxRoot);
        await runTaskOnce({
          agentName,
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
            `producer ${task.id} status=${final.status} accepted=${final.acceptedAttemptN}`,
          );
        }
        return { taskId: task.id, attemptN: final.acceptedAttemptN };
      },
      runGates: (model, scenario, producer) =>
        checkGates(agent, producer.taskId, producer.attemptN, scenario.gates, {
          model,
          workspace: scenario.execution.workspace,
          teamId,
          taskType: scenario.taskType,
        }),
      runJudge: async (scenario, producer) => {
        // judge_eval_attempt only accepts run_eval targets. For freeform,
        // gate-pass is the score (composite 1); a freeform judge is future work.
        if (scenario.taskType !== 'run_eval') {
          return { composite: 1 };
        }
        const judgeTask = await agent.tasks.create(
          agent.tasks
            .buildJudgeEvalAttempt(
              buildJudgeInput(scenario, {
                targetTaskId: producer.taskId,
                targetAttemptN: producer.attemptN,
              }),
            )
            .title(`judge ${scenario.slug}`)
            .diary(diaryId)
            .maxAttempts(1)
            .team(teamId)
            .build(),
        );
        await runTaskOnce({
          agentName,
          agentRoot,
          piDir: judgePiDir,
          sandboxRoot:
            producerSandboxRoots.get(producer.taskId) ??
            (() => {
              throw new Error(
                `missing sandbox root for producer ${producer.taskId}`,
              );
            })(),
          teamId,
          profileId: judgeProfileId,
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
          throw new Error(`judge ${judgeTask.id} produced no composite`);
        }
        return { composite };
      },
    });

    const outPath = resolve(
      process.env.EVAL_MATRIX_OUT ?? join(process.cwd(), 'score-matrix.json'),
    );
    writeFileSync(outPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
    console.log('\n' + summarizeMatrix(matrix) + `\n(wrote ${outPath})`);

    // Measurement, not a pass/fail gate: assert only that every cell exists.
    expect(matrix.cells).toHaveLength(models.length * scenarios.length);
  }, 3_600_000);
});
