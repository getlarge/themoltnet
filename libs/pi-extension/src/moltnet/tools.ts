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

type PackEntry = {
  entryId: string;
  entryCidSnapshot: string;
  compressionLevel: 'full' | 'summary' | 'keywords';
  originalTokens: number | null;
  packedTokens: number | null;
  entry: {
    title: string | null;
    content: string;
    tags: string[] | null;
    entryType: string;
    creator: {
      fingerprint: string;
    } | null;
  };
};

type ExpandedPack = {
  id: string;
  packCid: string;
  createdAt: string;
  entries?: PackEntry[];
};

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

function slugToTitle(value: string) {
  return value
    .split(/[:/_-]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ');
}

function extractScope(tags: string[] | null | undefined) {
  const scope = tags?.find((tag) => tag.startsWith('scope:'));
  return scope ? scope.slice('scope:'.length) : null;
}

function extractSeverity(tags: string[] | null | undefined) {
  const severity = tags?.find((tag) => tag.startsWith('severity:'));
  return severity ? severity.slice('severity:'.length) : null;
}

function stripEntryScaffolding(content: string) {
  return content
    .replace(/<metadata>[\s\S]*?<\/metadata>/gi, '')
    .replace(/<\/?moltnet-signed>/gi, '')
    .replace(/<\/?signature[^>]*>/gi, '')
    .replace(/^- Compression:.*$/gim, '')
    .replace(/^- Tokens:.*$/gim, '')
    .trim();
}

function normalizeKey(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function extractRules(content: string) {
  return stripEntryScaffolding(content)
    .split('\n')
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        (/(^rule:|^watch for:|^must\b|^never\b)/i.test(line) ||
          /\b(MUST|NEVER)\b/.test(line)),
    )
    .slice(0, 5);
}

function renderSourceRefs(entries: PackEntry[]) {
  return entries
    .map((entry) => {
      const shortId = entry.entryId.slice(0, 8);
      const fingerprint = entry.entry.creator?.fingerprint
        ?.replaceAll('-', '')
        .slice(0, 4)
        .toLowerCase();
      const agentRef = fingerprint ? `agent:${fingerprint}` : 'agent:unkn';
      return `[\`e:${shortId}\`](@unknown · ${agentRef})`;
    })
    .join(', ');
}

function renderKeywords(tags: string[] | null | undefined) {
  const keywords = (tags ?? []).filter(
    (tag) => !tag.startsWith('scope:') && !tag.startsWith('severity:'),
  );
  if (keywords.length === 0) return '';
  return `Relevant search terms include ${keywords
    .slice(0, 6)
    .map((tag) => `\`${tag}\``)
    .join(', ')}.`;
}

function renderPhase6Markdown(pack: ExpandedPack) {
  const entries = pack.entries ?? [];
  const grouped = new Map<
    string,
    Map<string, { title: string; scope: string; entries: PackEntry[] }>
  >();

  for (const entry of entries) {
    const scope = extractScope(entry.entry.tags) ?? 'general';
    const title =
      entry.entry.title?.trim() || `Entry ${entry.entryId.slice(0, 8)}`;
    const groupKey = normalizeKey(scope);
    const topicKey = normalizeKey(title) || entry.entryId;

    if (!grouped.has(groupKey)) grouped.set(groupKey, new Map());
    const topics = grouped.get(groupKey)!;
    const existing = topics.get(topicKey);
    if (existing) {
      existing.entries.push(entry);
    } else {
      topics.set(topicKey, { title, scope, entries: [entry] });
    }
  }

  const lines: string[] = [];
  lines.push('# Rendered Pack');
  lines.push('');
  lines.push('## Source');
  lines.push('');
  lines.push('| Pack UUID | Pack CID | Entries |');
  lines.push('| --------- | -------- | ------- |');
  lines.push(`| \`${pack.id}\` | \`${pack.packCid}\` | ${entries.length} |`);
  lines.push('');

  for (const [, topics] of grouped) {
    const firstTopic = topics.values().next().value as
      | { scope: string }
      | undefined;
    const scope = firstTopic?.scope ?? 'general';
    lines.push(`## ${slugToTitle(scope)}`);
    lines.push('');

    for (const [, topic] of topics) {
      const primary = topic.entries[0];
      const mergedContent = topic.entries
        .map((entry) => stripEntryScaffolding(entry.entry.content))
        .filter(Boolean)
        .join('\n\n');
      const rules = topic.entries.flatMap((entry) =>
        extractRules(entry.entry.content),
      );
      const severity = extractSeverity(primary.entry.tags);

      lines.push(`### ${topic.title}`);
      lines.push('');
      lines.push(`**Subsystem:** ${slugToTitle(topic.scope)}`);
      if (severity) lines.push(`**Severity:** ${slugToTitle(severity)}`);
      lines.push(`**Type:** ${primary.entry.entryType}`);
      lines.push('');
      if (rules.length > 0) {
        lines.push('**Rules**');
        lines.push('');
        for (const rule of Array.from(new Set(rules))) {
          lines.push(`- ${rule}`);
        }
        lines.push('');
      }
      lines.push(mergedContent);
      lines.push('');
      const keywords = renderKeywords(primary.entry.tags);
      if (keywords) {
        lines.push(keywords);
        lines.push('');
      }
      lines.push('Provenance:');
      for (const entry of topic.entries) {
        lines.push(
          `- Entry ID \`${entry.entryId}\`, CID \`${entry.entryCidSnapshot}\``,
        );
      }
      lines.push('');
      lines.push(`*Sources: ${renderSourceRefs(topic.entries)}*`);
      lines.push('');
    }
  }

  if (entries.length === 0) {
    lines.push('_This pack has no expanded entries._');
    lines.push('');
  }

  return lines.join('\n').trim();
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
    description: 'Get the provenance graph for a context pack by ID or CID.',
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
      'Fetch a pack with entries, transform it into docs, then preview or persist the rendered pack.',
    parameters: Type.Object({
      packId: Type.String({ description: 'Context pack ID' }),
      renderMethod: Type.Optional(
        Type.String({
          description: 'Render method label. Defaults to pi:pack-to-docs-v1',
        }),
      ),
      markdown: Type.Optional(
        Type.String({
          description: 'Optional caller-authored markdown override',
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
      const renderMethod = params.renderMethod ?? 'pi:pack-to-docs-v1';

      let renderedMarkdown = params.markdown;
      if (!renderedMarkdown && !renderMethod.startsWith('server:')) {
        const pack = (await agent.packs.get(params.packId, {
          expand: 'entries',
        })) as ExpandedPack;
        renderedMarkdown = renderPhase6Markdown(pack);
      }

      const result =
        (params.preview ?? false)
          ? await agent.packs.previewRendered(params.packId, {
              renderMethod,
              renderedMarkdown,
            })
          : await agent.packs.render(params.packId, {
              renderMethod,
              renderedMarkdown,
              pinned: params.pinned,
            });

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
