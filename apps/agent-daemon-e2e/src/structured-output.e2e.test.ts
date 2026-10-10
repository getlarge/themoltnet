/** Exercise the daemon and Pi with scripted provider responses. Live model coverage lives in live-ollama.e2e.test.ts. */
import { randomUUID } from 'node:crypto';
import { rmSync } from 'node:fs';
import { type Server, type ServerResponse } from 'node:http';

import { checkGates } from '@moltnet/agent-eval';
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
const FREEFORM_TOOL = 'submit_freeform_output';
const PAGE_SCHEMA = {
  type: 'object',
  properties: {
    rooms: {
      type: 'object',
      properties: {
        livingRoom: {
          type: 'object',
          properties: {
            widthM: { type: 'number' },
            lengthM: { type: 'number' },
          },
          required: ['widthM', 'lengthM'],
          additionalProperties: false,
        },
        bedroom: {
          type: 'object',
          properties: {
            widthM: { type: 'number' },
            lengthM: { type: 'number' },
          },
          required: ['widthM', 'lengthM'],
          additionalProperties: false,
        },
      },
      required: ['livingRoom', 'bedroom'],
      additionalProperties: false,
    },
    circulation: { type: 'string' },
  },
  required: ['rooms', 'circulation'],
  additionalProperties: false,
};
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
  serverResponse.writeHead(200, { 'content-type': 'text/event-stream' });
  serverResponse.write(`data: ${JSON.stringify(chunk)}\n\n`);
  serverResponse.write(`data: ${JSON.stringify(end)}\n\n`);
  serverResponse.end('data: [DONE]\n\n');
}

function sendFixtureFinalMessage(
  response: ServerResponse,
  content: string,
): void {
  const chunk = {
    id: `chatcmpl-${randomUUID()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model: MODEL,
    choices: [
      { index: 0, delta: { role: 'assistant', content }, finish_reason: null },
    ],
  };
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.write(
    `data: ${JSON.stringify({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`,
  );
  response.end('data: [DONE]\n\n');
}

describe('structured task submission through Pi (e2e)', () => {
  let harness: DaemonTestHarness;
  let agent: Agent;
  let creds: Awaited<ReturnType<DaemonTestHarness['createAgent']>>;
  let providerServer: Server;
  let providerBaseUrl: string;
  const requests: ToolWireRequest[] = [];
  const queuedArguments: Array<
    { toolName: string; args: Record<string, unknown> } | { finalText: string }
  > = [];
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
        const responseFixture = queuedArguments.shift();
        if (!responseFixture) {
          response.writeHead(500).end('No fixture response queued');
          return;
        }
        if ('finalText' in responseFixture) {
          sendFixtureFinalMessage(response, responseFixture.finalText);
        } else {
          sendToolCall(
            response,
            responseFixture.toolName,
            responseFixture.args,
          );
        }
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

  async function runFixtureTask(
    argumentsToReturn: Array<Record<string, unknown> | { finalText: string }>,
    taskType: 'fulfill_brief' | 'freeform' = 'fulfill_brief',
    extraInput: Record<string, unknown> = {},
    expectedExitCode = 0,
  ) {
    const requestStart = requests.length;
    const toolName = taskType === 'freeform' ? FREEFORM_TOOL : SUBMIT_TOOL;
    queuedArguments.length = 0;
    queuedArguments.push(
      ...argumentsToReturn.map((args) =>
        'finalText' in args
          ? { finalText: args.finalText as string }
          : { toolName, args },
      ),
    );
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
        models: { generation: { provider: PROVIDER, model: MODEL } },

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
        taskType,
        diaryId: creds.privateDiaryId,
        maxAttempts: 1,
        input: {
          brief: `Call ${toolName} with a short summary.`,
          ...(taskType === 'fulfill_brief'
            ? { scopeHint: 'structured-output-e2e' }
            : {}),
          ...extraInput,
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
      expect(exitCode).toBe(expectedExitCode);
    } finally {
      queuedArguments.length = 0;
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

  it('uses a typed freeform envelope without pretending to validate page JSON inside its body', async () => {
    const pageBody = JSON.stringify({ page: 1, unexpectedField: true });
    const { task, taskRequests } = await runFixtureTask(
      [
        {
          summary: 'A small page draft was returned.',
          artifacts: [
            {
              kind: 'page',
              title: 'Page 1',
              body: pageBody,
              contentType: 'application/json',
            },
          ],
          verification: null,
        },
      ],
      'freeform',
    );

    const request = taskRequests.find((body) =>
      body.tools?.some((tool) => tool.function?.name === FREEFORM_TOOL),
    );
    const submit = request?.tools?.find(
      (tool) => tool.function?.name === FREEFORM_TOOL,
    )?.function;
    expect(submit?.strict).toBe(true);
    expect(submit?.parameters?.properties).toHaveProperty('artifacts');
    expect(submit?.parameters?.properties).not.toHaveProperty('page');

    const final = await agent.tasks.get(task.id);
    expect(final.status).toBe('completed');
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.output).toHaveProperty('artifacts.0.body', pageBody);
    expect(attempt?.output).toHaveProperty('verification.passed', true);
    const gates = await checkGates(
      agent,
      task.id,
      1,
      { requireToolCalls: [FREEFORM_TOOL] },
      {
        model: MODEL,
        workspace: 'shared_mount',
        teamId: creds.personalTeamId,
        taskType: 'freeform',
      },
    );
    expect(gates.failures).toEqual([]);
    expect(gates.passed).toBe(true);
  }, 600_000);

  it('enforces a proposer supplied page schema on the tool and accepted output', async () => {
    const validPage = {
      rooms: {
        livingRoom: { widthM: 4, lengthM: 5 },
        bedroom: { widthM: 3, lengthM: 4 },
      },
      circulation: 'A doorway connects the rooms.',
    };
    const { task, taskRequests } = await runFixtureTask(
      [
        {
          summary: 'Drafted a page.',
          result: {
            ...validPage,
            rooms: { livingRoom: validPage.rooms.livingRoom },
          },
          verification: null,
        },
        { summary: 'Drafted a page.', result: validPage, verification: null },
      ],
      'freeform',
      { outputContract: { version: 1, schema: PAGE_SCHEMA } },
    );

    const submit = taskRequests[0]?.tools?.find(
      (tool) => tool.function?.name === FREEFORM_TOOL,
    )?.function;
    expect(submit?.strict).toBe(true);
    expect(submit?.parameters?.properties?.result).toHaveProperty(
      'properties.rooms.properties.bedroom.properties.widthM.type',
      'number',
    );
    expect(submit?.parameters?.properties?.result).toHaveProperty(
      'properties.circulation.type',
      'string',
    );
    expect(submit?.parameters?.properties?.result).toHaveProperty(
      'required',
      expect.arrayContaining(['rooms', 'circulation']),
    );
    expect(taskRequests).toHaveLength(2);
    expect(JSON.stringify(taskRequests[1]?.messages)).toContain(
      'output/result/rooms/bedroom',
    );
    expect(JSON.stringify(taskRequests[1]?.messages)).toContain(
      'Output failed validation',
    );
    const final = await agent.tasks.get(task.id);
    expect(final.status).toBe('completed');
    expect(final.input).toHaveProperty('outputContract.schema', PAGE_SCHEMA);
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.output).toHaveProperty('result', validPage);
    expect(attempt?.output).toHaveProperty(
      'verification.inputCid',
      final.inputCid,
    );
  }, 600_000);

  it('never accepts an invalid-only contracted result', async () => {
    const invalid = {
      summary: 'Drafted a page.',
      result: { rooms: {}, circulation: 'Hall.' },
      verification: null,
    };
    const { task, taskRequests } = await runFixtureTask(
      Array.from({ length: 8 }, () => invalid),
      'freeform',
      { outputContract: { version: 1, schema: PAGE_SCHEMA } },
      1,
    );

    expect(taskRequests.length).toBeGreaterThan(1);
    expect(JSON.stringify(taskRequests[1]?.messages)).toContain(
      'output/result/rooms/livingRoom',
    );
    const final = await agent.tasks.get(task.id);
    expect(final.status).not.toBe('completed');
    expect(final.acceptedAttemptN).toBeNull();
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.output).toBeNull();
  }, 600_000);

  it('accepts a valid JSON-only final message without a reprompt', async () => {
    const validPage = {
      rooms: {
        livingRoom: { widthM: 4, lengthM: 5 },
        bedroom: { widthM: 3, lengthM: 4 },
      },
      circulation: 'A doorway connects the rooms.',
    };
    const finalText = [
      '```json',
      JSON.stringify({ summary: 'Drafted a page.', result: validPage }),
      '```',
    ].join('\n');
    const { task, taskRequests } = await runFixtureTask(
      [{ finalText }],
      'freeform',
      { outputContract: { version: 1, schema: PAGE_SCHEMA } },
    );

    expect(taskRequests).toHaveLength(1);
    const final = await agent.tasks.get(task.id);
    expect(final.status).toBe('completed');
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.output).toHaveProperty('result', validPage);
    expect(attempt?.output).toHaveProperty(
      'verification.inputCid',
      final.inputCid,
    );
    const info = await agent.tasks.listMessages(task.id, 1, { kind: ['info'] });
    const events = info.map((message) => message.payload);
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'final_message_submit',
        result: 'captured',
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({
        event: 'output_completion',
        output_source: 'final_message',
      }),
    );
  }, 600_000);

  it('reprompts with validation errors when a JSON-only final message is invalid', async () => {
    const invalidFinal = JSON.stringify({
      summary: 'Drafted a page.',
      result: { rooms: {}, circulation: 'Hall.' },
    });
    const { task, taskRequests } = await runFixtureTask(
      Array.from({ length: 4 }, () => ({ finalText: invalidFinal })),
      'freeform',
      { outputContract: { version: 1, schema: PAGE_SCHEMA } },
      1,
    );

    // Initial prompt plus the default three validation reprompts. Text-only
    // turns do not count toward the profile's maxTurns cap.
    expect(taskRequests).toHaveLength(4);
    expect(JSON.stringify(taskRequests[1]?.messages)).toContain(
      'invalid final message 1',
    );
    expect(JSON.stringify(taskRequests[1]?.messages)).toContain(
      'output/result/rooms/livingRoom',
    );
    const final = await agent.tasks.get(task.id);
    expect(final.status).not.toBe('completed');
    expect(final.acceptedAttemptN).toBeNull();
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.output).toBeNull();
    expect(attempt?.error?.code).toBe('output_validation_failed');
  }, 600_000);

  it('rejects an unsupported contract before calling the provider', async () => {
    const { task, taskRequests } = await runFixtureTask(
      [],
      'freeform',
      {
        outputContract: {
          version: 1,
          schema: { ...PAGE_SCHEMA, $ref: '#/missing' },
        },
      },
      1,
    );

    expect(taskRequests).toHaveLength(0);
    const final = await agent.tasks.get(task.id);
    expect(final.status).not.toBe('completed');
    expect(final.acceptedAttemptN).toBeNull();
    const attempt = (await agent.tasks.listAttempts(task.id))[0];
    expect(attempt?.error?.code).toBe('invalid_output_contract');
    expect(attempt?.error?.message).toContain('$ref');
    expect(attempt?.output).toBeNull();
  }, 600_000);
});
