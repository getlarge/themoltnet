import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import { finalizeTask } from '@themoltnet/agent-daemon/lib/finalize.js';
import { createRuntimeProfileRetryTriage } from '@themoltnet/agent-daemon/lib/runtime-profile-retry-triage.js';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  PollingApiTaskSource,
} from '@themoltnet/agent-runtime';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const LIVE_LLM_FLAG = 'MOLTNET_AGENT_DAEMON_LIVE_LLM_E2E';
const LIVE_PROVIDER = 'ollama-cloud';
const LIVE_MODEL = 'qwen3-coder:480b-cloud';
const LIVE_TRIAGE_MODEL =
  process.env.MOLTNET_AGENT_DAEMON_LIVE_TRIAGE_MODEL ?? 'minimax-m2.1:cloud';
const FREEFORM_SUBMIT_INSTRUCTIONS =
  'Before submitting, call moltnet_get_task for this task id and read inputCid. ' +
  'The submit_freeform_output args must be the FreeformOutput object directly, not wrapped. ' +
  'Use artifacts as an array. Include verification as an object with inputCid, ' +
  'results [{ id: "submit-output", kind: "gate", status: "pass", detail: "submit_freeform_output called with valid args" }], ' +
  'and passed true.';

const describeLive = describe.skipIf(process.env[LIVE_LLM_FLAG] !== '1');
const repoRoot = join(import.meta.dirname, '../../..');

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

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
          maxTurns: 14,
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
              '"live ollama parent completed". ' +
              FREEFORM_SUBMIT_INSTRUCTIONS,
            expectedOutput:
              'A valid FreeformOutput submitted through submit_freeform_output with verification.',
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
              '"live ollama continuation completed". ' +
              FREEFORM_SUBMIT_INSTRUCTIONS,
            expectedOutput:
              'A valid FreeformOutput submitted through submit_freeform_output with verification.',
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

      const artifactTask = await agent.tasks.create(
        {
          taskType: 'freeform',
          title: 'Live Ollama artifact upload smoke',
          diaryId,
          correlationId,
          maxAttempts: 1,
          input: {
            brief:
              'Create a file named live-artifact.txt in the workspace with exactly this text: ' +
              '"live artifact bytes". Then call moltnet_upload_task_artifact with ' +
              'filePath "live-artifact.txt", kind "report", title "live-artifact.txt", ' +
              'and contentType "text/plain". Finally call submit_freeform_output exactly once ' +
              'with a short summary saying "live ollama artifact completed" and include one ' +
              'artifact entry titled "live-artifact.txt" that includes the returned cid. ' +
              FREEFORM_SUBMIT_INSTRUCTIONS,
            expectedOutput:
              'A valid FreeformOutput submitted through submit_freeform_output with the uploaded artifact CID and verification.',
            constraints: [
              'Do not run shell commands.',
              'Do not create diary entries.',
              'Use moltnet_upload_task_artifact after writing the file.',
            ],
          },
        },
        { teamId },
      );

      const artifactAttemptN = await runLiveTask({
        agent,
        agentName,
        agentRoot,
        maxTurns: 14,
        profileId: profile.id,
        sandboxRoot,
        taskId: artifactTask.id,
        teamId,
      });
      const artifacts = await agent.tasks.artifacts.list(artifactTask.id, {
        teamId,
      });
      const uploaded = artifacts.find(
        (artifact) =>
          artifact.attemptN === artifactAttemptN &&
          artifact.title === 'live-artifact.txt',
      );
      expect(uploaded).toBeTruthy();
      expect(uploaded?.kind).toBe('report');
      expect(uploaded?.contentType).toBe('text/plain');
      const downloaded = await agent.tasks.artifacts.download(
        {
          cid: uploaded!.cid,
          attemptN: artifactAttemptN,
          taskId: artifactTask.id,
        },
        { teamId },
      );
      await expect(collectStreamText(downloaded.stream)).resolves.toContain(
        'live artifact bytes',
      );
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

  it('uses live Pi retry triage to requeue an ambiguous failed attempt', async () => {
    const created = await agent.tasks.create(
      {
        taskType: 'curate_pack',
        diaryId,
        maxAttempts: 2,
        input: {
          diaryId,
          taskPrompt: 'live retry triage e2e',
        },
      },
      { teamId },
    );
    const seenAttempts: number[] = [];

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent,
        teamId,
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
        seenAttempts.push(claimedTask.attemptN);
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });

        if (claimedTask.attemptN === 1) {
          await reporter.close();
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'failed' as const,
            output: null,
            outputCid: null,
            usage: { inputTokens: 1, outputTokens: 0 },
            durationMs: 1,
            error: {
              code: 'executor_unexpected_error',
              message:
                'Ambiguous local VM worker crash after a websocket disconnect; task input and credentials are still valid.',
              retryable: false,
            },
          };
        }

        const stubOutput = {
          packId: '00000000-0000-4000-8000-000000000001',
          packCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
          entries: [
            {
              entryId: '00000000-0000-4000-8000-000000000002',
              rank: 1,
              rationale: 'live retry triage e2e stub entry',
            },
          ],
          recipeParams: {},
          summary: 'live retry triage e2e completed after requeue.',
          verification: buildProducerVerification(claimedTask.task.inputCid),
        };
        await reporter.finalize({ inputTokens: 1, outputTokens: 1 });
        await reporter.close();
        return {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'completed' as const,
          output: stubOutput,
          outputCid: await computeJsonCid(stubOutput),
          usage: { inputTokens: 1, outputTokens: 1 },
          durationMs: 1,
        };
      },
      onTaskFinished: (output, claimedTask) =>
        finalizeTask(agent, output, {
          task: claimedTask.task,
          retryTriage: createRuntimeProfileRetryTriage({
            runtimeProfile: {
              provider: LIVE_PROVIDER,
              model: LIVE_TRIAGE_MODEL,
              thinkingLevel: 'low',
            },
            piAgentDir: join(repoRoot, '.pi'),
            cwd: repoRoot,
            timeoutMs: 60_000,
          }),
        }),
    });

    await runtime.start();

    expect(seenAttempts).toEqual([1, 2]);
    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(2);
    const attempts = await agent.tasks.listAttempts(created.id);
    expect(attempts.find((attempt) => attempt.attemptN === 1)).toMatchObject({
      status: 'failed',
      error: expect.objectContaining({
        retryable: true,
        retry: expect.objectContaining({
          source: 'triage',
          decision: 'retry',
        }),
      }),
    });
  }, 180_000);
});

function buildProducerVerification(inputCid: string) {
  return {
    inputCid,
    results: [
      {
        id: 'submit-output',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail: 'submit tool criterion satisfied in live retry triage e2e stub',
      },
    ],
    passed: true,
  };
}

async function runLiveTask(input: {
  agent: Agent;
  agentName: string;
  agentRoot: string;
  profileId: string;
  sandboxRoot: string;
  taskId: string;
  teamId: string;
  maxTurns?: number;
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
      String(input.maxTurns ?? 14),
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
  const downloaded = await input.agent.runtimeSessions.download(
    {
      attemptN: input.attemptN,
      taskId: input.taskId,
    },
    { teamId: input.teamId },
  );
  const downloadedSession = await collectStreamText(downloaded);
  expect(downloadedSession).toContain('"type":"session"');
  expect(downloadedSession).toContain(input.taskId);

  const messages = await input.agent.tasks.listMessages(
    input.taskId,
    input.attemptN,
  );
  const serializedMessages = JSON.stringify(messages);
  expect(serializedMessages).toContain('execute_start');
  expect(serializedMessages).toContain(input.expectedMessageFragment);
}

async function collectStreamText(
  stream: AsyncIterable<Uint8Array>,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
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
