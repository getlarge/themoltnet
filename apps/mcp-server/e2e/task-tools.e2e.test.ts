/**
 * E2E: Task Tools — tasks_schemas, create/list/get, attempts/messages
 *
 * The MCP task surface is intentionally human-facing. Runtime execution
 * endpoints such as claim and append messages stay REST-only, so this suite
 * uses REST to create attempt/message state and MCP to inspect it.
 */

import type { Client } from '@modelcontextprotocol/sdk/client/index.js';
import {
  appendTaskMessages,
  claimTask,
  completeTask,
  createClient,
  getTask,
  taskHeartbeat,
} from '@moltnet/api-client';
import { computeJsonCid } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { connectMcpTestClient, parseToolResult } from './mcp-client.js';
import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Task Tools E2E', () => {
  let harness: McpTestHarness;
  let client: Client;
  let setupError: Error | undefined;

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
      client = await connectMcpTestClient(harness, 'e2e-task-client');
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

  it('tasks_continue creates a freeform continuation with auto-injected claim condition', async () => {
    requireSetup();
    const apiClient = createClient({ baseUrl: harness.restApiUrl });

    // 1. Create a freeform source task via the MCP surface so we exercise
    //    the same `tasks_create` path tasks_continue ultimately delegates to.
    const createResult = await client.callTool({
      name: 'tasks_create',
      arguments: {
        task_type: 'freeform',
        team_id: harness.personalTeamId,
        diary_id: harness.privateDiaryId,
        input: {
          brief: 'Explore continuation source for tasks_continue e2e',
        },
      },
    });
    const created = parseToolResult<{ id: string }>(createResult);
    expect(
      createResult.isError,
      `tasks_create error: ${created.content[0].text}`,
    ).toBeUndefined();
    const sourceTaskId = created.parsed.id;

    // 2. Claim + heartbeat + complete the source attempt with a daemonState
    //    payload that reports a fresh `slotResumableUntil`. This is what the
    //    server-side async validator checks before accepting a continuation.
    const { data: claimed, error: claimError } = await claimTask({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: sourceTaskId },
      body: { leaseTtlSec: 60 },
    });
    expect(
      claimError,
      `claimTask error: ${JSON.stringify(claimError)}`,
    ).toBeUndefined();
    const attemptN = claimed!.attempt.attemptN;

    const { error: hbError } = await taskHeartbeat({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: sourceTaskId, n: attemptN },
      body: { leaseTtlSec: 60 },
    });
    expect(
      hbError,
      `taskHeartbeat error: ${JSON.stringify(hbError)}`,
    ).toBeUndefined();

    const output = {
      summary: 'Source freeform attempt completed for the tasks_continue e2e.',
    };
    const outputCid = await computeJsonCid(output);
    const resumableUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const { error: completeError } = await completeTask({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: sourceTaskId, n: attemptN },
      body: {
        output,
        outputCid,
        usage: { model: 'test-model', inputTokens: 10, outputTokens: 5 },
        daemonState: {
          reportedAt: new Date().toISOString(),
          slotResumableUntil: resumableUntil,
        },
      },
    });
    expect(
      completeError,
      `completeTask error: ${JSON.stringify(completeError)}`,
    ).toBeUndefined();

    // Poll until DBOS workflow finishes and source task is in `completed`.
    let sourceStatus: string | undefined;
    for (let i = 0; i < 30; i++) {
      const { data } = await getTask({
        client: apiClient,
        auth: () => harness.agent.accessToken,
        path: { id: sourceTaskId },
      });
      if (data && (data.status === 'completed' || data.status === 'failed')) {
        sourceStatus = data.status;
        break;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 500);
      });
    }
    expect(sourceStatus).toBe('completed');

    // 3. Call tasks_continue with the source's id + attempt 1.
    const continueResult = await client.callTool({
      name: 'tasks_continue',
      arguments: {
        fromTaskId: sourceTaskId,
        fromAttemptN: attemptN,
        brief: 'Pick up where the source attempt left off.',
      },
    });
    const cont = parseToolResult<{
      id: string;
      status: string;
      input: {
        brief: string;
        continueFrom?: { taskId: string; attemptN: number; mode?: string };
      };
      claimCondition: {
        op: string;
        taskId?: string;
        statuses?: string[];
      } | null;
      consoleUrl?: string;
    }>(continueResult);
    expect(
      continueResult.isError,
      `tasks_continue error: ${cont.content[0].text}`,
    ).toBeUndefined();

    // 4. Continuation carries continueFrom + the auto-injected
    //    task_status:completed claim condition on the parent.
    expect(cont.parsed.input.brief).toBe(
      'Pick up where the source attempt left off.',
    );
    expect(cont.parsed.input.continueFrom).toEqual(
      expect.objectContaining({
        taskId: sourceTaskId,
        attemptN,
      }),
    );
    expect(cont.parsed.claimCondition).toEqual({
      op: 'task_status',
      taskId: sourceTaskId,
      statuses: ['completed'],
    });
    expect(cont.parsed.consoleUrl).toContain(`/tasks/${cont.parsed.id}`);
  }, 60_000);

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
