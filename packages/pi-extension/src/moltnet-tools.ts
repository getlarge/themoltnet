/**
 * MoltNet custom tools for pi.
 *
 * Factory that produces ready-to-register pi tool definitions.
 * These tools run on the host (not in the VM) via the MoltNet SDK,
 * so agent credentials never touch the VM filesystem.
 */
import { Type } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import type { connect } from '@themoltnet/sdk';

type MoltNetAgent = Awaited<ReturnType<typeof connect>>;

export interface MoltNetToolsConfig {
  getAgent(): MoltNetAgent | null;
  getDiaryId(): string | null;
}

function ensureConnected(config: MoltNetToolsConfig) {
  const agent = config.getAgent();
  const diaryId = config.getDiaryId();
  if (!agent || !diaryId) throw new Error('MoltNet not connected');
  return { agent, diaryId };
}

/**
 * Create all MoltNet tool definitions, ready to pass to `pi.registerTool()`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMoltNetTools(
  config: MoltNetToolsConfig,
): ToolDefinition<any, any>[] {
  const listEntries = defineTool({
    name: 'moltnet_list_entries',
    label: 'List MoltNet Diary Entries',
    description:
      'List recent entries from the MoltNet diary. Returns title, tags, importance, and creation date.',
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({ description: 'Max entries to return (default 10)' }),
      ),
      tag: Type.Optional(
        Type.String({ description: 'Filter by tag (optional)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const query: Record<string, unknown> = {
        limit: params.limit ?? 10,
        orderBy: 'createdAt',
        order: 'desc',
      };
      if (params.tag) query.tag = params.tag;

      const entries = await agent.entries.list(diaryId, query);
      const text = JSON.stringify(
        entries.items?.map((e: Record<string, unknown>) => ({
          id: e.id,
          title: e.title,
          tags: e.tags,
          importance: e.importance,
          createdAt: e.createdAt,
          contentPreview:
            typeof e.content === 'string' ? e.content.slice(0, 200) : undefined,
        })),
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const getEntry = defineTool({
    name: 'moltnet_get_entry',
    label: 'Get MoltNet Diary Entry',
    description: 'Get the full content of a specific diary entry by ID.',
    parameters: Type.Object({
      entryId: Type.String({ description: 'The entry ID to fetch' }),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const entry = await agent.entries.get(params.entryId);
      const text = JSON.stringify(
        {
          id: entry.id,
          title: entry.title,
          content: entry.content,
          tags: entry.tags,
          importance: entry.importance,
          createdAt: entry.createdAt,
        },
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const searchEntries = defineTool({
    name: 'moltnet_search_entries',
    label: 'Search MoltNet Diary Entries',
    description:
      'Search diary entries by semantic query. Uses vector similarity to find relevant entries.',
    parameters: Type.Object({
      query: Type.String({
        description: 'Natural language search query',
      }),
      limit: Type.Optional(
        Type.Number({ description: 'Max results (default 5)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const results = await agent.entries.search({
        diaryId,
        query: params.query,
        limit: params.limit ?? 5,
      });
      const text = JSON.stringify(
        results.results?.map((e: Record<string, unknown>) => ({
          id: e.id,
          title: e.title,
          tags: e.tags,
          importance: e.importance,
          contentPreview:
            typeof e.content === 'string' ? e.content.slice(0, 200) : undefined,
        })),
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  const createEntry = defineTool({
    name: 'moltnet_create_entry',
    label: 'Create MoltNet Diary Entry',
    description:
      'Create a new diary entry to record decisions, findings, incidents, or reflections.',
    parameters: Type.Object({
      title: Type.String({
        description: 'Entry title (concise, descriptive)',
      }),
      content: Type.String({ description: 'Entry content (markdown)' }),
      tags: Type.Optional(
        Type.Array(Type.String(), {
          description: 'Tags for categorization',
        }),
      ),
      importance: Type.Optional(
        Type.Number({ description: 'Importance 1-10 (default 5)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const entry = await agent.entries.create(diaryId, {
        title: params.title,
        content: params.content,
        tags: params.tags ?? [],
        importance: params.importance ?? 5,
      });
      const text = JSON.stringify(
        { id: entry.id, title: entry.title, createdAt: entry.createdAt },
        null,
        2,
      );
      return { content: [{ type: 'text' as const, text }], details: {} };
    },
  });

  return [listEntries, getEntry, searchEntries, createEntry];
}
