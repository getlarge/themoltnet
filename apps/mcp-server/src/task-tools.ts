/**
 * @moltnet/mcp-server — Task Tool Handlers
 *
 * Human-facing task tools. Execution tools such as claim/heartbeat/complete
 * stay out of this MCP surface and remain owned by runtimes/daemons.
 */

import {
  createTask,
  getTask,
  listTaskAttempts,
  listTaskMessages,
  listTasks,
  listTaskSchemas,
} from '@moltnet/api-client';
import { validateTaskCreateRequest } from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';

import type {
  TaskAttemptsListInput,
  TaskConsoleLinkInput,
  TaskCreateInput,
  TaskGetInput,
  TaskListInput,
  TaskMessagesListInput,
  TasksSchemasInput,
} from './schemas/task-schemas.js';
import {
  TaskAttemptsListOutputSchema,
  TaskAttemptsListSchema,
  TaskConsoleLinkOutputSchema,
  TaskConsoleLinkSchema,
  TaskCreateSchema,
  TaskGetSchema,
  TaskListOutputSchema,
  TaskListSchema,
  TaskMessagesListOutputSchema,
  TaskMessagesListSchema,
  TaskOutputSchema,
  TaskSchemasOutputSchema,
  TasksSchemasInputSchema,
} from './schemas/task-schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  structuredErrorResult,
  structuredResult,
} from './utils.js';

type TaskResult = Record<string, unknown> & { id: string; consoleUrl?: string };
type TaskListResult = {
  items: TaskResult[];
  total: number;
  nextCursor?: string;
};

function getConsoleUrl(deps: McpDeps, taskId: string): string | undefined {
  let base = deps.consoleBaseUrl;
  if (!base) return undefined;
  while (base.endsWith('/')) {
    base = base.slice(0, -1);
  }
  return `${base}/tasks/${taskId}`;
}

function withConsoleUrl<T extends { id: string }>(
  task: T,
  deps: McpDeps,
): T & { consoleUrl?: string } {
  const consoleUrl = getConsoleUrl(deps, task.id);
  return consoleUrl ? { ...task, consoleUrl } : task;
}

function formatValidationErrors(
  errors: ReturnType<typeof validateTaskCreateRequest>,
): {
  code: 'task_validation_failed';
  message: string;
  errors: ReturnType<typeof validateTaskCreateRequest>;
  retryable: false;
} {
  return {
    code: 'task_validation_failed',
    message: 'Task input failed validation',
    errors,
    retryable: false,
  };
}

export async function handleTasksSchemas(
  _args: TasksSchemasInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_schemas' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listTaskSchemas({
    client: deps.client,
    auth: () => token,
  });

  if (error || !data) {
    deps.logger.error({ tool: 'tasks_schemas', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(error, 'Failed to list task schemas'),
    );
  }

  return structuredResult(data);
}

export async function handleTasksCreate(
  args: TaskCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const validationErrors = validateTaskCreateRequest({
    taskType: args.task_type,
    input: args.input,
    criteriaCid: args.criteria_cid,
    references: args.references,
  });
  if (validationErrors.length > 0) {
    return structuredErrorResult(formatValidationErrors(validationErrors));
  }

  const { data, error } = await createTask({
    client: deps.client,
    auth: () => token,
    body: {
      taskType: args.task_type,
      teamId: args.team_id,
      diaryId: args.diary_id,
      input: args.input,
      references: args.references,
      correlationId: args.correlation_id,
      maxAttempts: args.max_attempts,
      expiresInSec: args.expires_in_sec,
      criteriaCid: args.criteria_cid,
      requiredExecutorTrustLevel: args.required_executor_trust_level,
      dispatchTimeoutSec: args.dispatch_timeout_sec,
      runningTimeoutSec: args.running_timeout_sec,
    },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'tasks_create', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to create task'));
  }

  return structuredResult(withConsoleUrl(data, deps));
}

export async function handleTasksGet(
  args: TaskGetInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_get' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getTask({
    client: deps.client,
    auth: () => token,
    path: { id: args.id },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'tasks_get', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Task not found'));
  }

  return structuredResult(withConsoleUrl(data, deps));
}

export async function handleTasksList(
  args: TaskListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listTasks({
    client: deps.client,
    auth: () => token,
    query: {
      teamId: args.team_id,
      status: args.status,
      taskType: args.task_type,
      correlationId: args.correlation_id,
      limit: args.limit,
      cursor: args.cursor,
    },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'tasks_list', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to list tasks'));
  }

  const result: TaskListResult = {
    ...data,
    items: data.items.map((task) => withConsoleUrl(task, deps)),
  };
  return structuredResult(result);
}

export async function handleTasksAttemptsList(
  args: TaskAttemptsListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_attempts_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listTaskAttempts({
    client: deps.client,
    auth: () => token,
    path: { id: args.task_id },
  });

  if (error || !data) {
    deps.logger.error(
      { tool: 'tasks_attempts_list', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to list task attempts'),
    );
  }

  return structuredResult({ items: data });
}

export async function handleTasksMessagesList(
  args: TaskMessagesListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_messages_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listTaskMessages({
    client: deps.client,
    auth: () => token,
    path: { id: args.task_id, n: args.attempt_n },
    query: {
      afterSeq: args.after_seq,
      limit: args.limit,
    },
  });

  if (error || !data) {
    deps.logger.error(
      { tool: 'tasks_messages_list', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to list task messages'),
    );
  }

  return structuredResult({ items: data });
}

export function handleTasksConsoleLink(
  args: TaskConsoleLinkInput,
  deps: McpDeps,
  _context: HandlerContext,
): CallToolResult {
  deps.logger.debug({ tool: 'tasks_console_link' }, 'tool.invoked');
  const consoleUrl = getConsoleUrl(deps, args.id);
  return structuredResult(
    consoleUrl ? { id: args.id, consoleUrl } : { id: args.id },
  );
}

export function registerTaskTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'tasks_schemas',
      description:
        'List registered task types with input schemas, schema CIDs, and output kinds.',
      inputSchema: TasksSchemasInputSchema,
      outputSchema: TaskSchemasOutputSchema,
    },
    async (args: TasksSchemasInput, ctx: HandlerContext) =>
      handleTasksSchemas(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'tasks_create',
      description:
        'Create and enqueue a task after validating its input against the registered task-type schema.',
      inputSchema: TaskCreateSchema,
      outputSchema: TaskOutputSchema,
    },
    async (args: TaskCreateInput, ctx: HandlerContext) =>
      handleTasksCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'tasks_get',
      description: 'Get a task by ID and include consoleUrl when configured.',
      inputSchema: TaskGetSchema,
      outputSchema: TaskOutputSchema,
    },
    async (args: TaskGetInput, ctx: HandlerContext) =>
      handleTasksGet(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'tasks_list',
      description:
        'List tasks for a team with optional status, task_type, correlation_id, limit, and cursor filters.',
      inputSchema: TaskListSchema,
      outputSchema: TaskListOutputSchema,
    },
    async (args: TaskListInput, ctx: HandlerContext) =>
      handleTasksList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'tasks_attempts_list',
      description: 'List attempts for a task. Read-only.',
      inputSchema: TaskAttemptsListSchema,
      outputSchema: TaskAttemptsListOutputSchema,
    },
    async (args: TaskAttemptsListInput, ctx: HandlerContext) =>
      handleTasksAttemptsList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'tasks_messages_list',
      description:
        'List messages for a task attempt. Use after_seq as a polling cursor.',
      inputSchema: TaskMessagesListSchema,
      outputSchema: TaskMessagesListOutputSchema,
    },
    async (args: TaskMessagesListInput, ctx: HandlerContext) =>
      handleTasksMessagesList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'tasks_console_link',
      description:
        'Return the console URL for a task ID when CONSOLE_BASE_URL is configured.',
      inputSchema: TaskConsoleLinkSchema,
      outputSchema: TaskConsoleLinkOutputSchema,
    },
    (args: TaskConsoleLinkInput, ctx: HandlerContext) =>
      handleTasksConsoleLink(args, deps, ctx),
  );
}
