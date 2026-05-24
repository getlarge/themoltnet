/**
 * MCP-tool-backed implementation of the diary-ui {@link DiaryDataAdapter}.
 *
 * The iframe never holds a bearer token or talks to REST directly. Every data
 * read goes through the host bridge via `app.callServerTool`, against the
 * existing deterministic server tools (`entries_list`, `entries_search`,
 * `diary_tags`). Zone materialization/validation wraps the existing packs tools
 * (`packs_create`, `packs_update`, `packs_list`) so a zone becomes an unpinned
 * draft pack carrying its search provenance in `params` (`packs_create`), then a
 * pinned pack once the human validates it (`packs_update`). The pack UUID is
 * resolved from the create CID via `packs_provenance`.
 *
 * Tool results arrive as `{ content: [{ type:'text', text }], structuredContent }`;
 * {@link parseToolJson} reads either shape (mirrors libs/task-mcp-app).
 */
import type {
  DiaryDataAdapter,
  DiaryList,
  DiarySearchResult,
  ListEntriesArgs,
  SearchEntriesArgs,
  TagCloudItem,
} from '@moltnet/diary-ui';

import type { ZoneProvenance } from '../state/map.js';

/** The slice of the ext-apps `App` we depend on — keeps tests trivially mockable. */
export interface ToolCaller {
  callServerTool(input: {
    name: string;
    arguments: Record<string, unknown>;
  }): Promise<unknown>;
}

type ToolResult = {
  content?: Array<{ type?: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : {};
}

/**
 * Extract the JSON payload from a tool result, preferring the text content block
 * and falling back to `structuredContent`. Returns `{}` when neither parses.
 */
export function parseToolJson(result: unknown): Record<string, unknown> {
  const typed = asRecord(result) as ToolResult;
  const text = Array.isArray(typed.content)
    ? typed.content.find((item) => item?.type === 'text')?.text
    : undefined;
  if (!text) return asRecord(typed.structuredContent);
  try {
    return asRecord(JSON.parse(text));
  } catch {
    return asRecord(typed.structuredContent);
  }
}

/** Drop undefined keys so we never send `key: undefined` over the bridge. */
function defined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
}

/** A draft zone materialized as an unpinned context pack. */
export interface DraftPack {
  packId: string;
  packCid: string;
  pinned: boolean;
}

export interface CreateZonePackInput {
  diaryId: string;
  entryIds: string[];
  provenance: ZoneProvenance;
  /** Human-language zone label, stored in pack params for later display. */
  label: string;
}

export class McpDiaryAdapter implements DiaryDataAdapter {
  constructor(private readonly app: ToolCaller) {}

  async listEntries(args: ListEntriesArgs): Promise<DiaryList> {
    const result = await this.app.callServerTool({
      name: 'entries_list',
      arguments: defined({
        diary_id: args.diaryId,
        limit: args.limit,
        offset: args.offset,
        ids: args.ids,
        tags: args.tags,
        exclude_tags: args.excludeTags,
        entry_type: args.entryType,
      }),
    });
    const json = parseToolJson(result);
    return {
      items: Array.isArray(json.items)
        ? (json.items as DiaryList['items'])
        : [],
      total: typeof json.total === 'number' ? json.total : 0,
      limit: typeof json.limit === 'number' ? json.limit : (args.limit ?? 0),
      offset:
        typeof json.offset === 'number' ? json.offset : (args.offset ?? 0),
    };
  }

  async searchEntries(args: SearchEntriesArgs): Promise<DiarySearchResult> {
    const result = await this.app.callServerTool({
      name: 'entries_search',
      arguments: defined({
        diary_id: args.diaryId,
        query: args.query,
        tags: args.tags,
        limit: args.limit,
        w_relevance: args.wRelevance,
        w_recency: args.wRecency,
        w_importance: args.wImportance,
        entry_types: args.entryTypes,
        exclude_superseded: args.excludeSuperseded,
      }),
    });
    const json = parseToolJson(result);
    return {
      results: Array.isArray(json.results)
        ? (json.results as DiarySearchResult['results'])
        : [],
      total: typeof json.total === 'number' ? json.total : 0,
    };
  }

  async listTags(diaryId: string): Promise<TagCloudItem[]> {
    const result = await this.app.callServerTool({
      name: 'diary_tags',
      arguments: { diary_id: diaryId },
    });
    const json = parseToolJson(result);
    const tags = Array.isArray(json.tags) ? json.tags : [];
    return tags
      .map((item) => asRecord(item))
      .filter((item) => typeof item.tag === 'string')
      .map((item) => ({
        tag: item.tag as string,
        count: typeof item.count === 'number' ? item.count : 0,
      }));
  }

  /**
   * Materialize a zone as an *unpinned* draft pack. The selection's search
   * provenance is stored in `params` (committed into the pack CID, so the zone
   * is reproducible from its provenance). Cheap and idempotent by CID.
   */
  async createZonePack(input: CreateZonePackInput): Promise<DraftPack> {
    const result = await this.app.callServerTool({
      name: 'packs_create',
      arguments: {
        diary_id: input.diaryId,
        pinned: false,
        params: {
          kind: 'diary-map-zone',
          status: 'draft',
          label: input.label,
          basis: input.provenance.basis,
          searches: input.provenance.searches,
        },
        entries: input.entryIds.map((entryId, index) => ({
          entry_id: entryId,
          rank: index + 1,
        })),
      },
    });
    const json = parseToolJson(result);
    const packCid = typeof json.packCid === 'string' ? json.packCid : '';
    // packs_create returns only packCid (CustomPackResult), not the pack UUID,
    // but packs_update (pin) needs the UUID. Resolve it deterministically from
    // the CID via packs_provenance (its metadata.rootPackId IS the UUID) —
    // never via packs_list, which paginates (default limit 20) and could miss a
    // freshly-created pack in a diary with many packs.
    const packId = packCid ? await this.resolvePackIdByCid(packCid) : '';
    return { packId, packCid, pinned: false };
  }

  /**
   * Resolve a pack's UUID from its CID via packs_provenance, whose
   * `metadata.rootPackId` is the pack UUID. Deterministic and pagination-free
   * (packs_update needs the UUID to pin). Returns '' if it can't be resolved.
   */
  private async resolvePackIdByCid(packCid: string): Promise<string> {
    const result = await this.app.callServerTool({
      name: 'packs_provenance',
      arguments: { pack_cid: packCid, depth: 0 },
    });
    const json = parseToolJson(result);
    const metadata = asRecord(json.metadata);
    return typeof metadata.rootPackId === 'string' ? metadata.rootPackId : '';
  }

  /** Pin (validate) or unpin a zone's draft pack. */
  async setZonePinned(packId: string, pinned: boolean): Promise<void> {
    await this.app.callServerTool({
      name: 'packs_update',
      arguments: defined({
        pack_id: packId,
        pinned,
        // Unpinning requires an expiry; give drafts a fresh 7-day TTL.
        expires_at: pinned
          ? undefined
          : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      }),
    });
  }
}
