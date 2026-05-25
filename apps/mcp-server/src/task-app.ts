import fs from 'node:fs/promises';

/**
 * @moltnet/mcp-server — MCP Apps task surface
 *
 * The MCP App is intentionally a host wrapper around the existing task tools.
 * It receives the opener tool result from the host, then calls tasks_list,
 * tasks_get, tasks_attempts_list, and tasks_messages_list through the MCP Apps
 * bridge. The iframe never receives a bearer token or talks to REST directly.
 */
import {
  TASK_MCP_APP_NAME,
  TASK_MCP_APP_RESOURCE_URI,
} from '@moltnet/task-mcp-app';
import type { FastifyInstance } from 'fastify';

import {
  createMcpAppResourceMeta,
  createMcpAppToolMeta,
  MCP_APP_RESOURCE_MIME_TYPE,
  resolveInstalledMcpAppHtmlPath,
} from './mcp-app-ui.js';
import type {
  TaskAppOpenInput,
  TaskAppOpenOutput,
} from './schemas/task-schemas.js';
import {
  TaskAppOpenOutputSchema,
  TaskAppOpenSchema,
} from './schemas/task-schemas.js';
import type { CallToolResult, McpDeps, ReadResourceResult } from './types.js';
import { structuredResult } from './utils.js';

export const TASK_APP_RESOURCE_URI = TASK_MCP_APP_RESOURCE_URI;
export const TASK_APP_MIME_TYPE = MCP_APP_RESOURCE_MIME_TYPE;

const TASK_APP_RESOURCE_META = createMcpAppResourceMeta();

async function buildTaskAppHtml(): Promise<string> {
  return fs.readFile(
    resolveInstalledMcpAppHtmlPath('@moltnet/task-mcp-app', import.meta.url),
    'utf8',
  );
}

function getConsoleUrl(
  deps: Pick<McpDeps, 'consoleBaseUrl'>,
  taskId: string | undefined,
  explicitUrl: string | undefined,
): string | undefined {
  if (explicitUrl) return explicitUrl;
  if (!taskId || !deps.consoleBaseUrl) return undefined;
  return `${deps.consoleBaseUrl.replaceAll(/\/+$/g, '')}/tasks/${taskId}`;
}

function definedEntries<T extends Record<string, unknown>>(
  value: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  ) as Partial<T>;
}

export function handleTasksAppOpen(
  args: TaskAppOpenInput,
  deps: Pick<McpDeps, 'consoleBaseUrl'> = {},
): CallToolResult {
  const filters = definedEntries({
    team_id: args.team_id,
    status: args.status,
    task_type: args.task_type,
    correlation_id: args.correlation_id,
    diary_id: args.diary_id,
    proposed_by_agent_id: args.proposed_by_agent_id,
    proposed_by_human_id: args.proposed_by_human_id,
    claimed_by_agent_id: args.claimed_by_agent_id,
    has_attempts: args.has_attempts,
    queued_after: args.queued_after,
    queued_before: args.queued_before,
    completed_after: args.completed_after,
    completed_before: args.completed_before,
  });
  const output: TaskAppOpenOutput = {
    app: TASK_MCP_APP_NAME,
    resourceUri: TASK_APP_RESOURCE_URI,
    teamId: args.team_id,
    taskId: args.task_id,
    status: args.status,
    filters,
    consoleUrl: getConsoleUrl(deps, args.task_id, args.console_url),
    tools: [
      'teams_list',
      'team_members_list',
      'tasks_list',
      'tasks_get',
      'tasks_attempts_list',
      'tasks_messages_list',
    ],
  };
  return structuredResult(output);
}

export async function handleTasksAppResource(): Promise<ReadResourceResult> {
  return {
    contents: [
      {
        uri: TASK_APP_RESOURCE_URI,
        mimeType: TASK_APP_MIME_TYPE,
        text: await buildTaskAppHtml(),
        _meta: TASK_APP_RESOURCE_META,
      },
    ],
  };
}

export function registerTaskApp(
  fastify: FastifyInstance,
  deps: Pick<McpDeps, 'consoleBaseUrl'>,
): void {
  fastify.mcpAddTool(
    {
      name: 'tasks_app_open',
      title: 'Open Tasks App',
      description:
        'Open the interactive MoltNet task management app. Use it when a user wants to inspect task queues, task details, attempts, or messages.',
      inputSchema: TaskAppOpenSchema,
      outputSchema: TaskAppOpenOutputSchema,
      _meta: createMcpAppToolMeta(TASK_APP_RESOURCE_URI),
    },
    (args: TaskAppOpenInput) => handleTasksAppOpen(args, deps),
  );

  fastify.mcpAddResource(
    {
      name: 'tasks-app',
      title: 'MoltNet Tasks',
      uriPattern: TASK_APP_RESOURCE_URI,
      description: 'Interactive MCP App for task queue and attempt inspection.',
      mimeType: TASK_APP_MIME_TYPE,
      _meta: TASK_APP_RESOURCE_META,
    },
    async () => handleTasksAppResource(),
  );
}
