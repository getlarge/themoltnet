import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
import type { ExecutePiTaskOptions } from '@themoltnet/pi-runtime';
import { type Agent, connect } from '@themoltnet/sdk';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { buildProducerVerification } from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const { createPiTaskExecutorMock } = vi.hoisted(() => ({
  createPiTaskExecutorMock: vi.fn(),
}));

vi.mock('@themoltnet/pi-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createPiTaskExecutor: createPiTaskExecutorMock,
    findMainWorktree: vi.fn(() => {
      throw new Error('findMainWorktree must not run for repo-free tasks');
    }),
  };
});

createPiTaskExecutorMock.mockImplementation(
  (options: ExecutePiTaskOptions) =>
    async (claimedTask: ClaimedTask, reporter: TaskReporter) => {
      await reporter.open({
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
      });
      const executionPlan = await options.makeExecutionPlan?.(claimedTask);
      if (executionPlan?.sessionPersistence?.sessionDir) {
        mkdirSync(executionPlan.sessionPersistence.sessionDir, {
          recursive: true,
        });
        writeFileSync(
          join(
            executionPlan.sessionPersistence.sessionDir,
            '20260625T000000.jsonl',
          ),
          JSON.stringify({
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            message: 'repo-free daemon e2e session checkpoint',
          }) + '\n',
          'utf8',
        );
      }

      const payload = {
        summary: 'Repo-free daemon e2e completed a non-coding task.',
        verification: buildProducerVerification(claimedTask.task.inputCid, {
          id: 'repo-free-daemon',
          detail: 'repo-free daemon e2e completed through runOnce',
        }),
      };
      const output = {
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
        status: 'completed' as const,
        output: payload,
        outputCid: await computeJsonCid(payload),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      };
      await reporter.finalize(output.usage);
      await reporter.close();
      return output;
    },
);

describe('Agent daemon repo-free execution (e2e)', () => {
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
  const tempRoots: string[] = [];

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-repo-free-daemon');
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
  }, 120_000);

  beforeEach(() => {
    vi.stubEnv('MOLTNET_AGENT_KEY', '');
    vi.stubEnv('MOLTNET_API_URL', '');
    vi.stubEnv('MOLTNET_CLIENT_ID', '');
    vi.stubEnv('MOLTNET_CLIENT_SECRET', '');
    vi.stubEnv('MOLTNET_CREDENTIALS_PATH', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  it('runs a workspace:none freeform task from a sandbox root that is not a git repository', async () => {
    const sandboxRoot = mkdtempSync(join(tmpdir(), 'daemon-repo-free-e2e-'));
    const agentRoot = mkdtempSync(join(tmpdir(), 'daemon-agent-root-e2e-'));
    tempRoots.push(sandboxRoot);
    tempRoots.push(agentRoot);
    writeAgentCredentials({
      agentRoot,
      agentName,
      clientId,
      clientSecret,
      publicKey,
      privateKey,
      fingerprint,
      apiUrl: harness.restApiUrl,
    });

    const created = await agent.tasks.create(
      {
        taskType: 'freeform',
        diaryId,
        title: 'Repo-free freeform e2e',
        input: {
          brief: 'Run without a git checkout.',
          execution: { workspace: 'none' },
        },
      },
      { teamId },
    );
    const profile = await agent.runtimeProfiles.create(
      {
        name: `repo-free-daemon-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        leaseTtlSec: 300,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 10,
        sandbox: {},
      },
      { teamId },
    );

    const oldCwd = process.cwd();
    try {
      process.chdir(sandboxRoot);
      const exitCode = await runOnce([
        '--task-id',
        created.id,
        '--agent',
        agentName,
        '--profile',
        profile.id,
        '--agent-root',
        agentRoot,
      ]);
      expect(exitCode).toBe(0);
    } finally {
      process.chdir(oldCwd);
      await agent.runtimeProfiles.delete(profile.id);
    }

    expect(createPiTaskExecutorMock).toHaveBeenCalledTimes(1);
    const executorOptions = createPiTaskExecutorMock.mock.calls[0]?.[0] as {
      guestCredentialMode: 'guest-config' | 'host-authenticated';
      agentName: string;
      agentRootDir: string;
      mountPath: string;
      moltnetAgent: Agent;
      provider: string;
      model: string;
    };
    expect(executorOptions).toMatchObject({
      agentName,
      agentRootDir: agentRoot,
      guestCredentialMode: 'guest-config',
      mountPath: agentRoot,
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });
    expect(executorOptions.mountPath).not.toBe(sandboxRoot);
    const executorWhoami = await executorOptions.moltnetAgent.agents.whoami();
    expect(executorWhoami.credentialBinding).toBeUndefined();

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
  }, 60_000);
});

function writeAgentCredentials(input: {
  agentRoot: string;
  agentName: string;
  clientId: string;
  clientSecret: string;
  publicKey: string;
  privateKey: string;
  fingerprint: string;
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
          public_key: input.publicKey,
          private_key: input.privateKey,
          fingerprint: input.fingerprint,
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
