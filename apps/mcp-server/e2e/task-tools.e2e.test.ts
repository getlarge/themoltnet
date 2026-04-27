/**
 * E2E: Task Tools — tasks_schemas, create/list/get, attempts/messages
 *
 * The MCP task surface is intentionally human-facing. Runtime execution
 * endpoints such as claim and append messages stay REST-only, so this suite
 * uses REST to create attempt/message state and MCP to inspect it.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {
  appendTaskMessages,
  claimTask,
  createClient,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Task Tools E2E', () => {
  let harness: McpTestHarness;
  let client: Client;
  let setupError: Error | undefined;

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${harness.mcpBaseUrl}/mcp`),
        {
          requestInit: {
            headers: {
              'X-Client-Id': harness.agent.clientId,
              'X-Client-Secret': harness.agent.clientSecret,
            },
          },
        },
      );
      client = new Client({ name: 'e2e-task-client', version: '1.0.0' });
      await client.connect(transport);
    } catch (err) {
      setupError = err instanceof Error ? err : new Error(String(err));
    }
  });

  afterAll(async () => {
    try {
      await client?.close();
    } finally {
      await harness?.teardown();
    }
  });

  function requireSetup(): void {
    if (setupError) {
      throw new Error(
        `MCP client setup failed — skipping is not allowed: ${setupError.message}`,
      );
    }
  }

  function parseToolResult<T>(result: Awaited<ReturnType<Client['callTool']>>) {
    const content = result.content as Array<{ type: string; text: string }>;
    return {
      content,
      parsed: JSON.parse(content[0]?.text ?? '{}') as T,
    };
  }

  async function createCuratePackTask(): Promise<string> {
    requireSetup();

    const createResult = await client.callTool({
      name: 'tasks_create',
      arguments: {
        task_type: 'curate_pack',
        team_id: harness.personalTeamId,
        diary_id: harness.privateDiaryId,
        input: {
          diaryId: harness.privateDiaryId,
          taskPrompt: 'mcp e2e task curation',
        },
      },
    });
    const { content, parsed } = parseToolResult<{
      id: string;
      status: string;
      consoleUrl?: string;
    }>(createResult);
    expect(
      createResult.isError,
      `tasks_create error: ${content[0].text}`,
    ).toBeUndefined();
    expect(parsed.status).toBe('queued');
    expect(parsed.consoleUrl).toContain(`/tasks/${parsed.id}`);
    return parsed.id;
  }

  it('exposes the task MCP App tool and resource', async () => {
    requireSetup();

    const { tools } = await client.listTools();
    const appTool = tools.find((tool) => tool.name === 'tasks_app_open');

    expect(appTool).toBeDefined();
    expect(appTool?._meta).toMatchObject({
      ui: {
        resourceUri: 'ui://moltnet/tasks.html',
        visibility: ['model', 'app'],
      },
    });

    const openResult = await client.callTool({
      name: 'tasks_app_open',
      arguments: {
        team_id: harness.personalTeamId,
        status: 'queued',
      },
    });
    const opened = parseToolResult<{
      app: string;
      resourceUri: string;
      teamId: string;
      tools: string[];
    }>(openResult);
    expect(
      openResult.isError,
      `tasks_app_open error: ${opened.content[0].text}`,
    ).toBeUndefined();
    expect(opened.parsed).toMatchObject({
      app: 'moltnet_tasks',
      resourceUri: 'ui://moltnet/tasks.html',
      teamId: harness.personalTeamId,
    });
    expect(opened.parsed.tools).toContain('tasks_list');

    const resourceResult = await client.readResource({
      uri: 'ui://moltnet/tasks.html',
    });
    expect(resourceResult.contents).toHaveLength(1);
    const resource = resourceResult.contents[0] as {
      uri: string;
      mimeType?: string;
      text?: string;
      _meta?: Record<string, unknown>;
    };
    expect(resource.uri).toBe('ui://moltnet/tasks.html');
    expect(resource.mimeType).toBe('text/html;profile=mcp-app');
    expect(resource.text).toContain('MoltNet Tasks');
    expect(resource.text).toContain("name: 'tasks_list'");
    expect(resource._meta).toMatchObject({
      ui: {
        csp: {
          connectDomains: ['https://esm.sh'],
          resourceDomains: ['https://esm.sh'],
        },
      },
    });
  });

  it('tasks_schemas lists registered task types', async () => {
    requireSetup();

    const result = await client.callTool({
      name: 'tasks_schemas',
      arguments: {},
    });
    const { content, parsed } = parseToolResult<{
      items: Array<{
        taskType: string;
        outputKind: string;
        inputSchemaCid: string;
        inputSchema: Record<string, unknown>;
      }>;
    }>(result);

    expect(
      result.isError,
      `tasks_schemas error: ${content[0].text}`,
    ).toBeUndefined();
    const curatePack = parsed.items.find(
      (item) => item.taskType === 'curate_pack',
    );
    expect(curatePack).toBeDefined();
    expect(curatePack?.outputKind).toBe('artifact');
    expect(curatePack?.inputSchemaCid).toBeTruthy();
    expect(curatePack?.inputSchema).toHaveProperty('type', 'object');
  });

  it('tasks_create validates locally before calling REST', async () => {
    requireSetup();

    const result = await client.callTool({
      name: 'tasks_create',
      arguments: {
        task_type: 'curate_pack',
        team_id: harness.personalTeamId,
        diary_id: harness.privateDiaryId,
        input: {},
      },
    });
    const { content } = parseToolResult(result);

    expect(result.isError).toBe(true);
    expect(content[0].text).toContain('task_validation_failed');
    expect(content[0].text).toContain('diaryId');
  });

  it('creates, lists, gets, and links tasks through MCP', async () => {
    requireSetup();

    const taskId = await createCuratePackTask();

    const listResult = await client.callTool({
      name: 'tasks_list',
      arguments: {
        team_id: harness.personalTeamId,
        status: 'queued',
        task_type: 'curate_pack',
        limit: 20,
      },
    });
    const list = parseToolResult<{
      items: Array<{ id: string; consoleUrl?: string }>;
      total: number;
    }>(listResult);
    expect(
      listResult.isError,
      `tasks_list error: ${list.content[0].text}`,
    ).toBeUndefined();
    const listed = list.parsed.items.find((task) => task.id === taskId);
    expect(listed).toBeDefined();
    expect(listed?.consoleUrl).toContain(`/tasks/${taskId}`);

    const getResult = await client.callTool({
      name: 'tasks_get',
      arguments: { id: taskId },
    });
    const got = parseToolResult<{ id: string; consoleUrl?: string }>(getResult);
    expect(
      getResult.isError,
      `tasks_get error: ${got.content[0].text}`,
    ).toBeUndefined();
    expect(got.parsed.id).toBe(taskId);
    expect(got.parsed.consoleUrl).toContain(`/tasks/${taskId}`);

    const linkResult = await client.callTool({
      name: 'tasks_console_link',
      arguments: { id: taskId },
    });
    const link = parseToolResult<{ id: string; consoleUrl?: string }>(
      linkResult,
    );
    expect(
      linkResult.isError,
      `tasks_console_link error: ${link.content[0].text}`,
    ).toBeUndefined();
    expect(link.parsed.id).toBe(taskId);
    expect(link.parsed.consoleUrl).toContain(`/tasks/${taskId}`);
  });

  it('reads task attempts and attempt messages through MCP', async () => {
    requireSetup();
    const taskId = await createCuratePackTask();
    const apiClient = createClient({ baseUrl: harness.restApiUrl });

    const { data: claimed, error: claimError } = await claimTask({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: taskId },
      body: { leaseTtlSec: 30 },
    });
    expect(
      claimError,
      `claimTask error: ${JSON.stringify(claimError)}`,
    ).toBeUndefined();
    expect(claimed?.attempt.attemptN).toBe(1);

    const { error: appendError } = await appendTaskMessages({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: taskId, n: claimed!.attempt.attemptN },
      body: {
        messages: [
          {
            kind: 'text_delta',
            payload: { text: 'hello from task e2e' },
          },
        ],
      },
    });
    expect(
      appendError,
      `appendTaskMessages error: ${JSON.stringify(appendError)}`,
    ).toBeUndefined();

    const attemptsResult = await client.callTool({
      name: 'tasks_attempts_list',
      arguments: { task_id: taskId },
    });
    const attempts = parseToolResult<{
      items: Array<{ taskId: string; attemptN: number; status: string }>;
    }>(attemptsResult);
    expect(
      attemptsResult.isError,
      `tasks_attempts_list error: ${attempts.content[0].text}`,
    ).toBeUndefined();
    expect(attempts.parsed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId,
          attemptN: claimed!.attempt.attemptN,
        }),
      ]),
    );

    const messagesResult = await client.callTool({
      name: 'tasks_messages_list',
      arguments: {
        task_id: taskId,
        attempt_n: claimed!.attempt.attemptN,
        limit: 20,
      },
    });
    const messages = parseToolResult<{
      items: Array<{
        taskId: string;
        attemptN: number;
        kind: string;
        payload: Record<string, unknown>;
      }>;
    }>(messagesResult);
    expect(
      messagesResult.isError,
      `tasks_messages_list error: ${messages.content[0].text}`,
    ).toBeUndefined();
    expect(messages.parsed.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          taskId,
          attemptN: claimed!.attempt.attemptN,
          kind: 'text_delta',
          payload: { text: 'hello from task e2e' },
        }),
      ]),
    );
  });
});
