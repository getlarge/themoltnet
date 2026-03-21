/**
 * @moltnet/mcp-server — Diary Tool Handlers
 *
 * Each tool delegates to the REST API via the generated API client,
 * passing the agent's bearer token from the MCP handler context.
 */

import {
  compileDiary,
  consolidateDiary,
  createDiary,
  createDiaryEntry,
  deleteDiaryEntryById,
  getDiary,
  getDiaryEntryById,
  listDiaries,
  listDiaryEntries,
  listDiaryTags,
  reflectDiary,
  searchDiary,
  updateDiaryEntryById,
  verifyDiaryEntryById,
} from '@moltnet/api-client';
import type { FastifyInstance } from 'fastify';

import type {
  DiariesCompileInput,
  DiariesConsolidateInput,
  DiariesCreateInput,
  DiariesGetInput,
  DiariesListInput,
  DiaryTagsInput,
  EntryCreateInput,
  EntryDeleteInput,
  EntryGetInput,
  EntryListInput,
  EntrySearchInput,
  EntryUpdateInput,
  EntryVerifyInput,
  ReflectInput,
} from './schemas.js';
import {
  DiariesCompileSchema,
  DiariesConsolidateSchema,
  DiariesCreateSchema,
  DiariesGetSchema,
  DiariesListSchema,
  DiaryTagsSchema,
  EntryCreateSchema,
  EntryDeleteSchema,
  EntryGetSchema,
  EntryListSchema,
  EntrySearchSchema,
  EntryUpdateSchema,
  EntryVerifySchema,
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
  deps.logger.debug({ tool: 'entries_create' }, 'tool.invoked');
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
      signingRequestId: args.signing_request_id,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_create', err: error }, 'tool.error');
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
  deps.logger.debug({ tool: 'entries_get' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getDiaryEntryById({
    client: deps.client,
    auth: () => token,
    path: { entryId: args.entry_id },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_get', err: error }, 'tool.error');
    return errorResult('Entry not found');
  }

  return textResult({ entry: data });
}

export async function handleEntryList(
  args: EntryListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'entries_list' }, 'tool.invoked');
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
      ...(args.exclude_tags && { excludeTags: args.exclude_tags.join(',') }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_list', err: error }, 'tool.error');
    return errorResult('Failed to list entries');
  }

  return textResult(data);
}

export async function handleEntrySearch(
  args: EntrySearchInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'entries_search' }, 'tool.invoked');
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
      ...(args.exclude_tags && { excludeTags: args.exclude_tags }),
      wRelevance: args.w_relevance,
      wRecency: args.w_recency,
      wImportance: args.w_importance,
      entryTypes: args.entry_types,
      excludeSuperseded: args.exclude_superseded,
      includeShared: args.include_shared,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_search', err: error }, 'tool.error');
    return errorResult('Search failed');
  }

  return textResult(data);
}

export async function handleEntryUpdate(
  args: EntryUpdateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'entries_update' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { entry_id, entry_type, ...updates } = args;
  delete (updates as { diary_id?: string }).diary_id;
  const { data, error } = await updateDiaryEntryById({
    client: deps.client,
    auth: () => token,
    path: { entryId: entry_id },
    body: {
      ...updates,
      entryType: entry_type,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_update', err: error }, 'tool.error');
    return errorResult('Entry not found');
  }

  return textResult({ success: true, entry: data });
}

export async function handleEntryDelete(
  args: EntryDeleteInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'entries_delete' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { error } = await deleteDiaryEntryById({
    client: deps.client,
    auth: () => token,
    path: { entryId: args.entry_id },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_delete', err: error }, 'tool.error');
    return errorResult('Entry not found');
  }

  return textResult({ success: true, message: 'Entry deleted' });
}

export async function handleReflect(
  args: ReflectInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'reflect' }, 'tool.invoked');
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
    deps.logger.error({ tool: 'reflect', err: error }, 'tool.error');
    return errorResult('Reflect failed');
  }

  return textResult({ digest: data });
}

export async function handleEntryVerify(
  args: EntryVerifyInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'entries_verify' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await verifyDiaryEntryById({
    client: deps.client,
    auth: () => token,
    path: { entryId: args.entry_id },
  });

  if (error) {
    deps.logger.error({ tool: 'entries_verify', err: error }, 'tool.error');
    return errorResult('Verification failed');
  }

  return textResult(data);
}

export async function handleDiariesList(
  _args: DiariesListInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diaries_list' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaries({
    client: deps.client,
    auth: () => token,
  });

  if (error) {
    deps.logger.error({ tool: 'diaries_list', err: error }, 'tool.error');
    return errorResult('Failed to list diaries');
  }

  return textResult(data);
}

export async function handleDiariesCreate(
  args: DiariesCreateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diaries_create' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await createDiary({
    client: deps.client,
    auth: () => token,
    body: { name: args.name, visibility: args.visibility },
  });

  if (error) {
    deps.logger.error({ tool: 'diaries_create', err: error }, 'tool.error');
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
  deps.logger.debug({ tool: 'diaries_get' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await getDiary({
    client: deps.client,
    auth: () => token,
    path: { id: args.diary_id },
  });

  if (error) {
    deps.logger.error({ tool: 'diaries_get', err: error }, 'tool.error');
    return errorResult('Diary not found');
  }

  return textResult({ diary: data });
}

export async function handleDiariesConsolidate(
  args: DiariesConsolidateInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diaries_consolidate' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { diary_id, entry_ids, tags, exclude_tags, threshold, strategy } = args;
  const { data, error } = await consolidateDiary({
    client: deps.client,
    auth: () => token,
    path: { id: diary_id },
    body: {
      entryIds: entry_ids,
      tags,
      excludeTags: exclude_tags,
      threshold,
      strategy,
    },
  });

  if (error) {
    deps.logger.error(
      { tool: 'diaries_consolidate', err: error },
      'tool.error',
    );
    return errorResult('Consolidation failed');
  }

  return textResult(data);
}

export async function handleDiariesCompile(
  args: DiariesCompileInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diaries_compile' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const {
    diary_id,
    token_budget,
    task_prompt,
    lambda,
    include_tags,
    exclude_tags,
    w_recency,
    w_importance,
    created_before,
    created_after,
    entry_types,
  } = args;
  const { data, error } = await compileDiary({
    client: deps.client,
    auth: () => token,
    path: { id: diary_id },
    body: {
      tokenBudget: token_budget,
      taskPrompt: task_prompt,
      lambda,
      includeTags: include_tags,
      excludeTags: exclude_tags,
      wRecency: w_recency,
      wImportance: w_importance,
      createdBefore: created_before,
      createdAfter: created_after,
      entryTypes: entry_types,
    },
  });

  if (error) {
    deps.logger.error({ tool: 'diaries_compile', err: error }, 'tool.error');
    return errorResult('Compile failed');
  }

  return textResult(data);
}

// --- Tool registration ---

export async function handleDiaryTags(
  args: DiaryTagsInput,
  deps: McpDeps,
  context: HandlerContext,
): Promise<CallToolResult> {
  deps.logger.debug({ tool: 'diary_tags' }, 'tool.invoked');
  const token = getTokenFromContext(context);
  if (!token) return errorResult('Not authenticated');

  const { data, error } = await listDiaryTags({
    client: deps.client,
    auth: () => token,
    path: { diaryId: args.diary_id },
    query: {
      ...(args.prefix !== undefined && { prefix: args.prefix }),
      ...(args.min_count !== undefined && { minCount: args.min_count }),
      ...(args.entry_types !== undefined && {
        entryTypes: args.entry_types.join(','),
      }),
    },
  });

  if (error) {
    deps.logger.error({ tool: 'diary_tags', err: error }, 'tool.error');
    return errorResult('Failed to list diary tags');
  }

  return textResult(data);
}

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
      name: 'diaries_consolidate',
      description:
        'Cluster semantically similar entries and return consolidation suggestions.',
      inputSchema: DiariesConsolidateSchema,
    },
    async (args, ctx) => handleDiariesConsolidate(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'diaries_compile',
      description:
        'Compile a token-budget-fitted context pack from diary entries.',
      inputSchema: DiariesCompileSchema,
    },
    async (args, ctx) => handleDiariesCompile(args, deps, ctx),
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
      name: 'diary_tags',
      description:
        'List distinct tags used in a diary with counts. ' +
        'Use this to discover available tags before compiling context packs with include_tags/exclude_tags.',
      inputSchema: DiaryTagsSchema,
    },
    async (args, ctx) => handleDiaryTags(args, deps, ctx),
  );

  fastify.mcpAddTool(
    {
      name: 'entries_create',
      description:
        'Create a new diary entry. This is your persistent memory that survives context compression.' +
        ' To create a signed (immutable) entry: compute the CID from (entryType, title, content, tags)' +
        ' using computeContentCid, pass it to crypto_prepare_signature as the message,' +
        ' sign with crypto_submit_signature, then pass signing_request_id here.' +
        ' The server recomputes the CID to verify it matches.',
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
      name: 'entries_verify',
      description:
        'Verify the content signature of a diary entry.' +
        ' Checks that the content hash matches and the Ed25519 signature is valid.' +
        ' Returns signed status, hash match, signature validity, and agent fingerprint.',
      inputSchema: EntryVerifySchema,
    },
    async (args, ctx) => handleEntryVerify(args, deps, ctx),
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
