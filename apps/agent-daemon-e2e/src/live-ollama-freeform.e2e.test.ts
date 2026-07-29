/**
 * Per-task-type live proof for the **freeform** producer path.
 *
 * Drives the `evals-v2-freeform/submit-output-discipline` scenario as a real
 * `freeform` task through the daemon against one pinned Ollama Cloud model, and
 * asserts the freeform submit-output-discipline GATE: the attempt completes, the
 * captured output is a schema-valid `FreeformOutput`, and — because a producer
 * task always carries the auto-injected `submit-output` gate — it includes a
 * `verification` record. The hidden-rubric JUDGE (summary faithfulness) is a
 * separate, model-graded leg validated on its own; this test is the deterministic
 * producer+gate proof.
 *
 * Gated exactly like `live-ollama-evals.e2e.test.ts`: skipped unless
 * `MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E=1`, and requires `OLLAMA_API_KEY`.
 */
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readScenario,
  writeAgentCredentials,
  writePiConfig,
} from '@moltnet/agent-eval';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const LIVE_LLM_FLAG = 'MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E';
const LIVE_PROVIDER = 'ollama-cloud';
const LIVE_MODEL =
  process.env.MOLTNET_AGENT_DAEMON_LIVE_MODEL ?? 'gpt-oss:120b-cloud';

const describeLive = describe.skipIf(process.env[LIVE_LLM_FLAG] !== '1');
const SCENARIO_DIR = join(
  import.meta.dirname,
  '../../..',
  'evals-v2-freeform',
  'submit-output-discipline',
);

describeLive('Agent daemon freeform producer gate (live Ollama, e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;
  let agentName: string;
  let clientId: string;
  let clientSecret: string;
  let publicKey: string;
  let privateKey: string;
  let fingerprint: string;
  let profileId: string | null = null;
  const tempRoots: string[] = [];
  const scenario = readScenario(SCENARIO_DIR);

  beforeAll(async () => {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(
        `${LIVE_LLM_FLAG}=1 requires OLLAMA_API_KEY for ${LIVE_PROVIDER}/${LIVE_MODEL}`,
      );
    }

    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-freeform-daemon');
    agentName = creds.name;
    clientId = creds.clientId;
    clientSecret = creds.clientSecret;
    publicKey = creds.keyPair.publicKey;
    privateKey = creds.keyPair.privateKey;
    fingerprint = creds.keyPair.fingerprint;
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId,
      clientSecret,
    });

    const profile = await agent.runtimeProfiles.create(
      {
        name: `freeform-${randomUUID()}`,
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

  it('passes the freeform submit-output-discipline gate', async () => {
    expect(scenario.taskType).toBe('freeform');

    // Arrange — throwaway agent creds + Pi config pinned to the model.
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'freeform-sandbox-'));
    const agentRoot = mkdtempSync(join(tmpdir(), 'freeform-agent-'));
    const piDir = mkdtempSync(join(tmpdir(), 'freeform-pi-'));
    tempRoots.push(sandboxRoot, agentRoot, piDir);
    writeAgentCredentials({
      agentRoot,
      agentName,
      apiUrl: harness.restApiUrl,
      clientId,
      clientSecret,
      publicKey,
      privateKey,
      fingerprint,
    });
    writePiConfig({ piDir, provider: LIVE_PROVIDER, model: LIVE_MODEL });

    // The scenario's prompt.md is the FreeformInput.brief (not a run_eval
    // scenario prompt). Drive the real freeform producer via the SDK builder.
    const task = await agent.tasks.create(
      agent.tasks
        .buildFreeform({
          brief: scenario.prompt,
          execution: { workspace: scenario.execution.workspace },
        })
        .title(`freeform ${scenario.slug}`)
        .diary(diaryId)
        .correlationId(randomUUID())
        .maxAttempts(1)
        .team(teamId)
        .build(),
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

    // Assert — the freeform submit-output-discipline gate (deterministic).
    const final = await agent.tasks.get(task.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBeTruthy();

    const attempts = await agent.tasks.listAttempts(task.id);
    const output = attempts.find((a) => a.attemptN === final.acceptedAttemptN)
      ?.output as
      | { summary?: unknown; verification?: unknown }
      | null
      | undefined;

    // A `completed` attempt with an accepted N already passed the FreeformOutput
    // schema + cross-field validation server-side, so we assert the concrete
    // submit-output-discipline facts: a summary was submitted...
    expect(typeof output?.summary).toBe('string');
    // ...and a verification record is present (required by the auto-injected
    // submit-output gate — this IS the discipline being tested).
    expect(output?.verification).toBeDefined();
  }, 900_000);
});
