import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeJsonCid } from '@moltnet/crypto-service';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
import type { ExecutePiTaskOptions } from '@themoltnet/pi-extension';
import type * as PiExtension from '@themoltnet/pi-extension';
import { type Agent, connect } from '@themoltnet/sdk';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { runOnce } from '../src/cli/once.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const { createPiTaskExecutorMock } = vi.hoisted(() => ({
  createPiTaskExecutorMock: vi.fn(),
}));

vi.mock('@themoltnet/pi-extension', async (importOriginal) => {
  const actual = (await importOriginal()) as typeof PiExtension;
  return {
    ...actual,
    createPiTaskExecutor: createPiTaskExecutorMock,
    findMainWorktree: vi.fn(() => {
      throw new Error('findMainWorktree must not run for repo-free tasks');
    }),
  };
});

createPiTaskExecutorMock.mockImplementation(
  (_options: ExecutePiTaskOptions) =>
    async (claimedTask: ClaimedTask, reporter: TaskReporter) => {
      await reporter.open({
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
      });

      const payload = {
        summary: 'Repo-free daemon e2e completed a non-coding task.',
        verification: buildProducerVerification(claimedTask.task.inputCid),
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
  const tempRoots: string[] = [];

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-repo-free-daemon');
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

  afterEach(() => {
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
      apiUrl: harness.restApiUrl,
    });

    const created = await agent.tasks.create({
      taskType: 'freeform',
      teamId,
      diaryId,
      title: 'Repo-free freeform e2e',
      input: {
        brief: 'Run without a git checkout.',
        execution: { workspace: 'none' },
      },
    });
    const profile = await agent.runtimeProfiles.create(
      {
        name: `repo-free-daemon-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        provider: 'anthropic',
        model: 'claude-sonnet-4-5',
        leaseTtlSec: 300,
        heartbeatIntervalMs: 15_000,
        maxBatchSize: 10,
        sandbox: {
          snapshot: {
            resume: [],
          },
        },
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
    expect(createPiTaskExecutorMock.mock.calls[0][0]).toMatchObject({
      agentName,
      agentRootDir: agentRoot,
      mountPath: realpathSync(sandboxRoot),
      provider: 'anthropic',
      model: 'claude-sonnet-4-5',
    });

    const final = await agent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
  }, 60_000);
});

function buildProducerVerification(inputCid: string) {
  return {
    inputCid,
    results: [
      {
        id: 'repo-free-daemon',
        kind: 'gate' as const,
        status: 'pass' as const,
        detail: 'repo-free daemon e2e completed through runOnce',
      },
    ],
    passed: true,
  };
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
          fingerprint: 'E2E-REPO-FREE',
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
