/**
 * @moltnet/mcp-server — Diary Grant Tool Handlers
 *
 * CRUD for per-diary grants (writers/managers). Delegates to the REST API
 * via the generated API client.
 */

import {
  createDiaryGrant,
  createTaskGrant,
  listDiaryGrants,
  listTaskGrants,
  revokeDiaryGrant,
  revokeTaskGrant,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  GrantCreateInput,
  GrantListInput,
  GrantRevokeInput,
  TaskGrantCreateInput,
  TaskGrantListInput,
  TaskGrantRevokeInput,
} from './schemas/grant-schemas.js';
import {
  GrantCreateOutputSchema,
  GrantCreateSchema,
  GrantListOutputSchema,
  GrantListSchema,
  GrantRevokeOutputSchema,
  GrantRevokeSchema,
  TaskGrantCreateSchema,
  TaskGrantListSchema,
  TaskGrantRevokeSchema,
} from './schemas/grant-schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  structuredResult,
} from './utils.js';

// --- Handler functions ---

export async function handleGrantCreate(
  args: GrantCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diary_grants_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiaryGrant({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
    body: {
      subjectId: args.subject_id,
      subjectNs: args.subject_ns,
      role: args.role,
    },
  });

  if (error) {
    deps.logger.error(
      { tool: 'diary_grants_create', err: error },
      'tool.error',
    );
    return errorResult(extractApiErrorMessage(error, 'Failed to create grant'));
  }
  if (!data) return errorResult('Failed to create grant');

  return structuredResult(data);
}

export async function handleGrantRevoke(
  args: GrantRevokeInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diary_grants_revoke' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await revokeDiaryGrant({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
    body: {
      subjectId: args.subject_id,
      subjectNs: args.subject_ns,
      role: args.role,
    },
  });

  if (error) {
    deps.logger.error(
      { tool: 'diary_grants_revoke', err: error },
      'tool.error',
    );
    return errorResult(extractApiErrorMessage(error, 'Failed to revoke grant'));
  }
  if (!data) return errorResult('Failed to revoke grant');

  return structuredResult(data);
}

export async function handleGrantList(
  args: GrantListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diary_grants_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaryGrants({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
  });

  if (error) {
    deps.logger.error({ tool: 'diary_grants_list', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to list grants'));
  }
  if (!data) return errorResult('Failed to list grants');

  return structuredResult(data);
}

export async function handleTaskGrantCreate(
  args: TaskGrantCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');
  const { data, error } = await createTaskGrant({
    client: deps.client,
    auth: () => token,
    path: { id: args.task_id },
    headers: { 'x-moltnet-team-id': args.team_id },
    body: {
      subjectId: args.subject_id,
      subjectNs: args.subject_ns,
      role: args.role,
    },
  });
  if (error)
    return errorResult(
      extractApiErrorMessage(error, 'Failed to create task grant'),
    );
  return data ? structuredResult(data) : errorResult('Failed to create grant');
}

export async function handleTaskGrantRevoke(
  args: TaskGrantRevokeInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');
  const { data, error } = await revokeTaskGrant({
    client: deps.client,
    auth: () => token,
    path: { id: args.task_id },
    headers: { 'x-moltnet-team-id': args.team_id },
    body: {
      subjectId: args.subject_id,
      subjectNs: args.subject_ns,
      role: args.role,
    },
  });
  if (error)
    return errorResult(
      extractApiErrorMessage(error, 'Failed to revoke task grant'),
    );
  return data ? structuredResult(data) : errorResult('Failed to revoke grant');
}

export async function handleTaskGrantList(
  args: TaskGrantListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');
  const { data, error } = await listTaskGrants({
    client: deps.client,
    auth: () => token,
    path: { id: args.task_id },
    headers: { 'x-moltnet-team-id': args.team_id },
  });
  if (error)
    return errorResult(
      extractApiErrorMessage(error, 'Failed to list task grants'),
    );
  return data ? structuredResult(data) : errorResult('Failed to list grants');
}

// --- Tool registration ---

export function registerGrantTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'diary_grants_create',
      description:
        'Grant writer or manager access to a diary for an agent, human, or group.',
      inputSchema: GrantCreateSchema,
      outputSchema: GrantCreateOutputSchema,
    },
    async (args, ctx) => handleGrantCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_grants_revoke',
      description: 'Revoke a writer or manager grant from a diary.',
      inputSchema: GrantRevokeSchema,
      outputSchema: GrantRevokeOutputSchema,
    },
    async (args, ctx) => handleGrantRevoke(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_grants_list',
      description:
        'List all per-diary grants (writers and managers) for a diary.',
      inputSchema: GrantListSchema,
      outputSchema: GrantListOutputSchema,
    },
    async (args, ctx) => handleGrantList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'task_grants_create',
      description:
        'Grant writer or manager access to a task for an agent, human, or group.',
      inputSchema: TaskGrantCreateSchema,
      outputSchema: GrantCreateOutputSchema,
    },
    async (args, ctx) => handleTaskGrantCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'task_grants_revoke',
      description: 'Revoke a writer or manager grant from a task.',
      inputSchema: TaskGrantRevokeSchema,
      outputSchema: GrantRevokeOutputSchema,
    },
    async (args, ctx) => handleTaskGrantRevoke(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'task_grants_list',
      description: 'List explicit writer and manager grants for a task.',
      inputSchema: TaskGrantListSchema,
      outputSchema: GrantListOutputSchema,
    },
    async (args, ctx) => handleTaskGrantList(args, deps, ctx),
  );
}
