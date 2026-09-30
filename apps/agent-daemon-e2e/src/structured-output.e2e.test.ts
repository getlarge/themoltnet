/** Exercise the real daemon, Pi session, provider wire format, and task API. */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { type Server, type ServerResponse } from 'node:http';

import { getSubmitOutputContract } from '@themoltnet/agent-runtime';
import { writePiConfig } from '@themoltnet/pi-runtime/pi-config';
import { type Agent, connect } from '@themoltnet/sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  createDaemonRunRoots,
  runDaemonOnce,
  startHttpStub,
} from './fixtures.js';
import { createDaemonTestHarness, type DaemonTestHarness } from './setup.js';

const PROVIDER = 'structured-output-fixture';
const MODEL = 'strict-tool-fixture';
const KEY_ENV = 'OLLAMA_API_KEY';
const SUBMIT_TOOL = 'submit_fulfill_brief_output';
const VALID_ARGUMENTS = {
  branch: 'e2e/structured-output',
  commits: [],
  pullRequestUrl: null,
  diaryEntryIds: [],
  summary: 'The structured output fixture completed the task.',
  // Pi's strict schema makes optional fields required and nullable.
  verification: null,
};

interface ToolWireRequest {
  messages?: Array<{ role?: string; content?: unknown }>;
  tools?: Array<{
    type?: string;
    function?: {
      name?: string;
      strict?: boolean;
      parameters?: {
        type?: string;
        properties?: Record<string, unknown>;
        required?: string[];
        additionalProperties?: boolean;
      };
    };
  }>;
}

function sendToolCall(
  serverResponse: ServerResponse,
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
              function: { name: SUBMIT_TOOL, arguments: JSON.stringify(args) },
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
  serverResponse.writeHead(200, { 'content-type': 'text/event-stream' });
  serverResponse.write(`data: ${JSON.stringify(chunk)}\n\n`);
  serverResponse.write(`data: ${JSON.stringify(end)}\n\n`);
  serverResponse.end('data: [DONE]\n\n');
}

describe('structured task submission through Pi (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;
  let providerServer: Server;
  let providerBaseUrl: string;
  const requests: ToolWireRequest[] = [];
  const queuedArguments: Record<string, unknown>[] = [];
  const tempRoots: string[] = [];

  beforeAll(async () => {
    harness = await createDaemonTestHarness();
    creds = await harness.createAgent('e2e-structured-output');
    agent = await connect({
      apiUrl: harness.restApiUrl,
      clientId: creds.clientId,
      clientSecret: creds.clientSecret,
    });
    const providerStub = await startHttpStub((request, response) => {
      if (request.url !== '/v1/chat/completions') {
        response.writeHead(404).end();
        return;
      }
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        requests.push(
          JSON.parse(Buffer.concat(chunks).toString('utf8')) as ToolWireRequest,
        );
        const args = queuedArguments.shift();
        if (!args) {
          response.writeHead(500).end('No fixture response queued');
          return;
        }
        sendToolCall(response, args);
      });
    });
    providerServer = providerStub.server;
    providerBaseUrl = `${providerStub.url}/v1`;
  }, 120_000);

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      providerServer?.close((error) => (error ? reject(error) : resolve()));
    });
    for (const root of tempRoots)
      rmSync(root, { recursive: true, force: true });
    await harness?.teardown();
  });

  async function runFixtureTask(argumentsToReturn: Record<string, unknown>[]) {
    const requestStart = requests.length;
    queuedArguments.push(...argumentsToReturn);
    const { sandboxRoot, agentRoot, piDir } =
      createDaemonRunRoots('structured-e2e');
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
        name: `structured-output-${randomUUID()}`,
        runtimeKind: 'gondolin_pi',
        provider: PROVIDER,
        model: MODEL,
        maxTurns: 3,
        defaultWorkspaceMode: 'shared_mount',
        allowedWorkspaceModes: ['shared_mount'],
        requiredEnv: [KEY_ENV],
        requiredTools: [],
        sandbox: { resources: { cpus: 2, memory: '2G' } },
      },
      { teamId: creds.personalTeamId },
    );
    const task = await agent.tasks.create(
      {
        taskType: 'fulfill_brief',
        diaryId: creds.privateDiaryId,
        maxAttempts: 1,
        input: {
          brief: 'Call submit_fulfill_brief_output with a short summary.',
          scopeHint: 'structured-output-e2e',
        },
      },
      { teamId: creds.personalTeamId },
    );

    try {
      const exitCode = await runDaemonOnce({
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
      expect(exitCode).toBe(0);
    } finally {
      await agent.runtimeProfiles.delete(profile.id);
    }
    return { task, taskRequests: requests.slice(requestStart) };
  }

  it('advertises a strict task schema and accepts the resulting tool submission', async () => {
    const { task, taskRequests } = await runFixtureTask([VALID_ARGUMENTS]);

    const request = taskRequests.find((body) =>
      body.tools?.some((tool) => tool.function?.name === SUBMIT_TOOL),
    );
    const submit = request?.tools?.find(
      (tool) => tool.function?.name === SUBMIT_TOOL,
    )?.function;
    const contract = getSubmitOutputContract('fulfill_brief');
    expect(contract).not.toBeNull();
    expect(submit?.strict).toBe(true);
    expect(submit?.parameters?.type).toBe('object');
    expect(Object.keys(submit?.parameters?.properties ?? {})).toEqual(
      Object.keys(
        (contract!.parametersSchema as { properties: Record<string, unknown> })
          .properties,
      ),
    );
    expect(submit?.parameters?.required).toContain('verification');
    expect(submit?.parameters?.additionalProperties).toBe(false);

    const final = await agent.tasks.get(task.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.status).toBe('completed');
    expect(attempt?.output).toMatchObject({
      branch: 'e2e/structured-output',
      summary: 'The structured output fixture completed the task.',
    });
    expect(attempt?.output).toHaveProperty('verification.passed', true);
    expect(attempt?.output).toHaveProperty(
      'verification.results.0.id',
      'submit-output',
    );
  }, 600_000);

  it('returns invalid tool arguments to Pi and accepts the corrected call', async () => {
    const { task, taskRequests } = await runFixtureTask([
      { ...VALID_ARGUMENTS, summary: undefined },
      VALID_ARGUMENTS,
    ]);

    expect(taskRequests).toHaveLength(2);
    expect(taskRequests[1]?.messages).toEqual(
      expect.arrayContaining([expect.objectContaining({ role: 'tool' })]),
    );
    const final = await agent.tasks.get(task.id);
    expect(final.status).toBe('completed');
    expect(final.acceptedAttemptN).toBe(1);
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.output).toMatchObject({
      summary: VALID_ARGUMENTS.summary,
    });
  }, 600_000);
});
