/**
 * Seed local e2e data for manual MCP Apps testing.
 *
 * Requires the e2e Docker stack to be running:
 *   COMPOSE_DISABLE_ENV_FILE=true docker compose -f docker-compose.e2e.yaml up -d --build
 */

import {
  appendTaskMessages,
  claimTask,
  createClient,
} from '@moltnet/api-client';

import { connectMcpTestClient, parseToolResult } from './mcp-client.js';
import { createMcpTestHarness } from './setup.js';

interface CreatedTask {
  id: string;
  status: string;
  taskType: string;
  consoleUrl?: string;
}

async function createCuratePackTask(
  client: Awaited<ReturnType<typeof connectMcpTestClient>>,
  teamId: string,
  diaryId: string,
  taskPrompt: string,
): Promise<CreatedTask> {
  const result = await client.callTool({
    name: 'tasks_create',
    arguments: {
      task_type: 'curate_pack',
      team_id: teamId,
      diary_id: diaryId,
      input: {
        diaryId,
        taskPrompt,
      },
    },
  });
  const { content, parsed } = parseToolResult<CreatedTask>(result);
  if (result.isError) {
    throw new Error(`tasks_create failed: ${content[0]?.text}`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const harness = await createMcpTestHarness();
  const client = await connectMcpTestClient(harness, 'seed-task-app-client');

  try {
    const queuedTask = await createCuratePackTask(
      client,
      harness.personalTeamId,
      harness.privateDiaryId,
      'Manual MCP App smoke: queued task',
    );
    const runningTask = await createCuratePackTask(
      client,
      harness.personalTeamId,
      harness.privateDiaryId,
      'Manual MCP App smoke: running task with messages',
    );
    const secondQueuedTask = await createCuratePackTask(
      client,
      harness.personalTeamId,
      harness.privateDiaryId,
      'Manual MCP App smoke: second queued task',
    );

    const apiClient = createClient({ baseUrl: harness.restApiUrl });
    const { data: claimed, error: claimError } = await claimTask({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: runningTask.id },
      body: { leaseTtlSec: 600 },
    });
    if (claimError || !claimed) {
      throw new Error(`claimTask failed: ${JSON.stringify(claimError)}`);
    }

    const { error: appendError } = await appendTaskMessages({
      client: apiClient,
      auth: () => harness.agent.accessToken,
      path: { id: runningTask.id, n: claimed.attempt.attemptN },
      body: {
        messages: [
          {
            kind: 'text_delta',
            payload: {
              text: 'Seeded progress message for MCP App manual testing.',
            },
          },
          {
            kind: 'tool_call_start',
            payload: {
              name: 'entries_search',
              args: { query: 'task management context' },
            },
          },
        ],
      },
    });
    if (appendError) {
      throw new Error(
        `appendTaskMessages failed: ${JSON.stringify(appendError)}`,
      );
    }

    const summary = {
      mcp_url: `${harness.mcpBaseUrl}/mcp`,
      console_url: 'http://localhost:5174',
      auth_headers: {
        'X-Client-Id': harness.agent.clientId,
        'X-Client-Secret': harness.agent.clientSecret,
      },
      basic_host_env: {
        VITE_MCP_CLIENT_ID: harness.agent.clientId,
        VITE_MCP_CLIENT_SECRET: harness.agent.clientSecret,
      },
      team_id: harness.personalTeamId,
      private_diary_id: harness.privateDiaryId,
      tasks: {
        queued: queuedTask.id,
        running_with_messages: runningTask.id,
        second_queued: secondQueuedTask.id,
      },
      tasks_app_open_queue: {
        team_id: harness.personalTeamId,
        status: 'queued',
      },
      tasks_app_open_detail: {
        team_id: harness.personalTeamId,
        task_id: runningTask.id,
      },
      host_notes: [
        'Connect ext-apps basic-host to mcp_url.',
        'Call tasks_app_open with tasks_app_open_queue to inspect the queue.',
        'Call tasks_app_open with tasks_app_open_detail to open the task with an attempt and messages.',
      ],
    };

    // eslint-disable-next-line no-console
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await client.close();
    await harness.teardown();
  }
}

main().catch((error: unknown) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
