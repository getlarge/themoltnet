/**
 * MoltNet custom tools for pi.
 *
 * Factory that produces ready-to-register pi tool definitions.
 * These tools run on the host (not in the VM) via the MoltNet SDK,
 * so agent credentials never touch the VM filesystem.
 */
import { randomUUID } from 'node:crypto';

import { Type } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import { defineTool } from '@mariozechner/pi-coding-agent';
import type { connect } from '@themoltnet/sdk';

import type { TrackedError } from '../commands/types.js';

type MoltNetAgent = Awaited<ReturnType<typeof connect>>;

export interface MoltNetToolsConfig {
  getAgent(): MoltNetAgent | null;
  getDiaryId(): string | null;
  getSessionErrors(): readonly TrackedError[];
  clearSessionErrors(): void;
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

export function createMoltNetTools(
  config: MoltNetToolsConfig,
): ToolDefinition<any, any>[] {
  const getPack = defineTool({
    name: 'moltnet_pack_get',
    label: 'Get MoltNet Pack',
    description:
      'Get a context pack by ID. Optionally expand included entries.',
    parameters: Type.Object({
      packId: Type.String({ description: 'Context pack ID' }),
      expandEntries: Type.Optional(
        Type.Boolean({ description: 'Include full expanded entries' }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const pack = await agent.packs.get(params.packId, {
        expand: params.expandEntries ? 'entries' : undefined,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(pack, null, 2) },
        ],
        details: {},
      };
    },
  });

  const getPackProvenance = defineTool({
    name: 'moltnet_pack_provenance',
    label: 'Get MoltNet Pack Provenance',
    description:
      'Get the provenance graph for a context pack by ID or CID.',
    parameters: Type.Object({
      packId: Type.Optional(Type.String({ description: 'Context pack ID' })),
      packCid: Type.Optional(Type.String({ description: 'Context pack CID' })),
      depth: Type.Optional(
        Type.Number({
          description: 'Supersession ancestry depth to include (default 2)',
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      if (!params.packId && !params.packCid) {
        throw new Error('Provide either packId or packCid');
      }
      if (params.packId && params.packCid) {
        throw new Error('Provide only one of packId or packCid');
      }

      const graph = params.packId
        ? await agent.packs.getProvenance(params.packId, {
            depth: params.depth ?? 2,
          })
        : await agent.packs.getProvenanceByCid(params.packCid!, {
            depth: params.depth ?? 2,
          });

      const payload = {
        metadata: graph.metadata,
        counts: {
          nodes: graph.nodes.length,
          edges: graph.edges.length,
        },
        graph,
      };

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
        ],
        details: {},
      };
    },
  });

  const renderPack = defineTool({
    name: 'moltnet_pack_render',
    label: 'Render MoltNet Pack',
    description:
      'Preview or persist a rendered pack from a source context pack.',
    parameters: Type.Object({
      packId: Type.String({ description: 'Context pack ID' }),
      renderMethod: Type.Optional(
        Type.String({
          description:
            'Render method label. Defaults to server:pack-to-docs-v1',
        }),
      ),
      markdown: Type.Optional(
        Type.String({
          description:
            'Caller-authored markdown for non-server render methods',
        }),
      ),
      preview: Type.Optional(
        Type.Boolean({
          description: 'Preview without persisting (default false)',
        }),
      ),
      pinned: Type.Optional(
        Type.Boolean({
          description: 'Persist the rendered pack as pinned (default false)',
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const renderMethod = params.renderMethod ?? 'server:pack-to-docs-v1';
      const body = {
        renderMethod,
        renderedMarkdown: params.markdown,
        pinned: params.pinned,
      };

      if (!renderMethod.startsWith('server:') && !params.markdown) {
        throw new Error(
          'markdown is required for non-server render methods',
        );
      }

      const result = params.preview
        ? await agent.packs.previewRendered(params.packId, {
            renderMethod,
            renderedMarkdown: params.markdown,
          })
        : await agent.packs.render(params.packId, body);

      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(result, null, 2) },
        ],
        details: {},
      };
    },
  });

  const listRenderedPacks = defineTool({
    name: 'moltnet_rendered_pack_list',
    label: 'List MoltNet Rendered Packs',
    description:
      'List rendered packs for the current MoltNet diary, optionally filtered by source pack or render method.',
    parameters: Type.Object({
      sourcePackId: Type.Optional(
        Type.String({ description: 'Filter by source pack ID' }),
      ),
      renderMethod: Type.Optional(
        Type.String({ description: 'Filter by render method' }),
      ),
      limit: Type.Optional(
        Type.Number({ description: 'Max results (default 10)' }),
      ),
      offset: Type.Optional(
        Type.Number({ description: 'Offset for pagination (default 0)' }),
      ),
    }),
    async execute(_id, params) {
      const { agent, diaryId } = ensureConnected(config);
      const rendered = await agent.packs.listRendered(diaryId, {
        sourcePackId: params.sourcePackId,
        renderMethod: params.renderMethod,
        limit: params.limit ?? 10,
        offset: params.offset ?? 0,
      });
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(rendered, null, 2) },
        ],
        details: {},
      };
    },
  });

  const getRenderedPack = defineTool({
    name: 'moltnet_rendered_pack_get',
    label: 'Get MoltNet Rendered Pack',
    description: 'Get a rendered pack by ID.',
    parameters: Type.Object({
      renderedPackId: Type.String({ description: 'Rendered pack ID' }),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const rendered = await agent.packs.getRendered(params.renderedPackId);
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(rendered, null, 2) },
        ],
        details: {},
      };
    },
  });

  const verifyRenderedPack = defineTool({
    name: 'moltnet_rendered_pack_verify',
    label: 'Verify MoltNet Rendered Pack',
    description:
      'Create a verification workflow for a rendered pack and return the verification ID and nonce.',
    parameters: Type.Object({
      renderedPackId: Type.String({ description: 'Rendered pack ID' }),
      nonce: Type.Optional(
        Type.String({
          description:
            'Caller-supplied idempotency nonce. Generated automatically if omitted.',
        }),
      ),
    }),
    async execute(_id, params) {
      const { agent } = ensureConnected(config);
      const nonce = params.nonce ?? randomUUID();
      const verification = await agent.packs.verifyRendered(
        params.renderedPackId,
        { nonce },
      );
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                ...verification,
                nonce,
              },
              null,
              2,
            ),
          },
        ],
        details: {},
      };
    },
  });

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

  const reviewSessionErrors = defineTool({
    name: 'moltnet_review_session_errors',
    label: 'Review Session Tool Errors',
    description:
      'Review tool failures buffered during this session (isError=true results). ' +
      'Use this to decide whether any failures are worth persisting as a diary entry ' +
      'via moltnet_create_entry. Most failures are transient (denied prompts, empty ' +
      'greps, mid-iteration typecheck errors) and should NOT be written to the diary — ' +
      'only persist incidents that represent a real finding (root cause identified, ' +
      'non-obvious workaround, recurring pattern). Pass clear=true to drop the buffer ' +
      'after reviewing.',
    parameters: Type.Object({
      clear: Type.Optional(
        Type.Boolean({
          description:
            'If true, empty the buffer after returning it. Use once you have decided whether to persist.',
        }),
      ),
    }),
    async execute(_id, params) {
      const errors = config.getSessionErrors();
      const payload = {
        count: errors.length,
        errors: errors.map((e) => ({
          toolName: e.toolName,
          toolCallId: e.toolCallId,
          timestamp: new Date(e.timestamp).toISOString(),
          input: e.input,
          error: e.error,
        })),
      };
      if (params.clear) config.clearSessionErrors();
      return {
        content: [
          { type: 'text' as const, text: JSON.stringify(payload, null, 2) },
        ],
        details: {},
      };
    },
  });

  return [
    getPack,
    getPackProvenance,
    renderPack,
    listRenderedPacks,
    getRenderedPack,
    verifyRenderedPack,
    listEntries,
    getEntry,
    searchEntries,
    createEntry,
    reviewSessionErrors,
  ];
}
