/**
 * Weekly model-matrix eval (issue #1588), run as a gated vitest e2e test.
 *
 * Sweeps the committed `evals-v2/` corpus across the producer models in `MODELS`
 * (comma-separated; default a single model), applies the stage-1 deterministic
 * gates, then scores every gate-passing producer attempt with a single PINNED
 * judge model. Emits `score-matrix.json`.
 *
 * NOT a per-PR gate — it is gated behind `MOLTNET_EVAL_MATRIX=1` and driven by
 * the scheduled `eval-matrix.yml` workflow, which fans out one runner per model
 * (a GH matrix) so the models run in parallel. It runs as a vitest e2e (not a
 * `tsx` script) so it resolves the workspace's source-direct exports the same
 * way the rest of the suite does.
 *
 * WARM-SLOT: the judge resolves the producer's runtime slot from the DB, so it
 * survives across the two `runOnce` calls as long as the producer slot has not
 * expired (long `--warm-retention-sec`).
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildJudgeInput,
  checkGates,
  readScenario,
  readSubmitStructure,
  runMatrix,
  type Scenario,
  type ScoreMatrix,
  type SubmitStructure,
  summarizeMatrix,
  summarizeProducerSpend,
} from '@moltnet/agent-eval';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createEvalSpendReporter } from './eval-spend-report.js';
import {
  createEvalProfile,
  createScenarioProducerTask,
  provisionDaemonCredentials,
} from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const MATRIX_FLAG = 'MOLTNET_EVAL_MATRIX';
const PROVIDER = 'ollama-cloud';
// Ollama Cloud does not currently support provider-enforced structured output.
// These runs measure tool-call shape with runtime validation and repair.
const WARM_TTL_SEC = '1200';
const CORPUS_ROOT = join(import.meta.dirname, '../../..', 'evals-v2');

const NO_SUBMIT_STRUCTURE: SubmitStructure = {
  invalidSubmitCalls: 0,
  repairKinds: [],
  outputSource: null,
};

/** Optional local audit artifacts; never staged into a producer workspace. */
async function writeEvidence(
  agent: Agent,
  teamId: string,
  taskId: string,
): Promise<void> {
  const dir = process.env.EVAL_MATRIX_EVIDENCE_DIR;
  if (!dir) return;
  const attempts = await agent.tasks.listAttempts(taskId);
  const evidence = [];
  for (const attempt of attempts) {
    const messages = [];
    let afterSeq: number | undefined;
    for (;;) {
      const page = await agent.tasks.listMessages(taskId, attempt.attemptN, {
        afterSeq,
      });
      if (page.length === 0) break;
      messages.push(...page);
      const last = page[page.length - 1].seq;
      if (afterSeq !== undefined && last <= afterSeq)
        throw new Error('message pagination did not advance');
      afterSeq = last;
    }
    const conversations = [];
    for (const { conversationId } of (
      await agent.tasks.conversations.list(taskId, attempt.attemptN, { teamId })
    ).items) {
      const entries = [];
      let beforeEntryId: string | undefined;
      do {
        const page = await agent.tasks.conversations.get(
          taskId,
          attempt.attemptN,
          conversationId,
          { teamId },
          { beforeEntryId },
        );
        entries.push(...page.messages);
        beforeEntryId = page.nextBeforeEntryId ?? undefined;
      } while (beforeEntryId);
      conversations.push({ conversationId, entries });
    }
    evidence.push({ attempt, messages, conversations });
  }
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${taskId}.json`),
    JSON.stringify(evidence, null, 2) + '\n',
  );
}

const describeMatrix = describe.skipIf(process.env[MATRIX_FLAG] !== '1');

function parseModels(): string[] {
  return (process.env.MODELS ?? 'gpt-oss:120b')
    .split(',')
    .map((m) => m.trim())
    .filter((m) => m.length > 0);
}

function loadScenarios(): Scenario[] {
  const requested = process.env.EVAL_MATRIX_SCENARIOS?.split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const scenarios = readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readScenario(join(CORPUS_ROOT, entry.name)));
  for (const slug of requested ?? []) {
    if (!scenarios.some((scenario) => scenario.slug === slug))
      throw new Error(`Unknown matrix scenario: ${slug}`);
  }
  return requested?.length
    ? scenarios.filter((scenario) => requested.includes(scenario.slug))
    : scenarios;
}

function createProfile(
  agent: Agent,
  teamId: string,
  model: string,
): Promise<{ id: string }> {
  return createEvalProfile({
    agent,
    teamId,
    namePrefix: `matrix-${model}`,
    provider: PROVIDER,
    model,
  });
}

async function runTaskOnce(input: {
  agentName: string;
  agentRoot: string;
  piDir: string;
  sandboxRoot: string;
  teamId: string;
  profileId: string;
  taskId: string;
  allowTaskFailure?: boolean;
  workspace: Scenario['execution']['workspace'];
}): Promise<void> {
  const ambientKeys = [
    'MOLTNET_CREDENTIALS_PATH',
    'MOLTNET_AGENT_KEY',
    'MOLTNET_AGENT_KEY_REF',
    'MOLTNET_CLIENT_ID',
    'MOLTNET_CLIENT_SECRET',
  ];
  const ambient = new Map(ambientKeys.map((key) => [key, process.env[key]]));
  for (const key of ambientKeys) delete process.env[key];
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
      ...(input.workspace === 'shared_mount'
        ? ['--source', input.sandboxRoot]
        : []),
      '--warm-retention-sec',
      WARM_TTL_SEC,
    ]);
    if (exitCode !== 0 && !input.allowTaskFailure) {
      throw new Error(`runOnce exited ${exitCode} for task ${input.taskId}`);
    }
  } finally {
    for (const [key, value] of ambient) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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
  const judgeModel = process.env.MOLTNET_EVAL_JUDGE_MODEL ?? 'gemma4:31b';
  const scenarios = loadScenarios();
  const spendReport = createEvalSpendReporter('matrix');

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
    await provisionDaemonCredentials({
      agent,
      agentRoot,
      agentName,
      agentId: creds.agentId,
      teamId,
      apiUrl: harness.restApiUrl,
      publicKey: creds.keyPair.publicKey,
      privateKey: creds.keyPair.privateKey,
      fingerprint: creds.keyPair.fingerprint,
    });

    const judgeProfile = await createProfile(agent, teamId, judgeModel);
    judgeProfileId = judgeProfile.id;
    judgePiDir = mkdtempSync(join(tmpdir(), 'eval-matrix-judge-pi-'));
    tempRoots.push(judgePiDir);
    writePiConfig({
      piDir: judgePiDir,
      provider: PROVIDER,
      model: judgeModel,
      supportsStrictMode: false,
    });

    for (const model of models) {
      const profile = await createProfile(agent, teamId, model);
      const piDir = mkdtempSync(join(tmpdir(), 'eval-matrix-pi-'));
      tempRoots.push(piDir);
      writePiConfig({
        piDir,
        provider: PROVIDER,
        model,
        supportsStrictMode: false,
      });
      perModel.set(model, { profileId: profile.id, piDir });
    }
  }, 300_000);

  afterAll(async () => {
    try {
      await spendReport.write(agent);
    } finally {
      for (const root of tempRoots.splice(0)) {
        rmSync(root, { recursive: true, force: true });
      }
      await harness?.teardown();
    }
  });

  it('sweeps the model matrix and scores gate-passing attempts', async () => {
    const matrix: ScoreMatrix = await runMatrix(models, scenarios, judgeModel, {
      log: (m) => console.log(`[eval-matrix] ${m}`),
      runProducer: async (model, scenario, trial) => {
        const cfg = perModel.get(model)!;
        const sandboxRoot = mkdtempSync(join(tmpdir(), 'eval-matrix-sbx-'));
        tempRoots.push(sandboxRoot);
        // No previous trial's notes or judge rubric in the producer diary.
        const trialDiary = await agent.diaries.create(
          { name: `matrix-trial-${Date.now()}` },
          { teamId },
        );
        const task = await createScenarioProducerTask({
          agent,
          scenario,
          sandboxRoot,
          teamId,
          diaryId: trialDiary.id,
          title: `matrix ${model} ${scenario.slug}`,
        });
        spendReport.track({
          taskId: task.id,
          scenario: scenario.slug,
          provider: PROVIDER,
          model,
          role: 'producer',
          ...(scenario.matrixRepeats ? { trial } : {}),
          evaluation: { gatesPassed: false },
        });
        producerSandboxRoots.set(task.id, sandboxRoot);
        let executionError: string | undefined;
        try {
          await runTaskOnce({
            agentName,
            agentRoot,
            piDir: cfg.piDir,
            sandboxRoot,
            teamId,
            profileId: cfg.profileId,
            taskId: task.id,
            allowTaskFailure: true,
            workspace: scenario.execution.workspace,
          });
        } catch (error) {
          // Preserve the task identity and partial evidence even on lease/VM loss.
          executionError =
            error instanceof Error ? error.message : String(error);
        }
        await writeEvidence(agent, teamId, task.id);
        const final = await agent.tasks.get(task.id);
        const spend = summarizeProducerSpend(
          await agent.tasks.listAttempts(task.id),
        );
        if (final.status !== 'completed' || !final.acceptedAttemptN) {
          const attempts = await agent.tasks.listAttempts(task.id);
          let latest = attempts[0];
          for (const attempt of attempts) {
            if (!latest || attempt.attemptN > latest.attemptN) {
              latest = attempt;
            }
          }
          return {
            taskId: task.id,
            attemptN: null,
            failureCode:
              latest?.error?.code ??
              (executionError
                ? 'execution_interrupted'
                : `task_${final.status}`),
            ...(executionError ? { error: executionError } : {}),
            structure: latest
              ? await readSubmitStructure(
                  agent,
                  task.id,
                  latest.attemptN,
                  scenario.taskType,
                  teamId,
                )
              : NO_SUBMIT_STRUCTURE,
            spend,
          };
        }
        return {
          taskId: task.id,
          attemptN: final.acceptedAttemptN,
          structure: await readSubmitStructure(
            agent,
            task.id,
            final.acceptedAttemptN,
            scenario.taskType,
            teamId,
          ),
          spend,
        };
      },
      runGates: (model, scenario, producer) =>
        checkGates(agent, producer.taskId, producer.attemptN, scenario.gates, {
          model,
          workspace: scenario.execution.workspace,
          teamId,
          taskType: scenario.taskType,
          outputContract: scenario.outputContract,
          runningTimeoutSec: scenario.runningTimeoutSec,
        }),
      runJudge: async (scenario, producer) => {
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
        spendReport.track({
          taskId: judgeTask.id,
          producerTaskId: producer.taskId,
          scenario: scenario.slug,
          provider: PROVIDER,
          model: judgeModel,
          role: 'judge',
        });
        console.log(
          `[eval-matrix] judge task=${judgeTask.id} scenario=${scenario.slug}`,
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
          workspace: scenario.execution.workspace,
          allowTaskFailure: true,
        });
        await writeEvidence(agent, teamId, judgeTask.id);
        const judged = await agent.tasks.get(judgeTask.id);
        const attempts = await agent.tasks.listAttempts(judgeTask.id);
        const accepted = attempts.find(
          (a) => a.attemptN === judged.acceptedAttemptN,
        );
        const composite = (accepted?.output as { composite?: number } | null)
          ?.composite;
        if (typeof composite !== 'number') {
          const latest = attempts.reduce<(typeof attempts)[number] | undefined>(
            (last, attempt) =>
              !last || attempt.attemptN > last.attemptN ? attempt : last,
            undefined,
          );
          throw new Error(
            `judge ${judgeTask.id} produced no composite (${latest?.error?.code ?? judged.status})`,
          );
        }
        return { composite };
      },
    });

    for (const cell of matrix.cells) {
      if (cell.producerTaskId)
        spendReport.result(cell.producerTaskId, {
          gatesPassed: cell.gatesPassed,
          ...(cell.scoring === 'judge' ? { judgedScore: cell.composite } : {}),
        });
    }
    const outPath = resolve(
      process.env.EVAL_MATRIX_OUT ?? join(process.cwd(), 'score-matrix.json'),
    );
    writeFileSync(outPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');
    console.log('\n' + summarizeMatrix(matrix) + `\n(wrote ${outPath})`);

    // Measurement, not a pass/fail gate: assert only that every cell exists.
    expect(matrix.cells).toHaveLength(
      models.length *
        scenarios.reduce(
          (total, scenario) => total + (scenario.matrixRepeats ?? 1),
          0,
        ),
    );
  }, 3_600_000);
});
