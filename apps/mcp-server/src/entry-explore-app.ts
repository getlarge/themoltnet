import {
  getDiary,
  listDiaryEntries,
  listDiaryTags,
  searchDiary,
} from '@moltnet/api-client';
import {
  buildExploreSurfaceState,
  type ExploreEntry,
  type ExploreTagCount,
  renderExploreSurfaceHtml,
} from '@moltnet/entry-explore-ui';
import type { FastifyInstance } from 'fastify';

import {
  type ExplorationStore,
  InMemoryExplorationStore,
  type StoredExplorationState,
} from './exploration-store.js';
import { buildMcpAppHostBridgeScript } from './mcp-app-host-bridge-source.js';
import {
  type EntryExploreOpenInput,
  EntryExploreOpenSchema,
  type EntryExploreOutput,
  EntryExploreOutputSchema,
  type EntryExploreRefineInput,
  EntryExploreRefineSchema,
} from './schemas/entry-explore-schemas.js';
import type { McpDeps, ReadResourceResult } from './types.js';
import {
  errorResult,
  extractApiErrorMessage,
  getTokenFromContext,
  structuredResult,
} from './utils.js';

export const ENTRY_EXPLORE_APP_RESOURCE_URI =
  'ui://moltnet/entries-explore.html';
export const ENTRY_EXPLORE_APP_MIME_TYPE = 'text/html;profile=mcp-app';

const ENTRY_EXPLORE_APP_RESOURCE_META = {
  ui: {
    csp: {
      connectDomains: [],
      resourceDomains: [],
      frameDomains: [],
    },
    prefersBorder: false,
  },
};

function mapEntry(entry: {
  id: string;
  title: string | null;
  content: string;
  createdAt: string;
  entryType: ExploreEntry['entryType'];
  importance: number;
  tags: string[] | null;
}): ExploreEntry {
  return {
    id: entry.id,
    title: entry.title,
    content: entry.content,
    createdAt: entry.createdAt,
    entryType: entry.entryType,
    importance: entry.importance,
    tags: entry.tags,
  };
}

function countTagsFromEntries(entries: ExploreEntry[]): ExploreTagCount[] {
  const counts = new Map<string, number>();
  for (const entry of entries) {
    for (const tag of entry.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

function getSessionIdFromHeaders(
  headers: Record<string, unknown> | undefined,
): string | null {
  const candidate = headers?.['mcp-session-id'];
  return typeof candidate === 'string' && candidate.length > 0
    ? candidate
    : null;
}

function toOutput(state: StoredExplorationState): EntryExploreOutput {
  const surfaceState = buildExploreSurfaceState({
    explorationId: state.explorationId,
    diaryId: state.diaryId,
    diaryName: state.diaryName,
    estimatedEntryCount: state.estimatedEntryCount,
    sampleEntries: state.sampleEntries,
    visibleEntries: state.visibleEntries,
    topTags:
      state.visibleEntries.length > 0
        ? countTagsFromEntries(state.visibleEntries)
        : state.topTags,
    queryState: state.queryState,
  });

  return {
    exploration_id: state.explorationId,
    diary_id: state.diaryId,
    diary_name: state.diaryName,
    surface_html: renderExploreSurfaceHtml(surfaceState),
    surface_state: surfaceState,
  };
}

async function handleExploreOpen(
  args: EntryExploreOpenInput,
  deps: McpDeps,
  store: ExplorationStore,
  token: string,
  sessionId: string | null,
): Promise<EntryExploreOutput> {
  const sampleLimit = args.sample_limit ?? 72;

  const [diaryResponse, entriesResponse, tagsResponse] = await Promise.all([
    getDiary({
      client: deps.client,
      auth: () => token,
      path: { id: args.diary_id },
    }),
    listDiaryEntries({
      client: deps.client,
      auth: () => token,
      path: { diaryId: args.diary_id },
      query: { limit: sampleLimit, offset: 0 },
    }),
    listDiaryTags({
      client: deps.client,
      auth: () => token,
      path: { diaryId: args.diary_id },
    }),
  ]);

  if (diaryResponse.error || !diaryResponse.data) {
    throw new Error(
      extractApiErrorMessage(diaryResponse.error, 'Failed to load diary'),
    );
  }
  if (entriesResponse.error) {
    throw new Error(
      extractApiErrorMessage(
        entriesResponse.error,
        'Failed to sample diary entries',
      ),
    );
  }
  if (tagsResponse.error) {
    throw new Error(
      extractApiErrorMessage(tagsResponse.error, 'Failed to load diary tags'),
    );
  }

  const sampleEntries = (entriesResponse.data?.items ?? []).map(mapEntry);
  const now = new Date().toISOString();
  const explorationId = crypto.randomUUID();
  const stored: StoredExplorationState = {
    explorationId,
    sessionId,
    diaryId: args.diary_id,
    diaryName: diaryResponse.data.name,
    estimatedEntryCount: entriesResponse.data?.total ?? sampleEntries.length,
    sampleEntries,
    topTags: tagsResponse.data?.tags ?? countTagsFromEntries(sampleEntries),
    queryState: {
      query: null,
      includeTag: null,
      entryType: null,
    },
    visibleEntries: sampleEntries.slice(0, 60),
    createdAt: now,
    updatedAt: now,
  };
  await store.create(stored);
  return toOutput(stored);
}

async function handleExploreRefine(
  args: EntryExploreRefineInput,
  deps: McpDeps,
  store: ExplorationStore,
  token: string,
): Promise<EntryExploreOutput | null> {
  const next = await store.update(args.exploration_id, async (current) => {
    if (args.reset) {
      return {
        ...current,
        queryState: { query: null, includeTag: null, entryType: null },
        visibleEntries: current.sampleEntries.slice(0, 60),
        updatedAt: new Date().toISOString(),
      };
    }

    if (args.query) {
      const { data, error } = await searchDiary({
        client: deps.client,
        auth: () => token,
        body: {
          diaryId: current.diaryId,
          query: args.query,
          tags: args.include_tag ? [args.include_tag] : undefined,
          entryTypes: args.entry_type ? [args.entry_type] : undefined,
          limit: 60,
          wRelevance: 1,
          wRecency: 0.15,
          wImportance: 0.1,
        },
      });
      if (error || !data) {
        throw new Error(
          extractApiErrorMessage(error, 'Failed to refine exploration'),
        );
      }
      return {
        ...current,
        queryState: {
          query: args.query,
          includeTag: args.include_tag ?? null,
          entryType: args.entry_type ?? null,
        },
        visibleEntries: data.results.map(mapEntry),
        updatedAt: new Date().toISOString(),
      };
    }

    const { data, error } = await listDiaryEntries({
      client: deps.client,
      auth: () => token,
      path: { diaryId: current.diaryId },
      query: {
        limit: 60,
        offset: 0,
        tags: args.include_tag ? [args.include_tag] : undefined,
        entryType: args.entry_type ? [args.entry_type] : undefined,
      },
    });
    if (error) {
      throw new Error(
        extractApiErrorMessage(error, 'Failed to update visible entries'),
      );
    }

    return {
      ...current,
      queryState: {
        query: null,
        includeTag: args.include_tag ?? null,
        entryType: args.entry_type ?? null,
      },
      visibleEntries: (data?.items ?? []).map(mapEntry),
      updatedAt: new Date().toISOString(),
    };
  });

  return next ? toOutput(next) : null;
}

function buildEntryExploreAppHtml(): string {
  const hostBridgeScript = buildMcpAppHostBridgeScript({
    appName: 'MoltNet Entry Explorer',
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>MoltNet Entry Explorer</title>
    <style>
      :root { color-scheme: dark; font-family: Inter, sans-serif; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        background: #08080d;
        color: #e8e8f0;
      }
      main { display: grid; gap: 16px; padding: 16px; }
      header, section, aside {
        border: 1px solid #2a2a3e;
        border-radius: 16px;
        background: #0f0f17;
      }
      header {
        display: grid;
        gap: 12px;
        padding: 16px;
      }
      form {
        display: grid;
        gap: 8px;
        grid-template-columns: minmax(0, 1fr) auto auto;
      }
      input, button {
        min-height: 40px;
        border-radius: 12px;
        border: 1px solid #2a2a3e;
        background: #161622;
        color: #e8e8f0;
        font: inherit;
      }
      input { padding: 0 12px; }
      button { cursor: pointer; padding: 0 14px; }
      button.primary {
        background: #00d4c8;
        border-color: #00d4c8;
        color: #08080d;
        font-weight: 600;
      }
      .layout {
        display: grid;
        gap: 16px;
        grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr);
      }
      @media (max-width: 900px) {
        .layout { grid-template-columns: 1fr; }
      }
      #surface {
        min-height: 240px;
      }
      #surface .molt-explore-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
        gap: 16px;
      }
      #surface .molt-explore-main, #surface .molt-explore-side {
        display: grid;
        gap: 16px;
      }
      #surface .molt-chip-list, #surface .molt-chip-row {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      #surface .molt-chip-button, #surface .molt-tag-count, #surface .molt-cluster-card, #surface .molt-entry-tile {
        width: 100%;
        text-align: left;
        border: 1px solid #2a2a3e;
        background: #161622;
        color: inherit;
        border-radius: 14px;
        padding: 12px;
      }
      #surface .molt-chip-button { width: auto; display: grid; gap: 3px; }
      #surface .molt-chip-button span { color: #a0a0b8; font-size: 12px; }
      #surface .molt-entry-mosaic {
        display: grid;
        gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      }
      #surface .molt-timeline-bars {
        display: grid;
        gap: 10px;
      }
      #surface .molt-timeline-bar {
        display: grid;
        gap: 8px;
        grid-template-columns: 96px minmax(0, 1fr) auto;
        align-items: center;
        font-size: 12px;
      }
      #surface .molt-timeline-bar div {
        height: 8px;
        border-radius: 999px;
        background: #1c1c2e;
        overflow: hidden;
      }
      #surface .molt-timeline-bar em {
        display: block;
        height: 100%;
        border-radius: inherit;
        background: linear-gradient(90deg, #00d4c8, #e6a817);
      }
      aside { padding: 16px; }
      .muted { color: #a0a0b8; }
      .preview-empty { color: #a0a0b8; }
      .preview-tags { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 10px; }
      .preview-tag {
        padding: 4px 8px;
        border-radius: 999px;
        background: #161622;
        border: 1px solid #2a2a3e;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <div>
          <strong>MoltNet Entry Explorer</strong>
          <div id="status" class="muted">Connecting to host…</div>
        </div>
        <form id="search-form">
          <input id="search-input" placeholder="Refine this diary around a theme, idea, or question" />
          <button type="submit" class="primary">Refine</button>
          <button id="reset-button" type="button">Reset</button>
        </form>
      </header>
      <div class="layout">
        <section id="surface"></section>
        <aside>
          <div id="preview" class="preview-empty">Select an entry tile to inspect it without leaving the exploration.</div>
        </aside>
      </div>
    </main>
    <script type="module">
      ${hostBridgeScript}
      const app = createHostBridge();
      const statusEl = document.getElementById('status');
      const surfaceEl = document.getElementById('surface');
      const previewEl = document.getElementById('preview');
      const searchForm = document.getElementById('search-form');
      const searchInput = document.getElementById('search-input');
      const resetButton = document.getElementById('reset-button');
      let current = null;

      function extractPayload(result) {
        if (result?.structuredContent?.surface_state) return result.structuredContent;
        if (result?.surface_state) return result;
        return null;
      }

      function showPreview(entry) {
        if (!entry) {
          previewEl.className = 'preview-empty';
          previewEl.textContent = 'Select an entry tile to inspect it without leaving the exploration.';
          return;
        }
        previewEl.className = '';
        previewEl.innerHTML = '';
        const title = document.createElement('h2');
        title.textContent = entry.title || 'Untitled entry';
        const meta = document.createElement('div');
        meta.className = 'muted';
        meta.textContent = entry.entryType + ' · importance ' + entry.importance + ' · ' + new Date(entry.createdAt).toLocaleString();
        const body = document.createElement('p');
        body.textContent = entry.content;
        const tags = document.createElement('div');
        tags.className = 'preview-tags';
        for (const tag of entry.tags || []) {
          const pill = document.createElement('span');
          pill.className = 'preview-tag';
          pill.textContent = tag;
          tags.appendChild(pill);
        }
        previewEl.append(title, meta, body, tags);
      }

      function bindSurface() {
        surfaceEl.querySelectorAll('[data-entry-id]').forEach((button) => {
          button.addEventListener('click', () => {
            const entryId = button.getAttribute('data-entry-id');
            const entry = current?.surface_state?.visibleEntries?.find((item) => item.id === entryId);
            showPreview(entry || null);
          });
        });
        surfaceEl.querySelectorAll('[data-refine-kind]').forEach((button) => {
          button.addEventListener('click', async () => {
            const kind = button.getAttribute('data-refine-kind');
            const value = button.getAttribute('data-refine-value');
            if (!current?.exploration_id || !kind || !value) return;
            const args = { exploration_id: current.exploration_id };
            if (kind === 'tag') args.include_tag = value;
            if (kind === 'entry_type') args.entry_type = value;
            if (kind === 'query') args.query = value;
            statusEl.textContent = 'Refining…';
            const result = await app.callServerTool({ name: 'entries_explore_refine', arguments: args });
            const payload = extractPayload(result);
            if (payload) renderPayload(payload);
          });
        });
      }

      function renderPayload(payload) {
        current = payload;
        surfaceEl.innerHTML = payload.surface_html;
        statusEl.textContent = 'Exploration ready';
        bindSurface();
        showPreview(payload.surface_state.visibleEntries[0] || null);
      }

      searchForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (!current?.exploration_id) return;
        const query = searchInput.value.trim();
        if (!query) return;
        statusEl.textContent = 'Refining…';
        const result = await app.callServerTool({
          name: 'entries_explore_refine',
          arguments: { exploration_id: current.exploration_id, query },
        });
        const payload = extractPayload(result);
        if (payload) renderPayload(payload);
      });

      resetButton.addEventListener('click', async () => {
        if (!current?.exploration_id) return;
        statusEl.textContent = 'Resetting…';
        const result = await app.callServerTool({
          name: 'entries_explore_refine',
          arguments: { exploration_id: current.exploration_id, reset: true },
        });
        const payload = extractPayload(result);
        if (payload) {
          searchInput.value = '';
          renderPayload(payload);
        }
      });

      app.ontoolresult = (params) => {
        const payload = extractPayload(params?.result ?? params);
        if (payload) renderPayload(payload);
      };

      app.connect().then(() => {
        statusEl.textContent = 'Waiting for exploration…';
      }).catch((error) => {
        statusEl.textContent = error.message;
      });
    </script>
  </body>
</html>`;
}

function handleEntryExploreResource(): ReadResourceResult {
  return {
    contents: [
      {
        uri: ENTRY_EXPLORE_APP_RESOURCE_URI,
        mimeType: ENTRY_EXPLORE_APP_MIME_TYPE,
        text: buildEntryExploreAppHtml(),
      },
    ],
  };
}

export function registerEntryExploreApp(
  fastify: FastifyInstance,
  deps: McpDeps,
  store: ExplorationStore = new InMemoryExplorationStore(),
): void {
  fastify.mcpAddTool(
    {
      name: 'entries_explore_open',
      title: 'Open Entry Explorer',
      description:
        'Open the interactive MoltNet diary entry exploration app. Use it when a human wants a visual way to understand what is in a diary and where to narrow next.',
      inputSchema: EntryExploreOpenSchema,
      outputSchema: EntryExploreOutputSchema,
      _meta: {
        ui: {
          resourceUri: ENTRY_EXPLORE_APP_RESOURCE_URI,
          visibility: ['model', 'app'],
        },
      },
    },
    async (args: EntryExploreOpenInput, context) => {
      const token = getTokenFromContext(context);
      if (!token) return errorResult('Authentication required');
      try {
        const output = await handleExploreOpen(
          args,
          deps,
          store,
          token,
          getSessionIdFromHeaders(context.request?.headers),
        );
        return structuredResult(output);
      } catch (error) {
        return errorResult(
          extractApiErrorMessage(error, 'Failed to open entry exploration'),
        );
      }
    },
  );

  fastify.mcpAddTool(
    {
      name: 'entries_explore_refine',
      title: 'Refine Entry Explorer',
      description:
        'Refine an existing transient diary exploration. Accepts natural-language queries, tags, or entry-type pivots, which makes it suitable for LLM-assisted iterative narrowing.',
      inputSchema: EntryExploreRefineSchema,
      outputSchema: EntryExploreOutputSchema,
    },
    async (args: EntryExploreRefineInput, context) => {
      const token = getTokenFromContext(context);
      if (!token) return errorResult('Authentication required');
      try {
        const output = await handleExploreRefine(args, deps, store, token);
        if (!output) return errorResult('Exploration not found');
        return structuredResult(output);
      } catch (error) {
        return errorResult(
          extractApiErrorMessage(error, 'Failed to refine entry exploration'),
        );
      }
    },
  );

  fastify.mcpAddResource(
    {
      name: 'entries-explore-app',
      title: 'MoltNet Entry Explorer',
      uriPattern: ENTRY_EXPLORE_APP_RESOURCE_URI,
      description:
        'Interactive MCP App for visual diary entry exploration and narrowing.',
      mimeType: ENTRY_EXPLORE_APP_MIME_TYPE,
      _meta: ENTRY_EXPLORE_APP_RESOURCE_META,
    },
    () => handleEntryExploreResource(),
  );
}
