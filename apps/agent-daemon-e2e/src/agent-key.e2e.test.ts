/**
 * E2E: Agent daemon authenticates with a team-bound agent key.
 *
 * Runs against the live Docker Compose stack (rest-api + Ory + DB). Proves the
 * PR-2 daemon adoption slice end to end:
 *  - startup validation accepts a key bound to the daemon's `--team`;
 *  - startup validation fails fast when the key is bound to a different team
 *    (the actionable fatal that replaces an obscure mid-poll 403);
 *  - a full configless `once` run covers signed executor registration, claim,
 *    heartbeat/messages, artifacts, runtime slots/sessions, and completion;
 *  - missing or mismatched signing seeds fail before a task is claimed;
 *  - core and knowledge key scopes remain independent from runtime policy.
 *
 * The executor is stubbed — Pi/Gondolin secret isolation has focused runtime
 * tests; this suite exercises the daemon and live API authorization boundary.
 */

import { randomBytes, randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { computeBytesCid, computeJsonCid } from '@moltnet/crypto-service';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises the daemon app entry point.
import { runOnce } from '@themoltnet/agent-daemon/cli/once.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises daemon app internals.
import {
  resolveAgentContext,
  validateStartupBinding,
} from '@themoltnet/agent-daemon/lib/agent-context.js';
// eslint-disable-next-line @nx/enforce-module-boundaries -- This e2e suite intentionally exercises daemon app internals.
import { finalizeTask } from '@themoltnet/agent-daemon/lib/finalize.js';
import {
  AgentRuntime,
  type AgentRuntimeLogger,
  ApiTaskReporter,
  type ClaimedTask,
  PollingApiTaskSource,
  type TaskReporter,
} from '@themoltnet/agent-runtime';
import type { ExecutePiTaskOptions } from '@themoltnet/pi-runtime';
import { type Agent, connect, type MoltNetError } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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
  };
});

createPiTaskExecutorMock.mockImplementation(
  (options: ExecutePiTaskOptions) =>
    async (claimedTask: ClaimedTask, reporter: TaskReporter) => {
      await reporter.open({
        taskId: claimedTask.task.id,
        attemptN: claimedTask.attemptN,
      });
      await reporter.record({
        kind: 'info',
        payload: {
          event: 'configless_agent_key_e2e',
          message: 'host-side Agent executed without guest credentials',
        },
      });

      const executionPlan = await options.makeExecutionPlan?.(claimedTask);
      if (executionPlan?.sessionPersistence?.sessionDir) {
        mkdirSync(executionPlan.sessionPersistence.sessionDir, {
          recursive: true,
        });
        writeFileSync(
          join(
            executionPlan.sessionPersistence.sessionDir,
            '20260812T000000.jsonl',
          ),
          JSON.stringify({
            type: 'session',
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
          }) + '\n',
          'utf8',
        );
      }

      const agent = options.moltnetAgent;
      if (!agent) throw new Error('daemon did not supply its connected Agent');
      const artifactBytes = new TextEncoder().encode(
        `configless artifact for ${claimedTask.task.id}`,
      );
      const artifact = await agent.tasks.artifacts.upload(
        {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        },
        artifactBytes,
        {
          kind: 'report',
          title: 'configless-agent-key.txt',
          contentType: 'text/plain',
        },
        { teamId: claimedTask.task.teamId },
      );
      expect(artifact.cid).toBe(await computeBytesCid(artifactBytes));

      const payload = {
        summary: 'Configless agent-key daemon execution completed.',
        artifacts: [
          {
            kind: 'report',
            title: artifact.title,
            cid: artifact.cid,
            contentType: artifact.contentType,
            sizeBytes: artifact.sizeBytes,
          },
        ],
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

const silentLogger: AgentRuntimeLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => silentLogger,
};

const DAEMON_CREDENTIAL_SCOPES = [
  'agent:profile',
  'runtime:read',
  'task:read',
  'task:claim',
  'task:execute',
] as const;

describe('Agent daemon agent-key auth (e2e)', () => {
  let harness: DaemonTestHarness;
  // The agent's OAuth2 facade — used only to provision (issue the key, propose
  // the task). The daemon-side flow under test uses `keyAgent`.
  let oauthAgent: Agent;
  // Connected with the team-bound agent key — what the daemon uses in PR-2.
  let keyAgent: Agent;
  let teamId: string;
  let diaryId: string;
  let identityId: string;
  let signingPrivateKey: string;
  // Captured for the CLI/entry-point wiring tests below.
  let keySecret: string;
  let underScopedKeySecret: string;
  let completedConfiglessFixture: {
    root: string;
    taskId: string;
    attemptN: number;
    profileId: string;
    executorOptions: ExecutePiTaskOptions;
  };

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    const creds = await harness.createAgent('e2e-daemon-key');
    teamId = creds.personalTeamId;
    diaryId = creds.privateDiaryId;
    identityId = creds.identityId;
    signingPrivateKey = creds.keyPair.privateKey;

    oauthAgent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });

    const issued = await oauthAgent.agentKeys.create(
      {
        agentId: identityId,
        name: 'daemon-e2e-key',
        scopes: [...DAEMON_CREDENTIAL_SCOPES],
        ttlDays: 1,
      },
      { teamId, idempotencyKey: randomUUID() },
    );
    expect(issued.key.scopes).toEqual(DAEMON_CREDENTIAL_SCOPES);
    keySecret = issued.secret;

    const underScoped = await oauthAgent.agentKeys.create(
      {
        agentId: identityId,
        name: 'daemon-e2e-under-scoped-key',
        scopes: ['agent:profile'],
        ttlDays: 1,
      },
      { teamId, idempotencyKey: randomUUID() },
    );
    underScopedKeySecret = underScoped.secret;

    // Env-only secret in production; here it flows straight into connect().
    keyAgent = await connect({
      apiUrl: harness.restApiUrl,
      agentKey: issued.secret,
    });
  }, 120_000);

  afterAll(async () => {
    if (completedConfiglessFixture?.profileId) {
      await oauthAgent.runtimeProfiles
        .delete(completedConfiglessFixture.profileId)
        .catch(() => undefined);
    }
    if (completedConfiglessFixture?.root) {
      rmSync(completedConfiglessFixture.root, {
        recursive: true,
        force: true,
      });
    }
    await harness?.teardown();
  });

  it('startup validation accepts a team-bound key for its own team', async () => {
    const whoami = await validateStartupBinding({ agent: keyAgent, teamId });

    // credentialBinding only appears under agent-key auth — its presence proves
    // the connection really used the key rather than falling back to OAuth2.
    expect(whoami.subjectType).toBe('agent');
    expect(whoami.identityId).toBe(identityId);
    expect(whoami.scopes).toEqual(DAEMON_CREDENTIAL_SCOPES);
    expect(whoami.credentialBinding?.boundTeamId).toBe(teamId);
  });

  it('startup validation fails fast when the key is bound to a different team', async () => {
    const otherTeam = randomUUID();

    // whoami still succeeds (the key is valid); the pure binding check turns the
    // team mismatch into an actionable startup fatal. The message must name both
    // teams and the recovery step so an operator can act without guessing.
    const error = await validateStartupBinding({
      agent: keyAgent,
      teamId: otherTeam,
    }).then(
      () => null,
      (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
    );
    expect(error, 'expected a startup validation failure').not.toBeNull();
    const message = error?.message ?? '';
    expect(message).toContain(teamId); // the team the key is actually bound to
    expect(message).toContain(otherTeam); // the requested --team
    expect(message).toMatch(/Restart with --team|issue a key/); // recovery guidance
  });

  it('runs a full claim → execute → complete loop authenticated with the agent key', async () => {
    // Propose with the OAuth2 facade; claim + execute + complete + finalize all
    // run through `keyAgent`, so every task-lifecycle call is key-authenticated.
    const created = await oauthAgent.tasks.create(
      {
        taskType: 'curate_pack',
        diaryId,
        input: {
          diaryId,
          taskPrompt: 'e2e daemon agent-key smoke',
        },
      },
      { teamId },
    );

    const runtime = new AgentRuntime({
      source: new PollingApiTaskSource({
        agent: keyAgent,
        teamId,
        taskTypes: ['curate_pack'],
        leaseTtlSec: 60,
        stopWhenEmpty: true,
        logger: silentLogger,
      }),
      makeReporter: () =>
        new ApiTaskReporter({
          tasks: keyAgent.tasks,
          leaseTtlSec: 60,
          heartbeatIntervalMs: 0,
        }),
      executeTask: async (claimedTask, reporter) => {
        await reporter.open({
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
        });
        const stubOutput = {
          packId: '00000000-0000-4000-8000-000000000001',
          packCid:
            'bafyreidlnv7nu7y4kdxkxv5e2onbpoq5o3i6gw7r6xkk7d3w5b3xrylkqe',
          entries: [
            {
              entryId: '00000000-0000-4000-8000-000000000002',
              rank: 1,
              rationale: 'e2e agent-key stub entry',
            },
          ],
          recipeParams: {},
          summary:
            'e2e agent-key stub curation summary, two sentences satisfy minLength.',
          verification: buildProducerVerification(claimedTask.task.inputCid, {
            detail:
              'submit tool criterion satisfied in daemon agent-key e2e stub',
          }),
        };
        const output = {
          taskId: claimedTask.task.id,
          attemptN: claimedTask.attemptN,
          status: 'completed' as const,
          output: stubOutput,
          outputCid: await computeJsonCid(stubOutput),
          usage: { inputTokens: 1, outputTokens: 1 },
          durationMs: 1,
        };
        await reporter.finalize(output.usage);
        await reporter.close();
        return output;
      },
    });

    const outputs = await runtime.start();
    expect(outputs).toHaveLength(1);
    const [output] = outputs;
    expect(output.taskId).toBe(created.id);
    expect(output.status).toBe('completed');

    await finalizeTask(keyAgent, output);

    const final = await keyAgent.tasks.get(created.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
  }, 60_000);

  // The tests above call the SDK/validation helpers directly. The remainder
  // exercises production daemon wiring with no credential files at all.
  const AGENT_NAME = 'e2e-key-daemon';

  function createConfiglessAgentRoot(): string {
    const root = mkdtempSync(join(tmpdir(), 'daemon-key-wiring-'));
    mkdirSync(join(root, '.moltnet', AGENT_NAME), { recursive: true });
    return root;
  }

  function activateConfiglessEnv(privateKey = signingPrivateKey): () => void {
    const names = [
      'MOLTNET_AGENT_KEY',
      'MOLTNET_PRIVATE_KEY',
      'MOLTNET_API_URL',
      'MOLTNET_CLIENT_ID',
      'MOLTNET_CLIENT_SECRET',
      'MOLTNET_CREDENTIALS_PATH',
    ] as const;
    const previous = new Map(names.map((name) => [name, process.env[name]]));
    process.env.MOLTNET_AGENT_KEY = keySecret;
    process.env.MOLTNET_PRIVATE_KEY = privateKey;
    process.env.MOLTNET_API_URL = harness.restApiUrl;
    delete process.env.MOLTNET_CLIENT_ID;
    delete process.env.MOLTNET_CLIENT_SECRET;
    delete process.env.MOLTNET_CREDENTIALS_PATH;
    return () => {
      for (const name of names) {
        const value = previous.get(name);
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    };
  }

  beforeAll(async () => {
    const root = createConfiglessAgentRoot();
    const restoreEnv = activateConfiglessEnv();
    const oldCwd = process.cwd();
    const task = await oauthAgent.tasks.create(
      {
        taskType: 'freeform',
        diaryId,
        correlationId: randomUUID(),
        input: {
          brief: 'Exercise the configless daemon boundary.',
          execution: { workspace: 'none' },
        },
      },
      { teamId },
    );
    const profile = await oauthAgent.runtimeProfiles.create(
      {
        name: `configless-${randomUUID()}`,
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
    createPiTaskExecutorMock.mockClear();

    try {
      process.chdir(root);
      const exitCode = await runOnce([
        '--agent',
        AGENT_NAME,
        '--agent-root',
        root,
        '--task-id',
        task.id,
        '--profile',
        profile.id,
        '--team',
        teamId,
        '--warm-session-ttl-sec',
        '600',
      ]);
      if (exitCode !== 0) {
        throw new Error(`configless fixture exited with code ${exitCode}`);
      }
      const final = await keyAgent.tasks.get(task.id);
      if (final.status !== 'completed' || final.acceptedAttemptN === null) {
        throw new Error(
          `configless fixture did not complete: ${final.status} ` +
            `(acceptedAttemptN=${String(final.acceptedAttemptN)})`,
        );
      }
      const executorOptions = createPiTaskExecutorMock.mock.calls[0]?.[0] as
        | ExecutePiTaskOptions
        | undefined;
      if (
        !executorOptions ||
        createPiTaskExecutorMock.mock.calls.length !== 1
      ) {
        throw new Error(
          'configless fixture did not create exactly one Pi task executor',
        );
      }
      completedConfiglessFixture = {
        root,
        taskId: task.id,
        attemptN: final.acceptedAttemptN,
        profileId: profile.id,
        executorOptions,
      };
    } catch (error) {
      await oauthAgent.runtimeProfiles
        .delete(profile.id)
        .catch(() => undefined);
      rmSync(root, { recursive: true, force: true });
      throw error;
    } finally {
      process.chdir(oldCwd);
      restoreEnv();
    }
  }, 90_000);

  it('resolveAgentContext authenticates without reading an agent config', async () => {
    const root = createConfiglessAgentRoot();
    const restoreEnv = activateConfiglessEnv();
    try {
      const ctx = await resolveAgentContext(AGENT_NAME, {
        agentRootDir: root,
        authMode: 'agent-key',
      });
      const whoami = await ctx.agent.agents.whoami();
      expect(whoami.credentialBinding?.boundTeamId).toBe(teamId);
      expect(ctx.agentDir).toBe(join(root, '.moltnet', AGENT_NAME));
    } finally {
      restoreEnv();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('the `once` entry point fails fast on a wrong --team with MOLTNET_AGENT_KEY set', async () => {
    const root = createConfiglessAgentRoot();
    const otherTeam = randomUUID();
    const restoreEnv = activateConfiglessEnv();
    try {
      // Startup validation runs right after resolveAgentContext, before profile
      // resolution — the bogus --profile/--task-id are never reached.
      const error = await runOnce([
        '--agent',
        AGENT_NAME,
        '--agent-root',
        root,
        '--task-id',
        randomUUID(),
        '--profile',
        'unused-profile',
        '--team',
        otherTeam,
      ]).then(
        () => null,
        (err: unknown) => (err instanceof Error ? err : new Error(String(err))),
      );
      expect(
        error,
        'expected `once` to reject before starting work',
      ).not.toBeNull();
      const message = error?.message ?? '';
      expect(message).toContain(teamId); // the key's real bound team
      expect(message).toContain(otherTeam); // the wrong --team requested
    } finally {
      restoreEnv();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it('refuses an under-scoped key before claiming the task', async () => {
    const root = createConfiglessAgentRoot();
    const restoreEnv = activateConfiglessEnv();
    process.env.MOLTNET_AGENT_KEY = underScopedKeySecret;
    const task = await oauthAgent.tasks.create(
      {
        taskType: 'freeform',
        diaryId,
        input: {
          brief: 'This task must remain unclaimed.',
          execution: { workspace: 'none' },
        },
      },
      { teamId },
    );

    try {
      await expect(
        runOnce([
          '--agent',
          AGENT_NAME,
          '--agent-root',
          root,
          '--task-id',
          task.id,
          '--profile',
          'must-not-resolve',
          '--team',
          teamId,
        ]),
      ).rejects.toThrow(
        /missing required scopes.*runtime:read task:read task:claim task:execute/,
      );
      const unchanged = await oauthAgent.tasks.get(task.id);
      expect(unchanged.status).toBe(task.status);
      expect(unchanged.acceptedAttemptN).toBeNull();
    } finally {
      restoreEnv();
      rmSync(root, { recursive: true, force: true });
    }
  }, 30_000);

  it.each([
    ['missing', ''],
    ['mismatched', randomBytes(32).toString('base64')],
  ])(
    '%s signing material leaves the task unclaimed',
    async (_caseName, privateKey) => {
      const root = createConfiglessAgentRoot();
      const restoreEnv = activateConfiglessEnv(privateKey);
      const task = await oauthAgent.tasks.create(
        {
          taskType: 'freeform',
          diaryId,
          input: {
            brief: 'This task must remain unclaimed.',
            execution: { workspace: 'none' },
          },
        },
        { teamId },
      );
      try {
        await expect(
          runOnce([
            '--agent',
            AGENT_NAME,
            '--agent-root',
            root,
            '--task-id',
            task.id,
            '--profile',
            'must-not-resolve',
            '--team',
            teamId,
          ]),
        ).rejects.toThrow(/MOLTNET_PRIVATE_KEY|does not match/);
        const unchanged = await oauthAgent.tasks.get(task.id);
        expect(unchanged.status).toBe(task.status);
        expect(unchanged.acceptedAttemptN).toBeNull();
      } finally {
        restoreEnv();
        rmSync(root, { recursive: true, force: true });
      }
    },
    30_000,
  );

  it('runs configless once through attestation, task IO, artifacts, slots, and sessions', async () => {
    const { root, taskId, attemptN, executorOptions } =
      completedConfiglessFixture;
    expect(executorOptions).toMatchObject({
      agentName: AGENT_NAME,
      agentRootDir: root,
      guestCredentialMode: 'host-authenticated',
    });
    const executorWhoami = await executorOptions.moltnetAgent?.agents.whoami();
    expect(executorWhoami?.credentialBinding?.boundTeamId).toBe(teamId);

    const final = await keyAgent.tasks.get(taskId);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);

    const messages = await keyAgent.tasks.listMessages(taskId, attemptN);
    expect(JSON.stringify(messages)).toContain('configless_agent_key_e2e');

    const artifacts = await keyAgent.tasks.artifacts.list(taskId, { teamId });
    const artifact = artifacts.find(
      (item) => item.title === 'configless-agent-key.txt',
    );
    expect(artifact).toBeTruthy();
    const downloadedArtifact = await keyAgent.tasks.artifacts.download(
      {
        taskId,
        attemptN,
        cid: artifact!.cid,
      },
      { teamId },
    );
    await expect(
      collectStreamText(downloadedArtifact.stream),
    ).resolves.toContain('configless artifact');

    const slot = await keyAgent.runtimeSlots.findLatestForAttempt(
      { taskId, attemptN },
      { teamId },
    );
    expect(slot?.slot.sessionDir).toBeTruthy();
    const session = await keyAgent.runtimeSessions.getForAttempt(
      { taskId, attemptN },
      { teamId },
    );
    expect(session).toBeTruthy();
    const downloadedSession = await keyAgent.runtimeSessions.download(
      { taskId, attemptN },
      { teamId },
    );
    await expect(collectStreamText(downloadedSession)).resolves.toContain(
      taskId,
    );

    expect(existsSync(join(root, '.moltnet', AGENT_NAME, 'moltnet.json'))).toBe(
      false,
    );
    expect(existsSync(join(root, '.moltnet', AGENT_NAME, 'env'))).toBe(false);
  }, 90_000);

  it.each([
    ['identity', () => keyAgent.agents.whoami()],
    [
      'runtime profile',
      () => keyAgent.runtimeProfiles.get(completedConfiglessFixture.profileId),
    ],
    ['task queue', () => keyAgent.tasks.list({ limit: 1 }, { teamId })],
    [
      'task record',
      () => keyAgent.tasks.get(completedConfiglessFixture.taskId),
    ],
    [
      'task messages',
      () =>
        keyAgent.tasks.listMessages(
          completedConfiglessFixture.taskId,
          completedConfiglessFixture.attemptN,
        ),
    ],
    [
      'task artifacts',
      () =>
        keyAgent.tasks.artifacts.list(completedConfiglessFixture.taskId, {
          teamId,
        }),
    ],
    [
      'runtime slots',
      () =>
        keyAgent.runtimeSlots.findLatestForAttempt(
          {
            taskId: completedConfiglessFixture.taskId,
            attemptN: completedConfiglessFixture.attemptN,
          },
          { teamId },
        ),
    ],
    [
      'runtime sessions',
      () =>
        keyAgent.runtimeSessions.getForAttempt(
          {
            taskId: completedConfiglessFixture.taskId,
            attemptN: completedConfiglessFixture.attemptN,
          },
          { teamId },
        ),
    ],
  ] as const)(
    'canonical daemon scopes authorize the %s endpoint family',
    async (_family, request) => {
      await expect(request()).resolves.toBeDefined();
    },
  );

  it('keeps core keys out of knowledge APIs and permits explicitly scoped replacements', async () => {
    await expect(keyAgent.entries.list(diaryId)).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<MoltNetError>);
    await expect(keyAgent.packs.list({ diaryId })).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<MoltNetError>);

    const issued = await oauthAgent.agentKeys.create(
      {
        agentId: identityId,
        name: 'daemon-e2e-knowledge-key',
        scopes: [
          ...DAEMON_CREDENTIAL_SCOPES,
          'diary:read',
          'diary:write',
          'pack:read',
          'pack:write',
        ],
        ttlDays: 1,
      },
      { teamId, idempotencyKey: randomUUID() },
    );
    const knowledgeAgent = await connect({
      apiUrl: harness.restApiUrl,
      agentKey: issued.secret,
    });
    const entry = await knowledgeAgent.entries.create(diaryId, {
      title: 'Knowledge key e2e entry',
      content: 'Knowledge-enabled keys may write diary and pack data.',
      tags: ['e2e:agent-key'],
    });
    const entries = await knowledgeAgent.entries.list(diaryId);
    expect(entries.items.map((item) => item.id)).toContain(entry.id);

    await expect(
      keyAgent.entries.create(diaryId, { content: 'must be denied' }),
    ).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<MoltNetError>);
    await expect(
      keyAgent.packs.create(diaryId, {
        packType: 'custom',
        entries: [{ entryId: entry.id, rank: 1 }],
        params: {},
      }),
    ).rejects.toMatchObject({
      statusCode: 403,
    } satisfies Partial<MoltNetError>);

    const pack = await knowledgeAgent.packs.create(diaryId, {
      packType: 'custom',
      entries: [{ entryId: entry.id, rank: 1 }],
      params: {},
    });
    expect(pack.packId).toBeTruthy();
    await expect(knowledgeAgent.packs.get(pack.packId!)).resolves.toMatchObject(
      {
        id: pack.packId,
      },
    );
    await expect(knowledgeAgent.packs.list({ diaryId })).resolves.toBeDefined();
  }, 60_000);
});

async function collectStreamText(
  stream: AsyncIterable<Uint8Array>,
): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}
