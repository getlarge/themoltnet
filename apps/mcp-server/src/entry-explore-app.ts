import fs from 'node:fs/promises';

/**
 * @moltnet/mcp-server — MCP Apps diary-map surface
 *
 * `entries_map_open` is a thin host wrapper, mirroring the task app. It mounts
 * the diary-map MCP App and tells it which server tools it may call. The iframe
 * never receives a bearer token or talks to REST directly — it orchestrates the
 * existing deterministic read tools (entries_list, entries_search, diary_tags)
 * and the packs tools (to materialize/validate knowledge zones as draft packs).
 * All interpretation happens in the client agent; this server stays
 * retrieval-oriented with no LLM and no exploration store.
 *
 * Note: the app's identity constants are inlined here rather than imported from
 * `@moltnet/entry-explore-mcp-app`. That package is `platform:browser` (it
 * depends on diary-ui/React), and a `platform:server` source importing it would
 * violate the module-boundary rule. The runtime dist is still resolved by
 * package-name string via `resolveInstalledMcpAppHtmlPath`, so the workspace
 * dependency (and its built `dist/index.html`) is what we actually rely on — not
 * a source import. These two literals MUST stay in sync with the app's
 * `src/metadata.ts`; a build-time assertion in that lib's tests guards the URI.
 */
import type { FastifyInstance } from 'fastify';

import {
  createMcpAppResourceMeta,
  createMcpAppToolMeta,
  MCP_APP_RESOURCE_MIME_TYPE,
  resolveInstalledMcpAppHtmlPath,
} from './mcp-app-ui.js';
import type {
  EntryMapOpenInput,
  EntryMapOpenOutput,
} from './schemas/entry-explore-schemas.js';
import {
  EntryMapOpenOutputSchema,
  EntryMapOpenSchema,
} from './schemas/entry-explore-schemas.js';
import type { CallToolResult, ReadResourceResult } from './types.js';
import { structuredResult } from './utils.js';

/** Kept in sync with libs/entry-explore-mcp-app/src/metadata.ts. */
const ENTRY_EXPLORE_MCP_APP_NAME = 'moltnet_entry_explore';
const ENTRY_EXPLORE_MCP_APP_RESOURCE_URI = 'ui://moltnet/entries/explore.html';
const ENTRY_EXPLORE_MCP_APP_PACKAGE = '@moltnet/entry-explore-mcp-app';

export const ENTRY_MAP_APP_RESOURCE_URI = ENTRY_EXPLORE_MCP_APP_RESOURCE_URI;
export const ENTRY_MAP_APP_MIME_TYPE = MCP_APP_RESOURCE_MIME_TYPE;

const ENTRY_MAP_APP_RESOURCE_META = createMcpAppResourceMeta();

const DEFAULT_SAMPLE_LIMIT = 96;

/** Read tools the map app orchestrates, plus the packs tools for zone drafts. */
const ENTRY_MAP_APP_TOOLS = [
  'entries_list',
  'entries_search',
  'diary_tags',
  'entries_get',
  'packs_create',
  'packs_get',
  'packs_list',
  'packs_update',
];

async function buildEntryMapAppHtml(): Promise<string> {
  return fs.readFile(
    resolveInstalledMcpAppHtmlPath(
      ENTRY_EXPLORE_MCP_APP_PACKAGE,
      import.meta.url,
    ),
    'utf8',
  );
}

export function handleEntriesMapOpen(args: EntryMapOpenInput): CallToolResult {
  // A caller-supplied map is flattened to the top level so the app's tolerant
  // parser renders zones on first paint (the app reads diaryName/totalEntries/
  // overview/zones from the opener output). Omitted → app opens "waiting".
  const map = args.map ?? {};
  const output: EntryMapOpenOutput = {
    app: ENTRY_EXPLORE_MCP_APP_NAME,
    resourceUri: ENTRY_MAP_APP_RESOURCE_URI,
    diaryId: args.diary_id,
    sampleLimit: args.sample_limit ?? DEFAULT_SAMPLE_LIMIT,
    ...(args.framing ? { framing: args.framing } : {}),
    ...(map.diaryName !== undefined ? { diaryName: map.diaryName } : {}),
    ...(map.totalEntries !== undefined
      ? { totalEntries: map.totalEntries }
      : {}),
    ...(map.sampledEntries !== undefined
      ? { sampledEntries: map.sampledEntries }
      : {}),
    ...(map.overview !== undefined ? { overview: map.overview } : {}),
    ...(map.zones !== undefined ? { zones: map.zones } : {}),
    tools: ENTRY_MAP_APP_TOOLS,
  };
  return structuredResult(output);
}

export async function handleEntriesMapResource(): Promise<ReadResourceResult> {
  return {
    contents: [
      {
        uri: ENTRY_MAP_APP_RESOURCE_URI,
        mimeType: ENTRY_MAP_APP_MIME_TYPE,
        text: await buildEntryMapAppHtml(),
        _meta: ENTRY_MAP_APP_RESOURCE_META,
      },
    ],
  };
}

export function registerEntryExploreApp(fastify: FastifyInstance): void {
  fastify.mcpAddTool(
    {
      name: 'entries_map_open',
      title: 'Open Diary Map',
      description:
        'Open the interactive MoltNet diary map app — a human-first way to make ' +
        'sense of a large diary. Use it when a user wants to understand what is ' +
        'in their diary, discover knowledge zones, or be reminded of past ' +
        'decisions/research. After opening, interpret the diary by sampling with ' +
        'entries_list/diary_tags/entries_search, then push a map of labeled zones ' +
        'to the app for the user to explore and curate into draft packs.',
      inputSchema: EntryMapOpenSchema,
      outputSchema: EntryMapOpenOutputSchema,
      _meta: createMcpAppToolMeta(ENTRY_MAP_APP_RESOURCE_URI),
    },
    (args: EntryMapOpenInput) => handleEntriesMapOpen(args),
  );

  fastify.mcpAddResource(
    {
      name: 'entry-explore-app',
      title: 'MoltNet Diary Map',
      uriPattern: ENTRY_MAP_APP_RESOURCE_URI,
      description:
        'Interactive MCP App for human-first diary sense-making and zone discovery.',
      mimeType: ENTRY_MAP_APP_MIME_TYPE,
      _meta: ENTRY_MAP_APP_RESOURCE_META,
    },
    async () => handleEntriesMapResource(),
  );
}
