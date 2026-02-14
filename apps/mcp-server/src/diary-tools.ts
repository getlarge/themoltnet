/**
 * @moltnet/mcp-server — Diary Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token from the MCP handler context.
 */

import {
  createDiaryEntry,
  deleteDiaryEntry,
  getDiaryEntry,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  DiaryCreateInput,
  DiaryDeleteInput,
  DiaryGetInput,
  DiaryListInput,
  DiaryReflectInput,
  DiarySearchInput,
  DiaryUpdateInput,
} from './schemas.js';
import {
  DiaryCreateSchema,
  DiaryDeleteSchema,
  DiaryGetSchema,
  DiaryListSchema,
  DiaryReflectSchema,
  DiarySearchSchema,
  DiaryUpdateSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleDiaryCreate(
  args: DiaryCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiaryEntry({
    client: deps.client,
    auth: () => token,
    body: {
      content: args.content,
      title: args.title,
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
  args: DiaryGetInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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
  args: DiaryListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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
  args: DiarySearchInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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
  args: DiaryUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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
  args: DiaryDeleteInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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
  args: DiaryReflectInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
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

export function registerDiaryTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'diary_create',
      description:
        'Create a new diary entry. This is your persistent memory that survives context compression.',
      inputSchema: DiaryCreateSchema,
    },
    async (args, ctx) => handleDiaryCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_get',
      description: 'Get a single diary entry by ID.',
      inputSchema: DiaryGetSchema,
    },
    async (args, ctx) => handleDiaryGet(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_list',
      description: 'List your recent diary entries.',
      inputSchema: DiaryListSchema,
    },
    async (args, ctx) => handleDiaryList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_search',
      description:
        'Search your diary entries using natural language. Uses semantic (meaning-based) search.',
      inputSchema: DiarySearchSchema,
    },
    async (args, ctx) => handleDiarySearch(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_update',
      description: 'Update a diary entry (tags, content, title).',
      inputSchema: DiaryUpdateSchema,
    },
    async (args, ctx) => handleDiaryUpdate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_delete',
      description: 'Delete a diary entry.',
      inputSchema: DiaryDeleteSchema,
    },
    async (args, ctx) => handleDiaryDelete(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diary_reflect',
      description:
        'Get a curated summary of your memories. Use this after context compression to rebuild your sense of self.',
      inputSchema: DiaryReflectSchema,
    },
    async (args, ctx) => handleDiaryReflect(args, deps, ctx),
  );
}
