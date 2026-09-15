/**
 * Direct `moltnet-agent once` runs pick up providers configured with
 * `moltnet-agent providers set`, without `PI_CODING_AGENT_DIR`.
 *
 * The real CLI writes the provider store, the real `runOnce` claims a task
 * against the e2e stack, and a stub Pi executor checks what Pi would see: the
 * activated agent dir, the resolved API key, and a catalog that resolves both
 * the store model and a model only the repository `.pi/models.json` defines.
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { computeJsonCid } from '@moltnet/crypto-service';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
import type { ClaimedTask, TaskReporter } from '@themoltnet/agent-runtime';
import {
  type ExecutePiTaskOptions,
  resolveRuntimeProfileModel,
} from '@themoltnet/pi-runtime';
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

import {
  buildProducerVerification,
  provisionDaemonCredentials,
} from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const DAEMON_ROOT = resolve(import.meta.dirname, '../../agent-daemon');
const PROVIDER_ID = 'e2e-store';
const PROVIDER_ENV = 'MOLTNET_PROVIDER_E2E_STORE_API_KEY';
const STORE_MODEL = 'store-model';
const REPO_MODEL = 'repo-only-model';
const RAW_API_KEY = 'e2e-store-key-never-in-pi-config';

interface PiView {
  piAgentDir: string | undefined;
  apiKey: string | undefined;
  modelsJson: string;
  resolvable: string[];
}

const { createPiTaskExecutorMock } = vi.hoisted(() => ({
  createPiTaskExecutorMock: vi.fn(),
}));

vi.mock('@themoltnet/pi-runtime', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, createPiTaskExecutor: createPiTaskExecutorMock };
});

/** Runs `moltnet-agent <args>` from source, like an operator would. */
async function runAgentCommand(
  args: string[],
  input: string,
): Promise<{ code: number | null; stderr: string }> {
  const tsxDist = join(DAEMON_ROOT, 'node_modules/tsx/dist');
  const child = spawn(
    process.execPath,
    [
      '--require',
      join(tsxDist, 'preflight.cjs'),
      '--import',
      pathToFileURL(join(tsxDist, 'loader.mjs')).href,
      'src/main.ts',
      ...args,
    ],
    { cwd: DAEMON_ROOT, env: process.env, stdio: ['pipe', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdin.end(input);
  const code = await new Promise<number | null>((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  return { code, stderr };
}

describe('Agent daemon provider store for direct runs (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;
  const tempRoots: string[] = [];

  function tempDir(prefix: string): string {
    const dir = mkdtempSync(join(tmpdir(), prefix));
    tempRoots.push(dir);
    return dir;
  }

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    creds = await harness.createAgent('e2e-provider-store-daemon');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
  }, 120_000);

  beforeEach(() => {
    vi.stubEnv('MOLTNET_AGENT_KEY', '');
    vi.stubEnv('MOLTNET_API_URL', '');
    vi.stubEnv('MOLTNET_CLIENT_ID', '');
    vi.stubEnv('MOLTNET_CLIENT_SECRET', '');
    vi.stubEnv('MOLTNET_CREDENTIALS_PATH', '');
    // Unset for the daemon; stubbing also restores whatever runOnce assigns.
    vi.stubEnv('PI_CODING_AGENT_DIR', '');
    vi.stubEnv(PROVIDER_ENV, '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    for (const root of tempRoots.splice(0)) {
      rmSync(root, { recursive: true, force: true });
    }
    await harness?.teardown();
  });

  it('runs once with store providers layered over repo .pi, no PI_CODING_AGENT_DIR', async () => {
    // Arrange: provider store written by the real CLI.
    const storeRoot = tempDir('daemon-provider-store-');
    vi.stubEnv('MOLTNET_AGENT_SERVER_ROOT', storeRoot);
    const set = await runAgentCommand(
      [
        'providers',
        'set',
        PROVIDER_ID,
        '--root',
        storeRoot,
        '--base-url',
        'http://127.0.0.1:9/v1',
        '--model',
        STORE_MODEL,
        '--api-key-stdin',
      ],
      `${RAW_API_KEY}\n`,
    );
    expect(set.code, set.stderr).toBe(0);

    // Arrange: the agent root carries a repository catalog for the same
    // provider with a model the store does not list.
    const agentRoot = tempDir('daemon-provider-store-root-');
    const sandboxRoot = tempDir('daemon-provider-store-cwd-');
    await provisionDaemonCredentials({
      agent,
      agentRoot,
      agentName: creds.name,
      agentId: creds.agentId,
      teamId: creds.personalTeamId,
      publicKey: creds.keyPair.publicKey,
      privateKey: creds.keyPair.privateKey,
      fingerprint: creds.keyPair.fingerprint,
      apiUrl: harness.restApiUrl,
    });
    mkdirSync(join(agentRoot, '.pi'), { recursive: true });
    writeFileSync(
      join(agentRoot, '.pi', 'models.json'),
      JSON.stringify({
        providers: {
          [PROVIDER_ID]: {
            api: 'openai-completions',
            apiKey: '$OLLAMA_API_KEY',
            baseUrl: 'http://127.0.0.1:9/v1',
            models: [{ id: REPO_MODEL, contextWindow: 8192 }],
          },
        },
      }),
    );

    let view: PiView | undefined;
    createPiTaskExecutorMock.mockImplementation(
      (options: ExecutePiTaskOptions) =>
        async (claimedTask: ClaimedTask, reporter: TaskReporter) => {
          await reporter.open({
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
          });
          // The daemon uploads the Pi session after execution; leave one behind.
          const plan = await options.makeExecutionPlan?.(claimedTask);
          const sessionDir = plan?.sessionPersistence?.sessionDir;
          if (sessionDir) {
            mkdirSync(sessionDir, { recursive: true });
            writeFileSync(join(sessionDir, '20260914T000000.jsonl'), '{}\n');
          }
          const piAgentDir = process.env.PI_CODING_AGENT_DIR;
          const resolvable: string[] = [];
          for (const model of [STORE_MODEL, REPO_MODEL]) {
            await resolveRuntimeProfileModel(piAgentDir!, PROVIDER_ID, model);
            resolvable.push(model);
          }
          view = {
            piAgentDir,
            apiKey: process.env[PROVIDER_ENV],
            modelsJson: readFileSync(join(piAgentDir!, 'models.json'), 'utf8'),
            resolvable,
          };

          const payload = {
            summary: 'Provider store e2e completed.',
            verification: buildProducerVerification(claimedTask.task.inputCid, {
              id: 'provider-store',
              detail: 'Pi saw the provider store catalog',
            }),
          };
          const usage = { inputTokens: 1, outputTokens: 1 };
          await reporter.finalize(usage);
          await reporter.close();
          return {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'completed' as const,
            output: payload,
            outputCid: await computeJsonCid(payload),
            usage,
            durationMs: 1,
          };
        },
    );

    const task = await agent.tasks.create(
      {
        taskType: 'freeform',
        diaryId: creds.privateDiaryId,
        title: 'Provider store e2e',
        input: {
          brief: 'Run with the provider store.',
          execution: { workspace: 'none' },
        },
      },
      { teamId: creds.personalTeamId },
    );
    const profile = await agent.runtimeProfiles.create(
      {
        name: `provider-store-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        provider: PROVIDER_ID,
        model: REPO_MODEL,
        sandbox: {},
      },
      { teamId: creds.personalTeamId },
    );

    // Act
    const oldCwd = process.cwd();
    let exitCode: number;
    try {
      process.chdir(sandboxRoot);
      exitCode = await runOnce([
        '--task-id',
        task.id,
        '--agent',
        creds.name,
        '--profile',
        profile.id,
        '--agent-root',
        agentRoot,
      ]);
    } finally {
      process.chdir(oldCwd);
      await agent.runtimeProfiles.delete(profile.id);
    }

    // Assert
    expect(exitCode).toBe(0);
    expect(createPiTaskExecutorMock).toHaveBeenCalledTimes(1);
    expect((await agent.tasks.get(task.id)).status).toBe('completed');
    expect(view).toBeDefined();
    expect(view!.piAgentDir).toBeTruthy();
    expect(view!.piAgentDir).not.toBe(join(agentRoot, '.pi'));
    expect(view!.apiKey).toBe(RAW_API_KEY);
    expect(view!.resolvable).toEqual([STORE_MODEL, REPO_MODEL]);
    expect(view!.modelsJson).toContain(`$${PROVIDER_ENV}`);
    expect(view!.modelsJson).not.toContain(RAW_API_KEY);
  }, 120_000);
});
