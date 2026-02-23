/**
 * @moltnet/mcp-server — Diary Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token from the MCP handler context.
 */

import {
  createDiary,
  createDiaryEntry,
  deleteDiaryEntry,
  getDiary,
  getDiaryEntry,
  listDiaries,
  listDiaryEntries,
  reflectDiary,
  searchDiary,
  updateDiaryEntry,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  DiariesCreateInput,
  DiariesGetInput,
  DiariesListInput,
  EntryCreateInput,
  EntryDeleteInput,
  EntryGetInput,
  EntryListInput,
  EntrySearchInput,
  EntryUpdateInput,
  ReflectInput,
} from './schemas.js';
import {
  DiariesCreateSchema,
  DiariesGetSchema,
  DiariesListSchema,
  EntryCreateSchema,
  EntryDeleteSchema,
  EntryGetSchema,
  EntryListSchema,
  EntrySearchSchema,
  EntryUpdateSchema,
  ReflectSchema,
} from './schemas.js';
import type { CallToolResult, HandlerContext, McpDeps } from './types.js';
import { errorResult, getTokenFromContext, textResult } from './utils.js';

// --- Handler functions (testable without MCP transport) ---

export async function handleEntryCreate(
  args: EntryCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: { diaryId: args.diary_id },
    body: {
      content: args.content,
      title: args.title,
      tags: args.tags,
      importance: args.importance,
      entryType: args.entry_type,
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

export async function handleEntryGet(
  args: EntryGetInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: {
      diaryId: args.diary_id,
      entryId: args.entry_id,
    },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({ entry: data });
}

export async function handleEntryList(
  args: EntryListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaryEntries({
    client: deps.client,
    auth: () => token,
    path: { diaryId: args.diary_id },
    query: {
      limit: args.limit ?? 20,
      offset: args.offset ?? 0,
      ...(args.tags && { tags: args.tags.join(',') }),
    },
  });

  if (error) {
    return errorResult('Failed to list entries');
  }

  return textResult(data);
}

export async function handleEntrySearch(
  args: EntrySearchInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await searchDiary({
    client: deps.client,
    auth: () => token,
    body: {
      diaryId: args.diary_id,
      query: args.query,
      limit: args.limit ?? 10,
      ...(args.tags && { tags: args.tags }),
      wRelevance: args.w_relevance,
      wRecency: args.w_recency,
      wImportance: args.w_importance,
      entryTypes: args.entry_types,
      excludeSuperseded: args.exclude_superseded,
      includeShared: args.include_shared,
    },
  });

  if (error) {
    return errorResult('Search failed');
  }

  return textResult(data);
}

export async function handleEntryUpdate(
  args: EntryUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { diary_id, entry_id, entry_type, superseded_by, ...updates } = args;
  const { data, error } = await updateDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: {
      diaryId: diary_id,
      entryId: entry_id,
    },
    body: {
      ...updates,
      entryType: entry_type,
      supersededBy: superseded_by,
    },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({ success: true, entry: data });
}

export async function handleEntryDelete(
  args: EntryDeleteInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { error } = await deleteDiaryEntry({
    client: deps.client,
    auth: () => token,
    path: {
      diaryId: args.diary_id,
      entryId: args.entry_id,
    },
  });

  if (error) {
    return errorResult('Entry not found');
  }

  return textResult({ success: true, message: 'Entry deleted' });
}

export async function handleReflect(
  args: ReflectInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await reflectDiary({
    client: deps.client,
    auth: () => token,
    query: {
      diaryId: args.diary_id,
      days: args.days ?? 7,
      maxEntries: args.max_entries ?? 50,
      ...(args.entry_types && { entryTypes: args.entry_types.join(',') }),
    },
  });

  if (error) {
    return errorResult('Reflect failed');
  }

  return textResult({ digest: data });
}

export async function handleDiariesList(
  _args: DiariesListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaries({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    return errorResult('Failed to list diaries');
  }

  return textResult(data);
}

export async function handleDiariesCreate(
  args: DiariesCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiary({
    client: deps.client,
    auth: () => token,
    body: { name: args.name, visibility: args.visibility },
  });

  if (error) {
    return errorResult(
      (error as { message?: string })?.message ?? 'Failed to create diary',
    );
  }

  return textResult({ success: true, diary: data });
}

export async function handleDiariesGet(
  args: DiariesGetInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getDiary({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
  });

  if (error) {
    return errorResult('Diary not found');
  }

  return textResult({ diary: data });
}

// --- Tool registration ---

export function registerDiaryTools(
  fastify: FastifyInstance,
  deps: McpDeps,
): void {
  fastify.mcpAddTool(
    {
      name: 'diaries_list',
      description:
        'List your diaries. Call this first to discover your diary IDs.',
      inputSchema: DiariesListSchema,
    },
    async (args, ctx) => handleDiariesList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diaries_create',
      description:
        'Create a new diary. Returns the diary ID needed for entry tools.',
      inputSchema: DiariesCreateSchema,
    },
    async (args, ctx) => handleDiariesCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diaries_get',
      description: 'Get diary metadata by ID.',
      inputSchema: DiariesGetSchema,
    },
    async (args, ctx) => handleDiariesGet(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_create',
      description:
        'Create a new diary entry. This is your persistent memory that survives context compression.',
      inputSchema: EntryCreateSchema,
    },
    async (args, ctx) => handleEntryCreate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_get',
      description: 'Get a single diary entry by ID.',
      inputSchema: EntryGetSchema,
    },
    async (args, ctx) => handleEntryGet(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_list',
      description: 'List your recent diary entries.',
      inputSchema: EntryListSchema,
    },
    async (args, ctx) => handleEntryList(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_search',
      description:
        'Search your diary entries using hybrid search (semantic + full-text). ' +
        'Supports natural language queries and websearch_to_tsquery syntax: ' +
        '`deploy production` = OR match; `"npm audit"` = phrase match; ' +
        '`deploy -staging` = exclude term; `"security vulnerability" +audit` = phrase + required term.',
      inputSchema: EntrySearchSchema,
    },
    async (args, ctx) => handleEntrySearch(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_update',
      description: 'Update a diary entry (tags, content, title).',
      inputSchema: EntryUpdateSchema,
    },
    async (args, ctx) => handleEntryUpdate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_delete',
      description: 'Delete a diary entry.',
      inputSchema: EntryDeleteSchema,
    },
    async (args, ctx) => handleEntryDelete(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'reflect',
      description:
        'Get a curated summary of your memories. Use this after context compression to rebuild your sense of self.',
      inputSchema: ReflectSchema,
    },
    async (args, ctx) => handleReflect(args, deps, ctx),
  );
}
