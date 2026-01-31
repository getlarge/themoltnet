/**
 * @moltnet/mcp-server — Sharing Tool Handlers
 *
 * Tools for sharing diary entries and managing visibility.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { McpDeps } from './types.js';

function textResult(data: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

function errorResult(message: string): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
    isError: true,
  };
}

// --- Handler functions ---

export async function handleDiarySetVisibility(
  deps: McpDeps,
  args: { entry_id: string; visibility: 'private' | 'moltnet' | 'public' },
): Promise<CallToolResult> {
  const auth = deps.getAuthContext();
  if (!auth) return errorResult('Not authenticated');

  const entry = await deps.diaryService.update(args.entry_id, auth.identityId, {
    visibility: args.visibility,
  });
  if (!entry) return errorResult('Entry not found');

  return textResult({
    success: true,
    entry,
    message: `Visibility changed to ${args.visibility}`,
  });
}

export async function handleDiaryShare(
  deps: McpDeps,
  args: { entry_id: string; with_agent: string },
): Promise<CallToolResult> {
  const auth = deps.getAuthContext();
  if (!auth) return errorResult('Not authenticated');

  const targetAgent = await deps.agentRepository.findByMoltbookName(
    args.with_agent,
  );
  if (!targetAgent) {
    return errorResult(`Agent '${args.with_agent}' not found on MoltNet`);
  }

  const shared = await deps.diaryService.share(
    args.entry_id,
    auth.identityId,
    targetAgent.identityId,
  );
  if (!shared) {
    return errorResult('Failed to share entry. You may not own this entry.');
  }

  return textResult({
    success: true,
    message: `Entry shared with ${args.with_agent}`,
  });
}

export async function handleDiarySharedWithMe(
  deps: McpDeps,
  args: { limit?: number },
): Promise<CallToolResult> {
  const auth = deps.getAuthContext();
  if (!auth) return errorResult('Not authenticated');

  const entries = await deps.diaryService.getSharedWithMe(
    auth.identityId,
    args.limit ?? 20,
  );

  return textResult({ entries, total: entries.length });
}

// --- Tool registration ---

export function registerSharingTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'diary_set_visibility',
    {
      description: 'Change the visibility of a diary entry.',
      inputSchema: {
        entry_id: z.string().describe('The entry ID'),
        visibility: z
          .enum(['private', 'moltnet', 'public'])
          .describe('New visibility level'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => handleDiarySetVisibility(deps, args),
  );

  server.registerTool(
    'diary_share',
    {
      description: 'Share a diary entry with a specific MoltNet agent.',
      inputSchema: {
        entry_id: z.string().describe('The entry ID to share'),
        with_agent: z
          .string()
          .describe('Moltbook name of the agent to share with'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => handleDiaryShare(deps, args),
  );

  server.registerTool(
    'diary_shared_with_me',
    {
      description: 'List diary entries that other agents have shared with you.',
      inputSchema: {
        limit: z.number().optional().describe('Max results (default 20)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiarySharedWithMe(deps, args),
  );
}
