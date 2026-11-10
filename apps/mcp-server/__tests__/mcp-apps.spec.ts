/**
 * The MCP Apps surfaces served through the official SDK: the configured
 * sandbox metadata must reach hosts on `resources/read`, which they prefer
 * over the listing, and each app tool must point at its resource.
 */
import { createMcpHandler } from '@modelcontextprotocol/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn().mockResolvedValue('<!doctype html><title>app</title>'),
  },
}));

vi.mock('../src/mcp-app-ui.js', async (importOriginal) => ({
  ...(await importOriginal<typeof McpAppUi>()),
  resolveInstalledMcpAppHtmlPath: () => '/virtual/dist/index.html',
}));

import {
  ENTRY_MAP_APP_RESOURCE_URI,
  registerEntryExploreApp,
} from '../src/entry-explore-app.js';
import type * as McpAppUi from '../src/mcp-app-ui.js';
import { McpRegistry } from '../src/mcp-registry.js';
import { registerTaskApp, TASK_APP_RESOURCE_URI } from '../src/task-app.js';

const SANDBOX = {
  domain: 'https://mcp.example.com',
  connectDomains: ['https://api.example.com'],
  resourceDomains: ['https://cdn.example.com'],
  frameDomains: [],
};

const EXPECTED_UI = {
  domain: SANDBOX.domain,
  csp: {
    connectDomains: SANDBOX.connectDomains,
    resourceDomains: SANDBOX.resourceDomains,
    frameDomains: [],
  },
  prefersBorder: false,
};

async function rpc<T>(
  registry: McpRegistry,
  method: string,
  params: Record<string, unknown> = {},
): Promise<T> {
  const handler = createMcpHandler(() =>
    registry.createServer({ name: 'test', version: '0.0.0' }),
  );
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    }),
  );
  const text = await response.text();
  await handler.close();
  const json = text.startsWith('{')
    ? text
    : (text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice('data: '.length) ?? '');
  return (JSON.parse(json) as { result: T }).result;
}

function appRegistry(): McpRegistry {
  const registry = new McpRegistry({ mcpAppConfig: SANDBOX });
  registerTaskApp(registry, {});
  registerEntryExploreApp(registry);
  return registry;
}

describe.each([
  ['tasks', TASK_APP_RESOURCE_URI, 'tasks_app_open'],
  ['diary map', ENTRY_MAP_APP_RESOURCE_URI, 'entries_map_open'],
])('%s MCP App', (_label, uri, toolName) => {
  it('serves the configured sandbox metadata on resources/read', async () => {
    const result = await rpc<{
      contents: Array<{ uri: string; _meta?: { ui?: unknown } }>;
    }>(appRegistry(), 'resources/read', { uri });

    expect(result.contents).toHaveLength(1);
    expect(result.contents[0]?.uri).toBe(uri);
    expect(result.contents[0]?._meta?.ui).toEqual(EXPECTED_UI);
  });

  it('lists the resource with the same sandbox metadata', async () => {
    const result = await rpc<{
      resources: Array<{ uri: string; _meta?: { ui?: unknown } }>;
    }>(appRegistry(), 'resources/list');

    const resource = result.resources.find((item) => item.uri === uri);
    expect(resource?._meta?.ui).toEqual(EXPECTED_UI);
  });

  it('links the opener tool to the resource for current and older hosts', async () => {
    const result = await rpc<{
      tools: Array<{ name: string; _meta?: Record<string, unknown> }>;
    }>(appRegistry(), 'tools/list');

    const tool = result.tools.find((item) => item.name === toolName);
    expect(tool?._meta).toMatchObject({
      ui: { resourceUri: uri, visibility: ['model', 'app'] },
      'ui/resourceUri': uri,
    });
  });
});
