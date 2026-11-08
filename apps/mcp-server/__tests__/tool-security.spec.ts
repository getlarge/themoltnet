import type { ToolHandler } from '@getlarge/fastify-mcp';
import { MCP_CLIENT_SCOPES } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  installToolSecurityPolicy,
  insufficientScopeChallenge,
  MCP_TOOL_SCOPES,
  missingScopeFromResult,
  securitySchemesForTool,
} from '../src/tool-security.js';
import type { CallToolResult } from '../src/types.js';
import { errorResult, textResult } from '../src/utils.js';
import { createMockDeps } from './helpers.js';

const RESOURCE_URI = 'https://mcp.example.test';

interface ListedTool {
  name: string;
  securitySchemes?: unknown;
  _meta?: Record<string, unknown>;
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
      headers: { 'content-type': 'application/json' },
      payload: { jsonrpc: '2.0', method: 'tools/list', id: 1 },
    });
    expect(response.statusCode).toBe(200);
    return JSON.parse(response.body).result.tools as ListedTool[];
  } finally {
    await app.close();
  }
}

/** Minimal stand-in for the plugin's `mcpAddTool` registry. */
function fakeApp() {
  const registered = new Map<
    string,
    { definition: Record<string, unknown>; handler?: ToolHandler }
  >();
  const app = {
    mcpAddTool: (definition: Record<string, unknown>, handler?: ToolHandler) =>
      registered.set(definition.name as string, { definition, handler }),
  } as unknown as FastifyInstance;
  return { app, registered };
}

const handlerContext = {} as Parameters<ToolHandler>[1];

describe('MCP tool security policy', () => {
  it('declares OAuth securitySchemes on every tool, top-level and in _meta', async () => {
    // Arrange
    const tools = await listTools();

    // Act
    const missing = tools.filter(
      (tool) =>
        !Array.isArray(tool.securitySchemes) ||
        tool._meta?.securitySchemes === undefined,
    );

    // Assert
    expect(missing.map((tool) => tool.name)).toEqual([]);
    for (const tool of tools) {
      expect(tool.securitySchemes, tool.name).toEqual([
        { type: 'oauth2', scopes: expect.any(Array) },
      ]);
      expect(tool._meta?.securitySchemes, tool.name).toEqual(
        tool.securitySchemes,
      );
    }
  });

  it('keeps the existing _meta of app tools', async () => {
    const tools = await listTools();

    const mapOpener = tools.find((tool) => tool.name === 'entries_map_open');

    expect(mapOpener?._meta).toEqual(
      expect.objectContaining({
        securitySchemes: [{ type: 'oauth2', scopes: [] }],
        ui: expect.anything(),
      }),
    );
  });

  it('asks for diary:read on the diary read tools (issue #2967)', () => {
    for (const name of [
      'diaries_list',
      'diaries_get',
      'entries_list',
      'entries_search',
    ]) {
      expect(securitySchemesForTool(name), name).toEqual([
        { type: 'oauth2', scopes: ['diary:read'] },
      ]);
    }
  });

  it('only declares scopes a self-registered MCP client may hold', async () => {
    const tools = await listTools();

    const declared = new Set(
      tools.flatMap(
        (tool) =>
          (tool.securitySchemes as Array<{ scopes: string[] }>)[0]?.scopes ??
          [],
      ),
    );

    for (const scope of declared) {
      expect(MCP_CLIENT_SCOPES as readonly string[]).toContain(scope);
    }
    expect([...declared].sort()).toEqual([...MCP_TOOL_SCOPES].sort());
  });

  it('rejects tools without an explicit security policy', () => {
    expect(() => securitySchemesForTool('future_unclassified_tool')).toThrow(
      'Missing MCP tool security policy for future_unclassified_tool',
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
  it('builds an RFC 6750 challenge that asks for every MCP tool scope', () => {
    const challenge = insufficientScopeChallenge(RESOURCE_URI, 'diary:read');

    expect(challenge).toBe(
      `Bearer resource_metadata="${RESOURCE_URI}/.well-known/oauth-protected-resource", ` +
        'error="insufficient_scope", ' +
        `scope="${MCP_TOOL_SCOPES.join(' ')}", ` +
        'error_description="This connection was not granted diary:read. Reconnect MoltNet to grant it."',
    );
    expect(MCP_TOOL_SCOPES).toContain('diary:read');
  });
});

describe('installToolSecurityPolicy', () => {
  const definition = {
    name: 'diaries_list',
    description: 'List diaries',
    inputSchema: Type.Object({}),
  };

  it('attaches an insufficient_scope challenge to scope denials', async () => {
    // Arrange
    const { app, registered } = fakeApp();
    installToolSecurityPolicy(app, { resourceUri: RESOURCE_URI });
    app.mcpAddTool(definition, async () =>
      errorResult('Missing required scope: diary:read'),
    );

    // Act
    const result = (await registered.get('diaries_list')!.handler!(
      {},
      handlerContext,
    )) as CallToolResult;

    // Assert
    expect(result.isError).toBe(true);
    expect(result._meta?.['mcp/www_authenticate']).toEqual([
      insufficientScopeChallenge(RESOURCE_URI, 'diary:read'),
    ]);
  });

  it('passes other results through untouched', async () => {
    const { app, registered } = fakeApp();
    installToolSecurityPolicy(app, { resourceUri: RESOURCE_URI });
    const ok = textResult({ items: [] });
    const notFound = errorResult('Diary not found');
    const handler = vi
      .fn<ToolHandler>()
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(notFound);
    app.mcpAddTool(definition, handler);
    const registeredHandler = registered.get('diaries_list')!.handler!;

    expect(await registeredHandler({}, handlerContext)).toBe(ok);
    expect(await registeredHandler({}, handlerContext)).toBe(notFound);
  });

  it('adds no challenge when authorization is disabled', async () => {
    const { app, registered } = fakeApp();
    installToolSecurityPolicy(app, {});
    const denial = errorResult('Missing required scope: diary:read');
    app.mcpAddTool(definition, async () => denial);

    const result = await registered.get('diaries_list')!.handler!(
      {},
      handlerContext,
    );

    expect(result).toBe(denial);
  });
});
