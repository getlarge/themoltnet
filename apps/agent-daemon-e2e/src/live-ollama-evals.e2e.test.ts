/**
 * Per-PR live smoke: run the committed `evals-v2/` runtime-prompt-compliance
 * scenarios against ONE pinned Ollama Cloud model and assert their deterministic
 * stage-1 gates. No LLM judge runs here — the per-PR lane is a fast regression
 * tripwire, not the scoring matrix (that is the nightly `eval-matrix` workflow).
 *
 * Gated exactly like `live-ollama.e2e.test.ts`: skipped unless
 * `MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E=1`, and requires `OLLAMA_API_KEY`.
 *
 * The scenario corpus is the source of truth for what runs — add a scenario dir
 * under `evals-v2/` and it is picked up here automatically.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildRunEvalInput,
  checkGates,
  readScenario,
  type Scenario,
  writeAgentCredentials,
  writePiConfig,
} from '@moltnet/agent-eval';
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const LIVE_LLM_FLAG = 'MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E';
const LIVE_PROVIDER = 'ollama-cloud';
const LIVE_MODEL =
  process.env.MOLTNET_AGENT_DAEMON_LIVE_MODEL ?? 'qwen3-coder:480b-cloud';

const describeLive = describe.skipIf(process.env[LIVE_LLM_FLAG] !== '1');
const CORPUS_ROOT = join(import.meta.dirname, '../../..', 'evals-v2');

function loadScenarios(): Scenario[] {
  return readdirSync(CORPUS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => readScenario(join(CORPUS_ROOT, entry.name)));
}

describeLive('Agent daemon evals-v2 gate smoke (live Ollama, e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;
  let agentName: string;
  let clientId: string;
  let clientSecret: string;
  let profileId: string | null = null;
  const tempRoots: string[] = [];
  const scenarios = loadScenarios();

  beforeAll(async () => {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(
        `${LIVE_LLM_FLAG}=1 requires OLLAMA_API_KEY for ${LIVE_PROVIDER}/${LIVE_MODEL}`,
      );
    }

    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-evals-v2-daemon');
    agentName = creds.name;
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId,
      clientSecret,
    });

    const profile = await agent.runtimeProfiles.create(
      {
        name: `evals-v2-${randomUUID()}`,
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

  it('has a non-empty scenario corpus', () => {
    expect(scenarios.length).toBeGreaterThan(0);
  });

  it.each(scenarios.map((s) => [s.slug, s] as const))(
    'passes deterministic gates for %s',
    async (_slug, scenario) => {
      // Arrange — throwaway agent creds + Pi config pinned to the model.
      const sandboxRoot = mkdtempSync(join(tmpdir(), 'evals-v2-sandbox-'));
      const agentRoot = mkdtempSync(join(tmpdir(), 'evals-v2-agent-'));
      const piDir = mkdtempSync(join(tmpdir(), 'evals-v2-pi-'));
      tempRoots.push(sandboxRoot, agentRoot, piDir);
      writeAgentCredentials({
        agentRoot,
        agentName,
        apiUrl: harness.restApiUrl,
        clientId,
        clientSecret,
      });
      writePiConfig({ piDir, provider: LIVE_PROVIDER, model: LIVE_MODEL });

      const runEvalInput = buildRunEvalInput(scenario, { variant: 'baseline' });
      const task = await agent.tasks.create(
        {
          taskType: 'run_eval',
          title: `evals-v2 ${scenario.slug}`,
          diaryId,
          correlationId: randomUUID(),
          maxAttempts: 1,
          input: runEvalInput,
        },
        { teamId },
      );

      // Act — run the task through the daemon once against the pinned model.
      const oldPiDir = process.env.PI_CODING_AGENT_DIR;
      const oldCwd = process.cwd();
      process.env.PI_CODING_AGENT_DIR = piDir;
      try {
        process.chdir(sandboxRoot);
        const exitCode = await runOnce([
          '--task-id',
          task.id,
          '--agent',
          agentName,
          '--profile',
          profileId!,
          '--team',
          teamId,
          '--agent-root',
          agentRoot,
          '--warm-session-ttl-sec',
          '600',
          '--max-turns',
          '14',
          '--max-bash-timeouts',
          '1',
        ]);
        expect(exitCode).toBe(0);
      } finally {
        process.chdir(oldCwd);
        if (oldPiDir === undefined) {
          delete process.env.PI_CODING_AGENT_DIR;
        } else {
          process.env.PI_CODING_AGENT_DIR = oldPiDir;
        }
      }

      const final = await agent.tasks.get(task.id);
      expect(final.status).toBe('completed');
      expect(final.acceptedAttemptN).toBeTruthy();
      const acceptedAttemptN = final.acceptedAttemptN!;

      // Assert — deterministic stage-1 gates. Any failure is a runtime-prompt
      // regression for this model/scenario.
      const result = await checkGates(
        agent,
        task.id,
        acceptedAttemptN,
        scenario.gates,
        { model: LIVE_MODEL, workspace: scenario.execution.workspace },
      );
      expect(
        result.failures,
        `gate failures for ${scenario.slug}: ${result.failures
          .map((f) => `${f.gate}:${f.detail}`)
          .join(' | ')}`,
      ).toEqual([]);
      expect(result.passed).toBe(true);
    },
    900_000,
  );
});
