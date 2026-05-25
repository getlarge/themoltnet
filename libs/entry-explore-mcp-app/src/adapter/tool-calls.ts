/**
 * Compile-time-typed wrapper over ext-apps `app.callServerTool`.
 *
 * The raw `callServerTool({ name, arguments })` takes `arguments: Record<string,
 * unknown>` with NO link between the tool name and its argument shape, so a
 * call-site typo or schema drift fails silently at runtime in the user's chat.
 * {@link callTool} maps each tool name to a snake_case argument type via
 * {@link ToolInputMap}, so the compiler rejects wrong/missing/misspelled args.
 *
 * The argument types here are declared locally (snake_case, mirroring the MCP
 * server's TypeBox input schemas in `apps/mcp-server/src/schemas/`). They are
 * intentionally a hand-maintained mirror for now. The correct long-term source
 * is a shared `platform:isomorphic` contract lib (e.g. `@moltnet/mcp-contract`)
 * that both the server registers from and the apps import — tracked separately
 * (it also dissolves the metadata-constant inlining in entry-explore-app.ts).
 * Until then, if you change a server schema, update the matching type below.
 */
import type { ToolCaller } from './tool-caller.js';

type EntryType =
  | 'episodic'
  | 'semantic'
  | 'procedural'
  | 'reflection'
  | 'identity'
  | 'soul';

export interface EntriesListArgs {
  diary_id: string;
  limit?: number;
  offset?: number;
  ids?: string[];
  tags?: string[];
  exclude_tags?: string[];
  entry_type?: EntryType[];
}

export interface EntriesSearchArgs {
  query: string;
  diary_id?: string;
  tags?: string[];
  limit?: number;
  w_relevance?: number;
  w_recency?: number;
  w_importance?: number;
  entry_types?: EntryType[];
  exclude_superseded?: boolean;
}

export interface DiaryTagsArgs {
  diary_id: string;
  prefix?: string;
  min_count?: number;
  entry_types?: EntryType[];
}

export interface EntriesGetArgs {
  entry_id: string;
  expand_relations?: boolean;
  depth?: number;
}

export interface PacksCreateArgs {
  diary_id: string;
  params: Record<string, unknown>;
  entries: Array<{ entry_id: string; rank: number }>;
  token_budget?: number;
  pinned?: boolean;
}

export interface PacksUpdateArgs {
  pack_id: string;
  pinned?: boolean;
  expires_at?: string;
}

export interface PacksProvenanceArgs {
  pack_id?: string;
  pack_cid?: string;
  depth?: number;
}

/** Tool name → snake_case argument shape. The only tools this app calls. */
export interface ToolInputMap {
  entries_list: EntriesListArgs;
  entries_search: EntriesSearchArgs;
  diary_tags: DiaryTagsArgs;
  entries_get: EntriesGetArgs;
  packs_create: PacksCreateArgs;
  packs_update: PacksUpdateArgs;
  packs_provenance: PacksProvenanceArgs;
}

export type ToolName = keyof ToolInputMap;

/** Drop undefined keys so we never send `key: undefined` over the bridge. */
function defined<T extends object>(value: T): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
}

/**
 * Call a server tool with arguments type-checked against the tool's input map.
 * Strips `undefined` keys before sending. Returns the raw tool result (parse
 * with {@link parseToolJson}).
 */
export function callTool<K extends ToolName>(
  app: ToolCaller,
  name: K,
  args: ToolInputMap[K],
): Promise<unknown> {
  return app.callServerTool({ name, arguments: defined(args) });
}
