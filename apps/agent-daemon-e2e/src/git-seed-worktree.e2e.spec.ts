/**
 * A gitSeed scenario runs like production adaptive review: the daemon cuts a
 * dedicated worktree detached at the pinned head commit of a repository that
 * also holds the base commit. Scripted provider responses keep this free of
 * live model calls; the scenario lives under __tests__/ so the paid evals-v2
 * corpus never picks it up.
 */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { type Server, type ServerResponse } from 'node:http';
import { join } from 'node:path';

import { checkGates, readScenario } from '@moltnet/agent-eval';
import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDaemonRunRoots,
  createScenarioProducerTask,
  runDaemonOnce,
  startHttpStub,
} from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const PROVIDER = 'git-seed-fixture';
const MODEL = 'git-seed-tool-fixture';
const KEY_ENV = 'OLLAMA_API_KEY';
const SUBMIT_TOOL = 'submit_freeform_output';

interface WireRequest {
  messages?: Array<{ role?: string; content?: unknown }>;
}

function sendToolCall(
  response: ServerResponse,
  toolName: string,
  args: Record<string, unknown>,
): void {
  const chunk = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      {
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: `call-${randomUUID()}`,
              type: 'function',
              function: { name: toolName, arguments: JSON.stringify(args) },
            },
          ],
        },
        finish_reason: null,
      },
    ],
  };
  const end = {
    ...chunk,
    choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
    usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 },
  };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write(`data: ${JSON.stringify(end)}\n\n`);
  response.end('data: [DONE]\n\n');
}

describe('gitSeed scenario in a dedicated worktree (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;
  let providerServer: Server;
  let providerBaseUrl: string;
  const requests: WireRequest[] = [];
  const queued: Array<{ toolName: string; args: Record<string, unknown> }> = [];
  const tempRoots: string[] = [];

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    creds = await harness.createAgent('e2e-git-seed');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const stub = await startHttpStub((request, response) => {
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push(
          JSON.parse(Buffer.concat(chunks).toString('utf8')) as WireRequest,
        );
        const next = queued.shift();
        if (!next) {
          response.writeHead(500).end('No fixture response queued');
          return;
        }
        sendToolCall(response, next.toolName, next.args);
      });
    });
    providerServer = stub.server;
    providerBaseUrl = `${stub.url}/v1`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      providerServer?.close((error) => (error ? reject(error) : resolve()));
    });
    for (const root of tempRoots)
      rmSync(root, { recursive: true, force: true });
    await harness?.teardown();
  });

  it('pins the producer worktree at head with base as its parent', async () => {
    // Arrange
    const scenario = readScenario(
      join(import.meta.dirname, '../__tests__/fixtures/git-seed-review'),
    );
    const { sandboxRoot, agentRoot, piDir } =
      createDaemonRunRoots('git-seed-e2e');
    tempRoots.push(sandboxRoot, agentRoot, piDir);
    writePiConfig({
      piDir,
      providers: {
        [PROVIDER]: {
          api: 'openai-completions',
          baseUrl: providerBaseUrl,
          apiKeyEnvRef: `$${KEY_ENV}`,
          models: [{ id: MODEL, supportsStrictMode: true }],
        },
      },
    });
    const profile = await agent.runtimeProfiles.create(
      {
        name: `git-seed-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        models: { generation: { provider: PROVIDER, model: MODEL } },
        maxTurns: 3,
        defaultWorkspaceMode: 'shared_mount',
        allowedWorkspaceModes: ['shared_mount', 'dedicated_worktree'],
        requiredEnv: [KEY_ENV],
        requiredTools: [],
        sandbox: { resources: { cpus: 2, memory: '2G' } },
      },
      { teamId: creds.personalTeamId },
    );
    const task = await createScenarioProducerTask({
      agent,
      scenario,
      sandboxRoot,
      teamId: creds.personalTeamId,
      diaryId: creds.privateDiaryId,
      title: 'git-seed worktree e2e',
    });
    const revisions = task.gitRevisions;
    if (!revisions) throw new Error('gitSeed scenario produced no revisions');
    queued.length = 0;
    queued.push(
      {
        toolName: 'bash',
        args: {
          // Output-only marker: the command text never contains `parent=<sha>`.
          command: `git rev-parse HEAD && git merge-base --is-ancestor ${revisions.base} HEAD && echo "parent=$(git rev-parse HEAD^)"`,
        },
      },
      {
        toolName: SUBMIT_TOOL,
        args: {
          summary: 'Inspected the pinned head commit.',
          result: { verdict: 'off-by-one in limit' },
          verification: null,
        },
      },
    );
    const requestStart = requests.length;

    // Act
    let exitCode: number;
    try {
      exitCode = await runDaemonOnce({
        credentials: {
          agent,
          agentRoot,
          agentName: creds.name,
          agentId: creds.agentId,
          teamId: creds.personalTeamId,
          publicKey: creds.keyPair.publicKey,
          privateKey: creds.keyPair.privateKey,
          fingerprint: creds.keyPair.fingerprint,
          apiUrl: harness.restApiUrl,
        },
        sandboxRoot,
        piDir,
        taskId: task.id,
        profileId: profile.id,
        env: { [KEY_ENV]: 'fixture-key' },
      });
    } finally {
      queued.length = 0;
      await agent.runtimeProfiles.delete(profile.id);
    }

    // Assert
    expect(exitCode).toBe(0);
    const stored = await agent.tasks.get(task.id);
    expect(stored.status).toBe('completed');
    expect(stored.input).toHaveProperty('execution', {
      workspace: 'dedicated_worktree',
      revision: revisions.head,
    });
    expect(JSON.stringify(stored.input)).toContain(revisions.head);
    const info = await agent.tasks.listMessages(task.id, 1, { kind: ['info'] });
    expect(info.map((message) => message.payload)).toContainEqual(
      expect.objectContaining({
        event: 'execute_start',
        workspaceMode: 'dedicated_worktree',
        workspaceRevision: revisions.head,
      }),
    );
    // The model-visible shell ran inside the worktree checked out at head.
    // Only tool-role messages count: the brief itself names both commits.
    const toolResults = JSON.stringify(
      (requests[requestStart + 1]?.messages ?? []).filter(
        (message) => message.role === 'tool',
      ),
    );
    expect(toolResults).toContain(revisions.head);
    expect(toolResults).toContain(`parent=${revisions.base}`);
    const gates = await checkGates(agent, task.id, 1, scenario.gates, {
      model: MODEL,
      workspace: scenario.execution.workspace,
      teamId: creds.personalTeamId,
      taskType: 'freeform',
      outputContract: scenario.outputContract,
    });
    expect(gates.failures).toEqual([]);
  }, 600_000);
});
