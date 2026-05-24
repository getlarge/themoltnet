import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue(`<!doctype html>
<html lang="en">
  <head><title>MoltNet Entry Explore</title></head>
  <body><div id="root"></div></body>
</html>`),
  },
}));

vi.mock('../src/mcp-app-ui.js', () => ({
  MCP_APP_RESOURCE_MIME_TYPE: 'text/html;profile=mcp-app',
  createMcpAppResourceMeta: () => ({
    ui: {
      csp: { connectDomains: [], resourceDomains: [], frameDomains: [] },
      prefersBorder: false,
    },
  }),
  createMcpAppToolMeta: (resourceUri: string) => ({
    ui: { resourceUri, visibility: ['model', 'app'] },
  }),
  resolveInstalledMcpAppHtmlPath: () =>
    '/virtual/entry-explore-mcp-app/dist/index.html',
}));

import {
  ENTRY_MAP_APP_MIME_TYPE,
  ENTRY_MAP_APP_RESOURCE_URI,
  handleEntriesMapOpen,
  handleEntriesMapResource,
} from '../src/entry-explore-app.js';
import { parseResult } from './helpers.js';

const DIARY_ID = '6e4d9948-8ec5-4f59-b82a-3acbc4bbc396';

describe('Entry Explore (diary map) MCP App', () => {
  it('opens with the diary id, default sample limit, and the tool allowlist', () => {
    const result = handleEntriesMapOpen({ diary_id: DIARY_ID });

    const parsed = parseResult<{
      app: string;
      resourceUri: string;
      diaryId: string;
      sampleLimit: number;
      framing?: string;
      tools: string[];
    }>(result);

    expect(parsed).toMatchObject({
      app: 'moltnet_entry_explore',
      resourceUri: ENTRY_MAP_APP_RESOURCE_URI,
      diaryId: DIARY_ID,
      sampleLimit: 96,
    });
    expect(parsed).not.toHaveProperty('framing');
    // The app may only call deterministic read tools + the packs tools.
    expect(parsed.tools).toEqual(
      expect.arrayContaining([
        'entries_list',
        'entries_search',
        'diary_tags',
        'packs_create',
        'packs_update',
      ]),
    );
    expect(result.structuredContent).toMatchObject(parsed);
  });

  it('echoes an explicit sample limit and framing', () => {
    const result = handleEntriesMapOpen({
      diary_id: DIARY_ID,
      sample_limit: 120,
      framing: 'Remind me what we decided about auth.',
    });

    const parsed = parseResult<{ sampleLimit: number; framing?: string }>(
      result,
    );
    expect(parsed.sampleLimit).toBe(120);
    expect(parsed.framing).toBe('Remind me what we decided about auth.');
  });

  it('flattens a caller-supplied map onto the output for first-paint zones', () => {
    const result = handleEntriesMapOpen({
      diary_id: DIARY_ID,
      map: {
        diaryName: 'themoltnet',
        totalEntries: 2000,
        sampledEntries: 96,
        overview: 'Three zones stand out.',
        zones: [{ id: 'z1', label: 'Infra', entryIds: ['e1'] }],
      },
    });

    const parsed = parseResult<{
      diaryName: string;
      totalEntries: number;
      overview: string;
      zones: unknown[];
    }>(result);

    expect(parsed.diaryName).toBe('themoltnet');
    expect(parsed.totalEntries).toBe(2000);
    expect(parsed.overview).toBe('Three zones stand out.');
    expect(parsed.zones).toHaveLength(1);
  });

  it('omits map fields when no map is supplied (opens in waiting state)', () => {
    const parsed = parseResult<Record<string, unknown>>(
      handleEntriesMapOpen({ diary_id: DIARY_ID }),
    );
    expect(parsed).not.toHaveProperty('zones');
    expect(parsed).not.toHaveProperty('overview');
  });

  it('serves the single-file app HTML with CSP metadata', async () => {
    const result = await handleEntriesMapResource();
    const content = result.contents[0] as {
      uri: string;
      mimeType: string;
      text: string;
      _meta?: Record<string, unknown>;
    };

    expect(content.uri).toBe(ENTRY_MAP_APP_RESOURCE_URI);
    expect(content.mimeType).toBe(ENTRY_MAP_APP_MIME_TYPE);
    expect(content.text).toContain('<div id="root"></div>');
    expect(content._meta).toMatchObject({
      ui: {
        csp: { connectDomains: [], resourceDomains: [] },
        prefersBorder: false,
      },
    });
  });
});
