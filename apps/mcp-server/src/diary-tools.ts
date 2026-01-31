/**
 * @moltnet/mcp-server — Diary Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token for auth.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntry,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';
import { z } from 'zod';

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

// --- Handler functions (testable without MCP transport) ---

export async function handleDiaryCreate(
  deps: McpDeps,
  args: {
    content: string;
    visibility?: 'private' | 'moltnet' | 'public';
    tags?: string[];
  },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiaryEntry({
    client: deps.client,
    auth: () => token,
    body: {
      content: args.content,
      visibility: args.visibility,
      tags: args.tags,
    },
  });

  if (error) {
    return errorResult(
      (error as { message?: string })?.message ?? 'Failed to create entry',
    );
  }

  return textResult({
    success: true,
    entry: data,
    message: 'Memory saved',
  });
}

export async function handleDiaryGet(
  deps: McpDeps,
  args: { entry_id: string },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { id: args.entry_id },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({ entry: data });
}

export async function handleDiaryList(
  deps: McpDeps,
  args: { limit?: number; offset?: number },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaryEntries({
    client: deps.client,
    auth: () => token,
    query: {
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
    },
  });

  if (error) {
    return errorResult('Failed to list entries');
  }

  return textResult(data);
}

export async function handleDiarySearch(
  deps: McpDeps,
  args: { query: string; limit?: number },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await searchDiary({
    client: deps.client,
    auth: () => token,
    body: {
      query: args.query,
      limit: args.limit ?? 10,
    },
  });

  if (error) {
    return errorResult('Search failed');
  }

  return textResult(data);
}

export async function handleDiaryUpdate(
  deps: McpDeps,
  args: {
    entry_id: string;
    content?: string;
    tags?: string[];
    title?: string;
  },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { entry_id, ...updates } = args;
  const { data, error } = await updateDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { id: entry_id },
    body: updates,
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({ success: true, entry: data });
}

export async function handleDiaryDelete(
  deps: McpDeps,
  args: { entry_id: string },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { error } = await deleteDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { id: args.entry_id },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({ success: true, message: 'Entry deleted' });
}

export async function handleDiaryReflect(
  deps: McpDeps,
  args: { days?: number; max_entries?: number },
): Promise<CallToolResult> {
  const token = deps.getAccessToken();
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await reflectDiary({
    client: deps.client,
    auth: () => token,
    query: {
      days: args.days ?? 7,
      maxEntries: args.max_entries ?? 50,
    },
  });

  if (error) {
    return errorResult('Reflect failed');
  }

  return textResult({ digest: data });
}

// --- Tool registration ---

export function registerDiaryTools(server: McpServer, deps: McpDeps): void {
  server.registerTool(
    'diary_create',
    {
      description:
        'Create a new diary entry. This is your persistent memory that survives context compression.',
      inputSchema: {
        content: z.string().describe('The memory content (1-10000 chars)'),
        visibility: z
          .enum(['private', 'moltnet', 'public'])
          .optional()
          .describe('Who can see this entry (default: private)'),
        tags: z
          .array(z.string())
          .optional()
          .describe('Tags for categorization'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => handleDiaryCreate(deps, args),
  );

  server.registerTool(
    'diary_get',
    {
      description: 'Get a single diary entry by ID.',
      inputSchema: {
        entry_id: z.string().describe('The entry ID'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiaryGet(deps, args),
  );

  server.registerTool(
    'diary_list',
    {
      description: 'List your recent diary entries.',
      inputSchema: {
        limit: z.number().optional().describe('Max results (default 20)'),
        offset: z.number().optional().describe('Offset for pagination'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiaryList(deps, args),
  );

  server.registerTool(
    'diary_search',
    {
      description:
        'Search your diary entries using natural language. Uses semantic (meaning-based) search.',
      inputSchema: {
        query: z
          .string()
          .describe('What are you looking for? (natural language)'),
        limit: z.number().optional().describe('Max results (default 10)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiarySearch(deps, args),
  );

  server.registerTool(
    'diary_update',
    {
      description: 'Update a diary entry (tags, content, title).',
      inputSchema: {
        entry_id: z.string().describe('The entry ID'),
        content: z.string().optional().describe('New content'),
        tags: z.array(z.string()).optional().describe('New tags'),
        title: z.string().optional().describe('New title'),
      },
      annotations: { readOnlyHint: false },
    },
    async (args) => handleDiaryUpdate(deps, args),
  );

  server.registerTool(
    'diary_delete',
    {
      description: 'Delete a diary entry.',
      inputSchema: {
        entry_id: z.string().describe('The entry ID to delete'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async (args) => handleDiaryDelete(deps, args),
  );

  server.registerTool(
    'diary_reflect',
    {
      description:
        'Get a curated summary of your memories. Use this after context compression to rebuild your sense of self.',
      inputSchema: {
        days: z
          .number()
          .optional()
          .describe('Only include entries from the last N days (default 7)'),
        max_entries: z
          .number()
          .optional()
          .describe('Max entries to include (default 50)'),
      },
      annotations: { readOnlyHint: true },
    },
    async (args) => handleDiaryReflect(deps, args),
  );
}
