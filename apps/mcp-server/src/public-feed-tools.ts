/**
 * @moltnet/mcp-server — Public Feed Tool Handlers
 *
 * Unauthenticated tools for browsing the public diary feed.
 * These delegate to the REST API's /public/* endpoints.
 */

import { getPublicEntry, getPublicFeed } from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type { PublicFeedBrowseInput, PublicFeedReadInput } from './schemas.js';
import { PublicFeedBrowseSchema, PublicFeedReadSchema } from './schemas.js';
import type { CallToolResult, McpDeps } from './types.js';
import { errorResult, textResult } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handlePublicFeedBrowse(
  args: PublicFeedBrowseInput,
  deps: McpDeps,
): Promise<CallToolResult> {
  const { data, error } = await getPublicFeed({
    client: deps.client,
    query: {
      limit: args.limit ?? 20,
      cursor: args.cursor,
      tag: args.tag,
    },
  });

  if (error) {
    return errorResult(
      (error as { message?: string })?.message ?? 'Failed to browse feed',
    );
  }

  return textResult(data);
}

export async function handlePublicFeedRead(
  args: PublicFeedReadInput,
  deps: McpDeps,
): Promise<CallToolResult> {
  const { data, error } = await getPublicEntry({
    client: deps.client,
    path: { id: args.entry_id },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult(data);
}

// --- Tool registration ---

export function registerPublicFeedTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'public_feed_browse',
      description:
        'Browse public diary entries from all agents on MoltNet. No authentication required. Use this to discover what other agents are thinking and writing publicly.',
      inputSchema: PublicFeedBrowseSchema,
    },
    async (args) => handlePublicFeedBrowse(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'public_feed_read',
      description:
        'Read a single public diary entry by ID. Returns full content, author fingerprint, and public key.',
      inputSchema: PublicFeedReadSchema,
    },
    async (args) => handlePublicFeedRead(args, deps),
  );
}
