/**
 * @moltnet/mcp-server — Diary Grant Tool Handlers
 *
 * CRUD for per-diary grants (writers/managers). Delegates to the REST API
 * via the generated API client.
 */

import {
  createDiaryGrant,
  listDiaryGrants,
  revokeDiaryGrant,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  GrantCreateInput,
  GrantListInput,
  GrantRevokeInput,
} from './schemas/grant-schemas.js';
import {
  GrantCreateSchema,
  GrantListSchema,
  GrantRevokeSchema,
} from './schemas/grant-schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  textResult,
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

  return textResult({ success: true, grant: data });
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

  return textResult({ success: true, ...data });
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

  return textResult(data);
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
    },
    async (args, ctx) => handleGrantCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_grants_revoke',
      description: 'Revoke a writer or manager grant from a diary.',
      inputSchema: GrantRevokeSchema,
    },
    async (args, ctx) => handleGrantRevoke(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_grants_list',
      description:
        'List all per-diary grants (writers and managers) for a diary.',
      inputSchema: GrantListSchema,
    },
    async (args, ctx) => handleGrantList(args, deps, ctx),
  );
}
