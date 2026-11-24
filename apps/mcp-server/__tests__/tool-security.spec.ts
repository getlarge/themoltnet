import type { ToolHandler } from '@getlarge/fastify-mcp';
import { MCP_CLIENT_SCOPES } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { Type } from 'typebox';
import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import {
  installToolSecurityPolicy,
  insufficientScopeChallenge,
  missingScopeFromResult,
  oauthScopes,
} from '../src/tool-security.js';
import type { CallToolResult } from '../src/types.js';
import { errorResult, textResult } from '../src/utils.js';
import { createMockDeps } from './helpers.js';

const RESOURCE_URI = 'https://mcp.example.test';

interface ListedTool {
  name: string;
  securitySchemes?: Array<{ type: string; scopes: string[] }>;
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

function tool(name: string, scopes: Parameters<typeof oauthScopes>) {
  return {
    name,
    description: name,
    inputSchema: Type.Object({}),
    _meta: { securitySchemes: oauthScopes(...scopes) },
  };
}

const handlerContext = {} as Parameters<ToolHandler>[1];

describe('MCP tool securitySchemes', () => {
  it('publishes every tool scheme top-level and in _meta', async () => {
    const tools = await listTools();

    for (const listed of tools) {
      expect(listed.securitySchemes, listed.name).toEqual([
        { type: 'oauth2', scopes: expect.any(Array) },
      ]);
      expect(listed._meta?.securitySchemes, listed.name).toEqual(
        listed.securitySchemes,
      );
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
      expect(byName.get(name)?.securitySchemes, name).toEqual(
        oauthScopes('diary:read'),
      );
    }
  });

  it('only declares scopes a self-registered MCP client may hold', async () => {
    const tools = await listTools();

    const declared = tools.flatMap(
      (listed) => listed.securitySchemes?.[0]?.scopes ?? [],
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

describe('installToolSecurityPolicy', () => {
  it('rejects a tool that declares no securitySchemes', () => {
    const { app } = fakeApp();
    installToolSecurityPolicy(app, { resourceUri: RESOURCE_URI });

    expect(() =>
      app.mcpAddTool(
        { name: 'undeclared', description: 'x', inputSchema: Type.Object({}) },
        async () => textResult({}),
      ),
    ).toThrow('MCP tool undeclared must declare _meta.securitySchemes');
  });

  it('copies _meta.securitySchemes to the top-level field', () => {
    const { app, registered } = fakeApp();
    installToolSecurityPolicy(app, { resourceUri: RESOURCE_URI });

    app.mcpAddTool(tool('diaries_list', ['diary:read']), async () =>
      textResult({}),
    );

    expect(registered.get('diaries_list')?.definition.securitySchemes).toEqual(
      oauthScopes('diary:read'),
    );
  });

  it('attaches a challenge asking for every registered tool scope', async () => {
    // Arrange
    const { app, registered } = fakeApp();
    installToolSecurityPolicy(app, { resourceUri: RESOURCE_URI });
    app.mcpAddTool(tool('diaries_list', ['diary:read']), async () =>
      errorResult('Missing required scope: diary:read'),
    );
    app.mcpAddTool(tool('teams_list', ['team:read']), async () =>
      textResult({}),
    );

    // Act
    const result = (await registered.get('diaries_list')!.handler!(
      {},
      handlerContext,
    )) as CallToolResult;

    // Assert
    expect(result.isError).toBe(true);
    expect(result._meta?.['mcp/www_authenticate']).toEqual([
      insufficientScopeChallenge(RESOURCE_URI, 'diary:read', [
        'diary:read',
        'team:read',
      ]),
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
    app.mcpAddTool(tool('diaries_list', ['diary:read']), handler);
    const registeredHandler = registered.get('diaries_list')!.handler!;

    expect(await registeredHandler({}, handlerContext)).toBe(ok);
    expect(await registeredHandler({}, handlerContext)).toBe(notFound);
  });

  it('adds no challenge when authorization is disabled', async () => {
    const { app, registered } = fakeApp();
    installToolSecurityPolicy(app, {});
    const denial = errorResult('Missing required scope: diary:read');
    app.mcpAddTool(tool('diaries_list', ['diary:read']), async () => denial);

    const result = await registered.get('diaries_list')!.handler!(
      {},
      handlerContext,
    );

    expect(result).toBe(denial);
  });
});
