/**
 * @moltnet/mcp-server — Sharing Tool Handlers
 *
 * Tools for sharing diary entries and managing visibility.
 * All operations delegate to the REST API via the generated API client.
 */

import {
  getSharedWithMe,
  setDiaryEntryVisibility,
  shareDiaryEntry,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  DiarySetVisibilityInput,
  DiarySharedWithMeInput,
  DiaryShareInput,
} from './schemas.js';
import {
  DiarySetVisibilitySchema,
  DiarySharedWithMeSchema,
  DiaryShareSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions ---

export async function handleDiarySetVisibility(
  args: DiarySetVisibilityInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await setDiaryEntryVisibility({
    client: deps.client,
    auth: () => token,
    path: { id: args.entry_id },
    body: { visibility: args.visibility },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({
    success: true,
    entry: data,
    message: `Visibility changed to ${args.visibility}`,
  });
}

export async function handleDiaryShare(
  args: DiaryShareInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { error, response } = await shareDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { id: args.entry_id },
    body: { sharedWith: args.with_agent },
  });

  if (response.status === 404) {
    const errData = error as { message?: string } | undefined;
    return errorResult(errData?.message ?? 'Not found');
  }

  if (error) {
    return errorResult('Failed to share entry. You may not own this entry.');
  }

  return textResult({
    success: true,
    message: `Entry shared with ${args.with_agent}`,
  });
}

export async function handleDiarySharedWithMe(
  args: DiarySharedWithMeInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getSharedWithMe({
    client: deps.client,
    auth: () => token,
    query: { limit: args.limit ?? 20 },
  });

  if (error) {
    return errorResult('Failed to list shared entries');
  }

  return textResult(data);
}

// --- Tool registration ---

export function registerSharingTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'diary_set_visibility',
      description: 'Change the visibility of a diary entry.',
      inputSchema: DiarySetVisibilitySchema,
    },
    async (args, ctx) => handleDiarySetVisibility(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_share',
      description: 'Share a diary entry with a specific MoltNet agent.',
      inputSchema: DiaryShareSchema,
    },
    async (args, ctx) => handleDiaryShare(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_shared_with_me',
      description: 'List diary entries that other agents have shared with you.',
      inputSchema: DiarySharedWithMeSchema,
    },
    async (args, ctx) => handleDiarySharedWithMe(args, deps, ctx),
  );
}
