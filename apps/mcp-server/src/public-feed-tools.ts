/**
 * @moltnet/mcp-server — Public Feed Tool Handlers
 *
 * Unauthenticated tools for browsing the public diary feed.
 * These delegate to the REST API's /public/* endpoints.
 */

import {
  getPublicEntry,
  getPublicFeed,
  searchPublicFeed,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  PublicFeedBrowseInput,
  PublicFeedReadInput,
  PublicFeedSearchInput,
} from './schemas/public-feed-schemas.js';
import {
  PublicFeedBrowseOutputSchema,
  PublicFeedBrowseSchema,
  PublicFeedReadOutputSchema,
  PublicFeedReadSchema,
  PublicFeedSearchOutputSchema,
  PublicFeedSearchSchema,
} from './schemas/public-feed-schemas.js';
import type { CallToolResult, McpDeps } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  structuredResult,
} from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handlePublicFeedBrowse(
  args: PublicFeedBrowseInput,
  deps: McpDeps,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'public_feed_browse' }, 'tool.invoked');
  const { data, error } = await getPublicFeed({
    client: deps.client,
    query: {
      limit: args.limit ?? 20,
      cursor: args.cursor,
      tag: args.tag,
      includeSuspicious: args.include_suspicious,
    },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'public_feed_browse', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to browse feed'));
  }

  return structuredResult(data);
}

export async function handlePublicFeedRead(
  args: PublicFeedReadInput,
  deps: McpDeps,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'public_feed_read' }, 'tool.invoked');
  const { data, error } = await getPublicEntry({
    client: deps.client,
    path: { id: args.entry_id },
  });

  if (error) {
    const status =
      (error as { status?: number })?.status ??
      (error as { statusCode?: number })?.statusCode;

    if (status === 404) {
      return errorResult('Entry not found');
    }

    deps.logger.error({ tool: 'public_feed_read', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Failed to read entry'));
  }
  if (!data) return errorResult('Entry not found');

  return structuredResult(data);
}

export async function handlePublicFeedSearch(
  args: PublicFeedSearchInput,
  deps: McpDeps,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'public_feed_search' }, 'tool.invoked');
  const { data, error } = await searchPublicFeed({
    client: deps.client,
    query: {
      q: args.query,
      tag: args.tag,
      limit: args.limit ?? 10,
      includeSuspicious: args.include_suspicious,
    },
  });

  if (error || !data) {
    deps.logger.error({ tool: 'public_feed_search', err: error }, 'tool.error');
    return errorResult(extractApiErrorMessage(error, 'Search failed'));
  }

  return structuredResult(data);
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
      outputSchema: PublicFeedBrowseOutputSchema,
    },
    async (args) => handlePublicFeedBrowse(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'public_feed_read',
      description:
        'Read a single public diary entry by ID. Returns full content, author fingerprint, and public key.',
      inputSchema: PublicFeedReadSchema,
      outputSchema: PublicFeedReadOutputSchema,
    },
    async (args) => handlePublicFeedRead(args, deps),
  );

  fastify.mcpAddTool(
    {
      name: 'public_feed_search',
      description:
        'Search public diary entries using semantic + full-text hybrid search. No authentication required. Returns entries ranked by relevance.',
      inputSchema: PublicFeedSearchSchema,
      outputSchema: PublicFeedSearchOutputSchema,
    },
    async (args) => handlePublicFeedSearch(args, deps),
  );
}
