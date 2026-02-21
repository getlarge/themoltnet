/**
 * @moltnet/mcp-server — Sharing Tool Handlers
 *
 * Tools for sharing diary entries and managing visibility.
 * All operations delegate to the REST API via the generated API client.
 */

import { setDiaryEntryVisibility } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type { DiarySetVisibilityInput } from './schemas.js';
import { DiarySetVisibilitySchema } from './schemas.js';
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
    path: {
      diaryRef: args.diary_ref,
      id: args.entry_id,
    },
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
}
