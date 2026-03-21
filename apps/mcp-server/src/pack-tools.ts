/**
 * @moltnet/mcp-server — Pack Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token from the MCP handler context.
 */

import {
  getContextPackById,
  getContextPackProvenanceByCid,
  getContextPackProvenanceById,
  listDiaryPacks,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  PackGetInput,
  PackListInput,
  PackProvenanceInput,
} from './schemas.js';
import {
  PackGetSchema,
  PackListSchema,
  PackProvenanceSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handlePacksGet(
  args: PackGetInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_get' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getContextPackById({
    client: deps.client,
    auth: () => token,
    path: { id: args.pack_id },
    query: {
      ...(args.expand !== undefined && { expand: args.expand }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_get', err: error }, 'tool.error');
    return errorResult('Pack not found');
  }

  return textResult({ pack: data });
}

export async function handlePacksList(
  args: PackListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaryPacks({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
    query: {
      ...(args.limit !== undefined && { limit: args.limit }),
      ...(args.expand !== undefined && { expand: args.expand }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_list', err: error }, 'tool.error');
    return errorResult('Failed to list packs');
  }

  return textResult(data);
}

export async function handlePacksProvenance(
  args: PackProvenanceInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_provenance' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  if (!args.pack_id && !args.pack_cid) {
    return errorResult('Exactly one of pack_id or pack_cid must be provided');
  }
  if (args.pack_id && args.pack_cid) {
    return errorResult('Exactly one of pack_id or pack_cid must be provided');
  }

  if (args.pack_id) {
    const { data, error } = await getContextPackProvenanceById({
      client: deps.client,
      auth: () => token,
      path: { id: args.pack_id },
      query: {
        ...(args.depth !== undefined && { depth: args.depth }),
      },
    });

    if (error) {
      deps.logger.error({ tool: 'packs_provenance', err: error }, 'tool.error');
      return errorResult('Pack not found');
    }

    return textResult(data);
  }

  // pack_cid branch (args.pack_cid is guaranteed to be defined here)
  const { data, error } = await getContextPackProvenanceByCid({
    client: deps.client,
    auth: () => token,
    path: { cid: args.pack_cid as string },
    query: {
      ...(args.depth !== undefined && { depth: args.depth }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_provenance', err: error }, 'tool.error');
    return errorResult('Pack not found');
  }

  return textResult(data);
}

// --- Tool registration ---

export function registerPackTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'packs_get',
      description:
        'Get a context pack by ID. Pass expand=entries to include the full entry list.',
      inputSchema: PackGetSchema,
    },
    async (args, ctx) => handlePacksGet(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_list',
      description: 'List context packs for a diary.',
      inputSchema: PackListSchema,
    },
    async (args, ctx) => handlePacksList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_provenance',
      description:
        'Get the provenance graph for a context pack. Provide exactly one of pack_id (UUID) or pack_cid (CID string). ' +
        'Use depth to control how many ancestor layers to traverse (default 1).',
      inputSchema: PackProvenanceSchema,
    },
    async (args, ctx) => handlePacksProvenance(args, deps, ctx),
  );
}
