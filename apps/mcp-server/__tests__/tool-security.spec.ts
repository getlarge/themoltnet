import { createMcpHandler } from '@modelcontextprotocol/server';
import { MCP_CLIENT_SCOPES } from '@moltnet/models';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { McpRegistry } from '../src/mcp-registry.js';
import {
  insufficientScopeChallenge,
  missingScopeFromResult,
  oauthScopes,
  withScopeChallenge,
} from '../src/tool-security.js';
import type { CallToolResult } from '../src/types.js';
import { errorResult, textResult } from '../src/utils.js';
import { createMockDeps } from './helpers.js';

const RESOURCE_URI = 'https://mcp.example.test';
const MCP_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

interface ListedTool {
  name: string;
  _meta?: Record<string, unknown>;
}

/** Last JSON-RPC message of a JSON or SSE MCP response body. */
function lastMessage(body: string, contentType: string) {
  if (!contentType.includes('text/event-stream')) return JSON.parse(body);
  const data = body
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice('data:'.length).trim())
    .filter(Boolean);
  return JSON.parse(data[data.length - 1] ?? '{}');
}

async function listTools(): Promise<ListedTool[]> {
  const app = await buildApp({
    config: {
      PORT: 8001,
      NODE_ENV: 'test',
      REST_API_URL: 'http://localhost:3000',
    },
    deps: createMockDeps(),
    logger: false,
  });
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: MCP_HEADERS,
      payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    });
    expect(response.statusCode).toBe(200);
    return lastMessage(response.body, String(response.headers['content-type']))
      .result.tools as ListedTool[];
  } finally {
    await app.close();
  }
}

function tool(name: string, scopes: Parameters<typeof oauthScopes>) {
  return {
    name,
    description: name,
    inputSchema: Type.Object({}),
    _meta: { securitySchemes: oauthScopes(...scopes) },
  };
}

/** Call one tool through the SDK's real HTTP handler, without Fastify. */
async function callTool(
  registry: McpRegistry,
  name: string,
  scopes?: string[],
): Promise<CallToolResult> {
  const handler = createMcpHandler(() =>
    registry.createServer({ name: 'test', version: '0.0.0' }),
  );
  const response = await handler.fetch(
    new Request('http://localhost/mcp', {
      method: 'POST',
      headers: MCP_HEADERS,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name, arguments: {} },
      }),
    }),
    scopes
      ? { authInfo: { token: 'test-token', clientId: 'test-client', scopes } }
      : undefined,
  );
  const message = lastMessage(
    await response.text(),
    response.headers.get('content-type') ?? '',
  );
  await handler.close();
  return message.result as CallToolResult;
}

describe('MCP tool securitySchemes', () => {
  it('publishes every tool scheme in _meta', async () => {
    const tools = await listTools();

    for (const listed of tools) {
      expect(listed._meta?.securitySchemes, listed.name).toEqual([
        { type: 'oauth2', scopes: expect.any(Array) },
      ]);
    }
  });

  it('asks for diary:read on the diary read tools (issue #2967)', async () => {
    const tools = await listTools();
    const byName = new Map(tools.map((listed) => [listed.name, listed]));

    for (const name of [
      'diaries_list',
      'diaries_get',
      'entries_list',
      'entries_search',
    ]) {
      expect(byName.get(name)?._meta?.securitySchemes, name).toEqual(
        oauthScopes('diary:read'),
      );
    }
  });

  it('only declares scopes a self-registered MCP client may hold', async () => {
    const tools = await listTools();

    const declared = tools.flatMap(
      (listed) =>
        (listed._meta?.securitySchemes as Array<{ scopes: string[] }>)[0]
          ?.scopes ?? [],
    );

    for (const scope of declared) {
      expect(MCP_CLIENT_SCOPES as readonly string[]).toContain(scope);
    }
  });

  it('keeps the existing _meta of app tools', async () => {
    const tools = await listTools();

    const mapOpener = tools.find(
      (listed) => listed.name === 'entries_map_open',
    );

    expect(mapOpener?._meta).toEqual(
      expect.objectContaining({
        securitySchemes: oauthScopes(),
        ui: expect.anything(),
      }),
    );
  });
});

describe('missingScopeFromResult', () => {
  it('reads the scope out of a flattened REST scope denial', () => {
    const result = errorResult('Missing required scope: diary:read');

    expect(missingScopeFromResult(result)).toBe('diary:read');
  });

  it('ignores successful results and unrelated errors', () => {
    expect(
      missingScopeFromResult(
        textResult({ note: 'Missing required scope: diary:read' }),
      ),
    ).toBeNull();
    expect(missingScopeFromResult(errorResult('Diary not found'))).toBeNull();
  });

  it('ignores scopes outside the MCP scope set', () => {
    const result = errorResult('Missing required scope: key:manage');

    expect(missingScopeFromResult(result)).toBeNull();
  });
});

describe('insufficientScopeChallenge', () => {
  it('builds an RFC 6750 challenge asking for the given tool scopes', () => {
    const challenge = insufficientScopeChallenge(RESOURCE_URI, 'diary:read', [
      'diary:read',
      'team:read',
    ]);

    expect(challenge).toBe(
      `Bearer resource_metadata="${RESOURCE_URI}/.well-known/oauth-protected-resource", ` +
        'error="insufficient_scope", ' +
        'scope="diary:read team:read", ' +
        'error_description="This connection was not granted diary:read. Reconnect MoltNet to grant it."',
    );
  });
});

describe('withScopeChallenge', () => {
  it('passes other results through untouched', () => {
    const ok = textResult({ items: [] });
    const notFound = errorResult('Diary not found');

    expect(withScopeChallenge(ok, RESOURCE_URI, ['diary:read'])).toBe(ok);
    expect(withScopeChallenge(notFound, RESOURCE_URI, ['diary:read'])).toBe(
      notFound,
    );
  });
});

describe('McpRegistry tool policies', () => {
  it('rejects a tool that declares no securitySchemes', () => {
    const registry = new McpRegistry();

    expect(() =>
      registry.mcpAddTool(
        { name: 'diaries_list', inputSchema: Type.Object({}) },
        () => textResult({}),
      ),
    ).toThrow('MCP tool diaries_list must declare _meta.securitySchemes');
  });

  it('rejects a tool without an annotation policy', () => {
    const registry = new McpRegistry();

    expect(() =>
      registry.mcpAddTool(tool('future_unclassified_tool', []), () =>
        textResult({}),
      ),
    ).toThrow(
      'Missing MCP tool annotation policy for future_unclassified_tool',
    );
  });

  it('collects the scopes every registered tool declares', () => {
    const registry = new McpRegistry();

    registry.mcpAddTool(tool('diaries_list', ['diary:read']), () =>
      textResult({}),
    );
    registry.mcpAddTool(tool('teams_list', ['team:read']), () =>
      textResult({}),
    );

    expect([...registry.toolScopes]).toEqual(['diary:read', 'team:read']);
  });

  it('attaches a challenge asking for every registered tool scope', async () => {
    // Arrange
    const registry = new McpRegistry({ resourceUri: RESOURCE_URI });
    registry.mcpAddTool(tool('diaries_list', ['diary:read']), () =>
      errorResult('Missing required scope: diary:read'),
    );
    registry.mcpAddTool(tool('teams_list', ['team:read']), () =>
      textResult({}),
    );

    // Act
    const result = await callTool(registry, 'diaries_list');

    // Assert
    expect(result.isError).toBe(true);
    expect(result._meta?.['mcp/www_authenticate']).toEqual([
      insufficientScopeChallenge(RESOURCE_URI, 'diary:read', [
        'diary:read',
        'team:read',
      ]),
    ]);
  });

  it('adds no challenge when authorization is disabled', async () => {
    const registry = new McpRegistry();
    registry.mcpAddTool(tool('diaries_list', ['diary:read']), () =>
      errorResult('Missing required scope: diary:read'),
    );

    const result = await callTool(registry, 'diaries_list');

    expect(result.isError).toBe(true);
    expect(result._meta?.['mcp/www_authenticate']).toBeUndefined();
  });

  it('refuses a token lacking a declared scope without calling the handler', async () => {
    // Arrange
    const registry = new McpRegistry({ resourceUri: RESOURCE_URI });
    const handler = vi.fn(() => textResult({ items: [] }));
    registry.mcpAddTool(tool('diaries_list', ['diary:read']), handler);

    // Act
    const result = await callTool(registry, 'diaries_list', ['openid']);

    // Assert
    expect(handler).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([
      {
        type: 'text',
        text: JSON.stringify({ error: 'Missing required scope: diary:read' }),
      },
    ]);
    expect(result._meta?.['mcp/www_authenticate']).toEqual([
      insufficientScopeChallenge(RESOURCE_URI, 'diary:read', ['diary:read']),
    ]);
  });

  it('calls the handler when the token carries the declared scopes', async () => {
    const registry = new McpRegistry({ resourceUri: RESOURCE_URI });
    const handler = vi.fn(() => textResult({ items: [] }));
    registry.mcpAddTool(tool('diaries_list', ['diary:read']), handler);

    const result = await callTool(registry, 'diaries_list', [
      'openid',
      'diary:read',
    ]);

    expect(handler).toHaveBeenCalledOnce();
    expect(result.isError).toBeFalsy();
  });

  it('still challenges a REST denial beyond the declared scopes', async () => {
    const registry = new McpRegistry({ resourceUri: RESOURCE_URI });
    registry.mcpAddTool(tool('diaries_list', ['diary:read']), () =>
      errorResult('Missing required scope: team:read'),
    );

    const result = await callTool(registry, 'diaries_list', ['diary:read']);

    expect(result._meta?.['mcp/www_authenticate']).toEqual([
      insufficientScopeChallenge(RESOURCE_URI, 'team:read', ['diary:read']),
    ]);
  });
});
