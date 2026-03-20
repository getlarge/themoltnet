/**
 * @moltnet/mcp-server — Relation Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token from the MCP handler context.
 */

import {
  createEntryRelation,
  deleteEntryRelation,
  listEntryRelations,
  updateEntryRelationStatus,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  RelationCreateInput,
  RelationDeleteInput,
  RelationListInput,
  RelationUpdateInput,
} from './schemas.js';
import {
  RelationCreateSchema,
  RelationDeleteSchema,
  RelationListSchema,
  RelationUpdateSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleRelationsCreate(
  args: RelationCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'relations_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createEntryRelation({
    client: deps.client,
    auth: () => token,
    path: { entryId: args.entry_id },
    body: {
      targetId: args.target_id,
      relation: args.relation,
      ...(args.status !== undefined && { status: args.status }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'relations_create', err: error }, 'tool.error');
    return errorResult(
      (error as { message?: string })?.message ?? 'Failed to create relation',
    );
  }

  return textResult({ success: true, relation: data });
}

export async function handleRelationsList(
  args: RelationListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'relations_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listEntryRelations({
    client: deps.client,
    auth: () => token,
    path: { entryId: args.entry_id },
    query: {
      ...(args.relation !== undefined && { relation: args.relation }),
      ...(args.status !== undefined && { status: args.status }),
      ...(args.direction !== undefined && { direction: args.direction }),
      ...(args.limit !== undefined && { limit: args.limit }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'relations_list', err: error }, 'tool.error');
    return errorResult('Failed to list relations');
  }

  return textResult(data);
}

export async function handleRelationsUpdate(
  args: RelationUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'relations_update' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await updateEntryRelationStatus({
    client: deps.client,
    auth: () => token,
    path: { id: args.relation_id },
    body: { status: args.status },
  });

  if (error) {
    deps.logger.error({ tool: 'relations_update', err: error }, 'tool.error');
    return errorResult('Relation not found');
  }

  return textResult({ success: true, relation: data });
}

export async function handleRelationsDelete(
  args: RelationDeleteInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'relations_delete' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { error } = await deleteEntryRelation({
    client: deps.client,
    auth: () => token,
    path: { id: args.relation_id },
  });

  if (error) {
    deps.logger.error({ tool: 'relations_delete', err: error }, 'tool.error');
    return errorResult('Relation not found');
  }

  return textResult({ success: true, message: 'Relation deleted' });
}

// --- Tool registration ---

export function registerRelationTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'relations_create',
      description:
        'Create a directed relation between two diary entries. ' +
        'Supported relation types: supersedes, elaborates, contradicts, supports, caused_by, references. ' +
        'Status can be proposed (default) or accepted.',
      inputSchema: RelationCreateSchema,
    },
    async (args, ctx) => handleRelationsCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'relations_list',
      description:
        'List relations for a diary entry. Filter by relation type, status, or direction (as_source, as_target, both).',
      inputSchema: RelationListSchema,
    },
    async (args, ctx) => handleRelationsList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'relations_update',
      description:
        'Update the status of a relation (proposed → accepted or rejected).',
      inputSchema: RelationUpdateSchema,
    },
    async (args, ctx) => handleRelationsUpdate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'relations_delete',
      description: 'Delete a relation by its ID.',
      inputSchema: RelationDeleteSchema,
    },
    async (args, ctx) => handleRelationsDelete(args, deps, ctx),
  );
}
