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
  TaskContinueInput,
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
  TaskContinueSchema,
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
    references: args.references,
  });
  if (validationErrors.length > 0) {
    return structuredErrorResult(formatValidationErrors(validationErrors));
  }

  const { data, error } = await createTask({
    client: deps.client,
    auth: () => token,
    headers: { 'x-moltnet-team-id': args.team_id },
    body: {
      taskType: args.task_type,
      diaryId: args.diary_id,
      input: args.input,
      references: args.references,
      allowedProfiles: args.allowed_profiles,
      correlationId: args.correlation_id,
      maxAttempts: args.max_attempts,
      expiresInSec: args.expires_in_sec,
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

export async function handleTasksContinue(
  args: TaskContinueInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'tasks_continue' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  // 1. Read source via existing api-client. We need teamId / diaryId /
  //    correlationId / allowedProfiles / requiredExecutorTrustLevel to
  //    construct a coherent CreateTaskRequest; the server-side async
  //    validator handles the deeper preconditions (source taskType,
  //    attempt status, slotResumableUntil) on the POST /tasks call.
  const { data: source, error: getErr } = await getTask({
    client: deps.client,
    auth: () => token,
    path: { id: args.fromTaskId },
  });
  if (getErr || !source) {
    deps.logger.error(
      { tool: 'tasks_continue', err: getErr },
      'tool.error.source_task_not_found',
    );
    return errorResult(
      extractApiErrorMessage(
        getErr,
        `Source task ${args.fromTaskId} not found`,
      ),
    );
  }

  if (source.teamId === null || source.diaryId === null) {
    return errorResult(
      `Source task ${args.fromTaskId} is missing teamId/diaryId and cannot be continued`,
    );
  }

  // 2. Construct the freeform continuation input. Only forward optional
  //    overrides that the caller actually set so the server-side
  //    defaults still apply.
  const freeformInput: Record<string, unknown> = {
    brief: args.brief,
    continueFrom: {
      taskId: args.fromTaskId,
      attemptN: args.fromAttemptN,
      ...(args.mode ? { mode: args.mode } : {}),
    },
  };
  if (args.title) freeformInput.title = args.title;
  if (args.expectedOutput) freeformInput.expectedOutput = args.expectedOutput;
  if (args.constraints?.length) freeformInput.constraints = args.constraints;
  // execution.workspace deliberately not forwarded: continuations inherit
  // workspace mode from the parent slot. The server-side async validator
  // rejects execution.workspace when continueFrom is set.
  if (args.successCriteria)
    freeformInput.successCriteria = args.successCriteria;

  // 3. Sync validation. The async server-side preflight handles the
  //    source-attempt eligibility checks; here we just catch shape errors
  //    early so we don't burn a REST round-trip.
  const validationErrors = validateTaskCreateRequest({
    taskType: 'freeform',
    input: freeformInput,
  });
  if (validationErrors.length > 0) {
    return structuredErrorResult(formatValidationErrors(validationErrors));
  }

  // 4. Delegate to standard create. The auto-injected `task_status:
  //    completed` claim condition on the parent closes the race between
  //    reading source state at T0 and the server persisting the create
  //    at T1 — claim conditions are re-evaluated at every daemon poll.
  const { data, error } = await createTask({
    client: deps.client,
    auth: () => token,
    headers: { 'x-moltnet-team-id': source.teamId },
    body: {
      taskType: 'freeform',
      diaryId: source.diaryId,
      input: freeformInput,
      ...(source.correlationId ? { correlationId: source.correlationId } : {}),
      ...(source.allowedProfiles?.length
        ? { allowedProfiles: source.allowedProfiles }
        : {}),
      ...(source.requiredExecutorTrustLevel
        ? { requiredExecutorTrustLevel: source.requiredExecutorTrustLevel }
        : {}),
      claimCondition: {
        op: 'task_status',
        taskId: args.fromTaskId,
        statuses: ['completed'],
      },
    },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'tasks_continue', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(error, 'Failed to create continuation task'),
    );
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
    headers: { 'x-moltnet-team-id': args.team_id },
    query: {
      status: args.status,
      taskTypes: args.task_type ? [args.task_type] : undefined,
      correlationId: args.correlation_id,
      diaryId: args.diary_id,
      proposedByAgentId: args.proposed_by_agent_id,
      proposedByHumanId: args.proposed_by_human_id,
      claimedByAgentId: args.claimed_by_agent_id,
      hasAttempts: args.has_attempts,
      queuedAfter: args.queued_after,
      queuedBefore: args.queued_before,
      completedAfter: args.completed_after,
      completedBefore: args.completed_before,
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
      name: 'tasks_continue',
      description:
        'Create a freeform continuation of a prior freeform attempt with warm Pi-session resume. Reads the source task, builds a freeform CreateTaskRequest with input.continueFrom plus an auto-injected task_status:completed claim condition, then delegates to tasks_create. No new server endpoint — see issue #1287.',
      inputSchema: TaskContinueSchema,
      outputSchema: TaskOutputSchema,
    },
    async (args: TaskContinueInput, ctx: HandlerContext) =>
      handleTasksContinue(args, deps, ctx),
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
        'List tasks for a team with optional status, task_type, correlation_id, diary_id, requester, worker, attempts, date-window, limit, and cursor filters.',
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
