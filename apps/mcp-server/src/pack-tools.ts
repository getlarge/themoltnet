/**
 * @moltnet/mcp-server — Pack Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token from the MCP handler context.
 */

import {
  createDiaryCustomPack,
  getContextPackById,
  getContextPackProvenanceByCid,
  getContextPackProvenanceById,
  listDiaryPacks,
  previewDiaryCustomPack,
  previewRenderedPack,
  renderContextPack,
  updateContextPack,
  updateRenderedPack,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  PackCreateInput,
  PackGetInput,
  PackListInput,
  PackPreviewInput,
  PackProvenanceInput,
  PackRenderInput,
  PackRenderPreviewInput,
  PackUpdateInput,
  RenderedPackUpdateInput,
} from './schemas.js';
import {
  PackCreateSchema,
  PackGetSchema,
  PackListSchema,
  PackPreviewSchema,
  PackProvenanceSchema,
  PackRenderPreviewSchema,
  PackRenderSchema,
  PackUpdateSchema,
  RenderedPackUpdateSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  textResult,
} from './utils.js';

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
    return errorResult(extractApiErrorMessage(error, 'Pack not found'));
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
    return errorResult(extractApiErrorMessage(error, 'Failed to list packs'));
  }

  return textResult(data);
}

export async function handlePacksPreview(
  args: PackPreviewInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_preview' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await previewDiaryCustomPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
    body: {
      packType: 'custom',
      params: args.params,
      entries: args.entries.map(({ entry_id, rank }) => ({
        entryId: entry_id,
        rank,
      })),
      tokenBudget: args.token_budget,
      pinned: args.pinned,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_preview', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(error, 'Failed to preview custom pack'),
    );
  }

  return textResult(data);
}

export async function handlePacksCreate(
  args: PackCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiaryCustomPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
    body: {
      packType: 'custom',
      params: args.params,
      entries: args.entries.map(({ entry_id, rank }) => ({
        entryId: entry_id,
        rank,
      })),
      tokenBudget: args.token_budget,
      pinned: args.pinned,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_create', err: error }, 'tool.error');
    return errorResult(
      extractApiErrorMessage(error, 'Failed to create custom pack'),
    );
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

  const rawArgs = args as PackProvenanceInput & {
    packId?: unknown;
    packCid?: unknown;
  };
  const packIdValue = rawArgs.pack_id ?? rawArgs.packId;
  const packCidValue = rawArgs.pack_cid ?? rawArgs.packCid;
  const packId =
    typeof packIdValue === 'string' && packIdValue.trim() !== ''
      ? packIdValue
      : undefined;
  const packCid =
    typeof packCidValue === 'string' && packCidValue.trim() !== ''
      ? packCidValue
      : undefined;

  if (!packId && !packCid) {
    return errorResult('Exactly one of pack_id or pack_cid must be provided');
  }
  if (packId && packCid) {
    return errorResult('Exactly one of pack_id or pack_cid must be provided');
  }

  if (packId) {
    const { data, error } = await getContextPackProvenanceById({
      client: deps.client,
      auth: () => token,
      path: { id: packId },
      query: {
        ...(args.depth !== undefined && { depth: args.depth }),
      },
    });

    if (error) {
      deps.logger.error({ tool: 'packs_provenance', err: error }, 'tool.error');
      return errorResult(extractApiErrorMessage(error, 'Pack not found'));
    }

    return textResult(data);
  }

  // pack_cid branch (args.pack_cid is guaranteed to be defined here)
  const { data, error } = await getContextPackProvenanceByCid({
    client: deps.client,
    auth: () => token,
    path: { cid: packCid as string },
    query: {
      ...(args.depth !== undefined && { depth: args.depth }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_provenance', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Pack not found'));
  }

  return textResult(data);
}

export async function handlePacksUpdate(
  args: PackUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_update' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await updateContextPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.pack_id },
    body: {
      ...(args.pinned !== undefined && { pinned: args.pinned }),
      ...(args.expires_at !== undefined && { expiresAt: args.expires_at }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_update', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to update pack'));
  }

  return textResult({ pack: data });
}

export async function handleRenderedPacksUpdate(
  args: RenderedPackUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_update_rendered' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await updateRenderedPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.rendered_pack_id },
    body: {
      ...(args.pinned !== undefined && { pinned: args.pinned }),
      ...(args.expires_at !== undefined && { expiresAt: args.expires_at }),
    },
  });

  if (error) {
    deps.logger.error(
      { tool: 'packs_update_rendered', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to update rendered pack'),
    );
  }

  return textResult({ renderedPack: data });
}

export async function handlePacksRender(
  args: PackRenderInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_render' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await renderContextPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.pack_id },
    body: {
      ...(args.rendered_markdown !== undefined && {
        renderedMarkdown: args.rendered_markdown,
      }),
      renderMethod: args.render_method,
      pinned: args.pinned,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'packs_render', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to render pack'));
  }

  return textResult(data);
}

export async function handlePacksRenderPreview(
  args: PackRenderPreviewInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'packs_render_preview' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await previewRenderedPack({
    client: deps.client,
    auth: () => token,
    path: { id: args.pack_id },
    body: {
      ...(args.rendered_markdown !== undefined && {
        renderedMarkdown: args.rendered_markdown,
      }),
      renderMethod: args.render_method,
    },
  });

  if (error) {
    deps.logger.error(
      { tool: 'packs_render_preview', err: error },
      'tool.error',
    );
    return errorResult(
      extractApiErrorMessage(error, 'Failed to preview rendered pack'),
    );
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
      name: 'packs_preview',
      description:
        'Preview a custom context pack from an explicit entry selection without persisting it.',
      inputSchema: PackPreviewSchema,
    },
    async (args, ctx) => handlePacksPreview(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_create',
      description:
        'Create and persist a custom context pack from an explicit entry selection.',
      inputSchema: PackCreateSchema,
    },
    async (args, ctx) => handlePacksCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_update',
      description:
        'Update a context pack — pin/unpin or change expiration date. ' +
        'Pin a pack to protect it from garbage collection. ' +
        'When unpinning, expires_at is required.',
      inputSchema: PackUpdateSchema,
    },
    async (args, ctx) => handlePacksUpdate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_update_rendered',
      description:
        'Update a rendered pack — pin/unpin or change expiration date. ' +
        'Pin a rendered pack to protect it from garbage collection. ' +
        'When unpinning, expires_at is required.',
      inputSchema: RenderedPackUpdateSchema,
    },
    async (args, ctx) => handleRenderedPacksUpdate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_render_preview',
      description:
        'Preview a rendered pack from a source context pack without persisting it.',
      inputSchema: PackRenderPreviewSchema,
    },
    async (args, ctx) => handlePacksRenderPreview(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'packs_render',
      description:
        'Render a source context pack to structured markdown and persist it as a new CID-addressed rendered pack.',
      inputSchema: PackRenderSchema,
    },
    async (args, ctx) => handlePacksRender(args, deps, ctx),
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
