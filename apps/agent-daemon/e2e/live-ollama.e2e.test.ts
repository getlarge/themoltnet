import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { runOnce } from '../src/cli/once.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const LIVE_LLM_FLAG = 'MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E';
const LIVE_PROVIDER = 'ollama-cloud';
const LIVE_MODEL = 'gemma3:12b-cloud';

const describeLive = describe.skipIf(process.env[LIVE_LLM_FLAG] !== '1');

describeLive('Agent daemon live Ollama Cloud execution (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let teamId: string;
  let diaryId: string;
  let agentName: string;
  let clientId: string;
  let clientSecret: string;
  const tempRoots: string[] = [];

  beforeAll(async () => {
    if (!process.env.OLLAMA_API_KEY) {
      throw new Error(
        `${LIVE_LLM_FLAG}=1 requires OLLAMA_API_KEY for ${LIVE_PROVIDER}/${LIVE_MODEL}`,
      );
    }

    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-live-ollama-daemon');
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
  }, 120_000);

  afterAll(async () => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    await harness?.teardown();
  });

  it('runs a real freeform task and a continuation through Pi, slots, and durable sessions', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'daemon-live-ollama-'));
    const agentRoot = mkdtempSync(join(tmpdir(), 'daemon-live-agent-'));
    const piDir = mkdtempSync(join(tmpdir(), 'daemon-live-pi-'));
    tempRoots.push(sandboxRoot, agentRoot, piDir);
    writeAgentCredentials({
      agentRoot,
      agentName,
      apiUrl: harness.restApiUrl,
      clientId,
      clientSecret,
    });
    writePiConfig(piDir);

    const oldPiDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = piDir;
    let profileId: string | null = null;

    try {
      const profile = await agent.runtimeProfiles.create(
        {
          name: `live-ollama-${randomUUID()}`,
          runtimeKind: 'gondolin_pi',
          provider: LIVE_PROVIDER,
          model: LIVE_MODEL,
          leaseTtlSec: 300,
          heartbeatIntervalMs: 5_000,
          maxBatchSize: 1,
          maxTurns: 6,
          maxBashTimeouts: 1,
          sessionTtlSec: 600,
          workspaceTtlSec: 600,
          defaultWorkspaceMode: 'shared_mount',
          allowedWorkspaceModes: ['shared_mount'],
          requiredEnv: ['OLLAMA_API_KEY'],
          requiredTools: [],
          sandbox: {
            env: {
              NODE_OPTIONS: '--dns-result-order=ipv4first',
            },
            resources: {
              cpus: 2,
              memory: '2G',
            },
          },
        },
        { teamId },
      );
      profileId = profile.id;

      const correlationId = randomUUID();
      const parent = await agent.tasks.create(
        {
          taskType: 'freeform',
          title: 'Live Ollama parent smoke',
          diaryId,
          correlationId,
          maxAttempts: 1,
          input: {
            brief:
              'This is a CI smoke test. Do not inspect files and do not edit anything. ' +
              'Call submit_freeform_output exactly once with a short summary saying ' +
              '"live ollama parent completed" and one inline text artifact titled "parent-marker".',
            expectedOutput:
              'A valid FreeformOutput submitted through submit_freeform_output.',
            constraints: [
              'Do not run shell commands.',
              'Do not create diary entries.',
              'Do not modify the workspace.',
            ],
          },
        },
        { teamId },
      );

      const parentAttemptN = await runLiveTask({
        agent,
        agentName,
        agentRoot,
        profileId: profile.id,
        sandboxRoot,
        taskId: parent.id,
        teamId,
      });
      await expectRuntimeState({
        agent,
        attemptN: parentAttemptN,
        expectedMessageFragment: 'prompt_assembled',
        taskId: parent.id,
        teamId,
      });

      const continuation = await agent.tasks.create(
        {
          taskType: 'freeform',
          title: 'Live Ollama continuation smoke',
          diaryId,
          correlationId,
          maxAttempts: 1,
          input: {
            brief:
              'Continue the previous smoke task. Use the prior context only to confirm continuity. ' +
              'Call submit_freeform_output exactly once with a short summary saying ' +
              '"live ollama continuation completed" and one inline text artifact titled "continuation-marker".',
            expectedOutput:
              'A valid FreeformOutput submitted through submit_freeform_output.',
            constraints: [
              'Do not run shell commands.',
              'Do not create diary entries.',
              'Do not modify the workspace.',
            ],
            continueFrom: {
              taskId: parent.id,
              attemptN: parentAttemptN,
            },
          },
        },
        { teamId },
      );

      const continuationAttemptN = await runLiveTask({
        agent,
        agentName,
        agentRoot,
        profileId: profile.id,
        sandboxRoot,
        taskId: continuation.id,
        teamId,
      });
      await expectRuntimeState({
        agent,
        attemptN: continuationAttemptN,
        expectedMessageFragment: 'prior_context_',
        taskId: continuation.id,
        teamId,
      });
    } finally {
      if (oldPiDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = oldPiDir;
      }
      if (profileId) {
        await agent.runtimeProfiles.delete(profileId);
      }
    }
  }, 900_000);
});

async function runLiveTask(input: {
  agent: Agent;
  agentName: string;
  agentRoot: string;
  profileId: string;
  sandboxRoot: string;
  taskId: string;
  teamId: string;
}): Promise<number> {
  const oldCwd = process.cwd();
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
      '600',
      '--max-turns',
      '6',
      '--max-bash-timeouts',
      '1',
    ]);
    expect(exitCode).toBe(0);
  } finally {
    process.chdir(oldCwd);
  }

  const final = await input.agent.tasks.get(input.taskId);
  expect(final.status).toBe('completed');
  expect(final.acceptedAttemptN).toBeTruthy();
  return final.acceptedAttemptN!;
}

async function expectRuntimeState(input: {
  agent: Agent;
  attemptN: number;
  expectedMessageFragment: string;
  taskId: string;
  teamId: string;
}): Promise<void> {
  const slot = await input.agent.runtimeSlots.findLatestForAttempt(
    {
      attemptN: input.attemptN,
      taskId: input.taskId,
    },
    { teamId: input.teamId },
  );
  expect(slot?.slot.expiresAtMs).toBeGreaterThan(Date.now());
  expect(slot?.slot.sessionDir).toBeTruthy();
  expect(slot?.slot.sessionPath).toBeTruthy();

  const session = await input.agent.runtimeSessions.getForAttempt(
    {
      attemptN: input.attemptN,
      taskId: input.taskId,
    },
    { teamId: input.teamId },
  );
  expect(session).toBeTruthy();

  const messages = await input.agent.tasks.listMessages(
    input.taskId,
    input.attemptN,
  );
  const serializedMessages = JSON.stringify(messages);
  expect(serializedMessages).toContain('execute_start');
  expect(serializedMessages).toContain(input.expectedMessageFragment);
}

function writeAgentCredentials(input: {
  agentRoot: string;
  agentName: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}): void {
  const agentDir = join(input.agentRoot, '.moltnet', input.agentName);
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(
    join(agentDir, 'moltnet.json'),
    JSON.stringify(
      {
        identity_id: randomUUID(),
        registered_at: new Date().toISOString(),
        oauth2: {
          client_id: input.clientId,
          client_secret: input.clientSecret,
        },
        keys: {
          public_key: 'ed25519:e2e',
          private_key: 'ed25519:e2e',
          fingerprint: 'E2E-LIVE-OLLAMA',
        },
        endpoints: {
          api: input.apiUrl,
          mcp: `${input.apiUrl}/mcp`,
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  writeFileSync(
    join(agentDir, 'env'),
    `MOLTNET_AGENT_NAME=${input.agentName}\n`,
    'utf8',
  );
}

function writePiConfig(piDir: string): void {
  writeFileSync(
    join(piDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          [LIVE_PROVIDER]: {
            api: 'openai-completions',
            apiKey: '$OLLAMA_API_KEY',
            baseUrl: 'https://ollama.com/v1',
            models: [{ id: LIVE_MODEL }],
          },
        },
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
  writeFileSync(
    join(piDir, 'settings.json'),
    JSON.stringify(
      {
        defaultModel: LIVE_MODEL,
        defaultProvider: LIVE_PROVIDER,
        enableInstallTelemetry: false,
        enabledModels: [`${LIVE_PROVIDER}/${LIVE_MODEL}`],
        packages: ['npm:@themoltnet/pi-extension'],
        transport: 'sse',
        treeFilterMode: 'default',
      },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}
