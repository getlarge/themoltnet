import { createHash } from 'node:crypto';

import { describe, expect, it, type Mock, vi } from 'vitest';

import pkg from '../package.json' with { type: 'json' };
import { buildApp } from '../src/app.js';
import { createMockDeps } from './helpers.js';

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalJson);
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, canonicalJson(child)]),
    );
  }

  return value;
}

function schemaFingerprint(schema: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJson(schema ?? {})))
    .digest('hex')
    .slice(0, 16);
}

function collectNamedSchemaIds(
  value: unknown,
  ids: Set<string> = new Set(),
  seen: WeakSet<object> = new WeakSet(),
): Set<string> {
  if (!value || typeof value !== 'object') return ids;

  if (seen.has(value as object)) return ids;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const item of value) collectNamedSchemaIds(item, ids, seen);
    return ids;
  }

  const record = value as Record<string, unknown>;
  if (typeof record.$id === 'string') {
    ids.add(record.$id);
  }

  for (const child of Object.values(record)) {
    collectNamedSchemaIds(child, ids, seen);
  }

  return ids;
}

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: vi.fn(),
  getDiaryEntryById: vi.fn(),
  listDiaryEntries: vi.fn(),
  searchDiary: vi.fn(),
  updateDiaryEntryById: vi.fn(),
  deleteDiaryEntryById: vi.fn(),
  verifyDiaryEntryById: vi.fn(),
  listDiaries: vi.fn(),
  createDiary: vi.fn(),
  getDiary: vi.fn(),
  getCryptoIdentity: vi.fn(),
  verifyCryptoSignature: vi.fn(),
  getWhoami: vi.fn(),
  getAgentProfile: vi.fn(),
  issueVoucher: vi.fn(),
  listActiveVouchers: vi.fn(),
  getTrustGraph: vi.fn(),
  listTaskSchemas: vi.fn(),
  createTask: vi.fn(),
  getTask: vi.fn(),
  listTasks: vi.fn(),
  listTaskAttempts: vi.fn(),
  listTaskMessages: vi.fn(),
}));

describe('buildApp', () => {
  it('creates a Fastify instance with healthz endpoint', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('status', 'ok');
    expect(body).toHaveProperty('timestamp');

    await app.close();
  });

  it('registers MCP tools (POST /mcp responds)', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      version: pkg.version,
      logger: false,
    });

    // An initialize request to /mcp should be handled by the plugin
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        id: 1,
      },
    });

    // The plugin should handle this (200 with JSON-RPC response)
    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('jsonrpc', '2.0');
    expect(body).toHaveProperty('result');
    expect(body.result.serverInfo).toHaveProperty('name', 'moltnet');
    expect(body.result.serverInfo).toHaveProperty('version', pkg.version);

    await app.close();
  });

  it('builds with auth disabled by default', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    // Without auth, MCP endpoints should be accessible without tokens
    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        id: 1,
      },
    });

    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it('does not register auth proxy when CLIENT_CREDENTIALS_PROXY is false', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
        CLIENT_CREDENTIALS_PROXY: false,
        ORY_PROJECT_URL: 'https://hydra.example.com',
      },
      deps,
      logger: false,
    });

    // Should work without any OIDC discovery calls
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    await app.close();
  });

  it('registers auth proxy when CLIENT_CREDENTIALS_PROXY is true', async () => {
    const fetchSpy: Mock = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    // Mock OIDC discovery (called during plugin registration)
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () =>
        Promise.resolve({
          token_endpoint: 'https://hydra.example.com/oauth2/token',
          issuer: 'https://hydra.example.com/',
        }),
    });

    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
        CLIENT_CREDENTIALS_PROXY: true,
        ORY_PROJECT_URL: 'https://hydra.example.com',
      },
      deps,
      logger: false,
    });

    // OIDC discovery should have been called during registration
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://hydra.example.com/.well-known/openid-configuration',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );

    // App should still work — healthz bypasses auth
    const response = await app.inject({
      method: 'GET',
      url: '/healthz',
    });

    expect(response.statusCode).toBe(200);
    await app.close();
    vi.restoreAllMocks();
  });

  it('resources/list returns only concrete resources', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'resources/list',
        id: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const resources = body.result.resources;

    // Only concrete resources (no {param} in URI)
    for (const r of resources) {
      expect(r.uri).not.toMatch(/\{[^}]+\}/);
    }
    // identity and entries-recent are concrete
    const names = resources.map((r: { name: string }) => r.name);
    expect(names).toContain('identity');
    expect(names).toContain('entries-recent');
    // template resources should NOT be here
    expect(names).not.toContain('diary-entry');
    expect(names).not.toContain('agent-profile');

    await app.close();
  });

  it('resources/templates/list returns only template resources with uriTemplate', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'resources/templates/list',
        id: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const templates = body.result.resourceTemplates;

    // diary-entry and agent-profile are templates
    const names = templates.map((r: { name: string }) => r.name);
    expect(names).toContain('diary-entry');
    expect(names).toContain('agent-profile');
    // concrete resources should NOT be here
    expect(names).not.toContain('identity');
    expect(names).not.toContain('diary-recent');

    // Each template has uriTemplate (not uri)
    for (const t of templates) {
      expect(t).toHaveProperty('uriTemplate');
      expect(t).not.toHaveProperty('uri');
      expect(t.uriTemplate).toMatch(/\{[^}]+\}/);
    }

    await app.close();
  });

  it('registers tools with correct names', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const toolNames = body.result.tools.map((t: { name: string }) => t.name);

    // entries tools
    expect(toolNames).toContain('entries_create');
    expect(toolNames).toContain('entries_get');
    expect(toolNames).toContain('entries_list');
    expect(toolNames).toContain('entries_search');
    expect(toolNames).toContain('entries_update');
    expect(toolNames).toContain('entries_delete');
    // diary catalog tools
    expect(toolNames).toContain('diaries_list');
    expect(toolNames).toContain('diaries_create');
    expect(toolNames).toContain('diaries_get');
    // task tools
    expect(toolNames).toContain('tasks_schemas');
    expect(toolNames).toContain('tasks_create');
    expect(toolNames).toContain('tasks_get');
    expect(toolNames).toContain('tasks_list');
    expect(toolNames).toContain('tasks_attempts_list');
    expect(toolNames).toContain('tasks_messages_list');
    expect(toolNames).toContain('tasks_console_link');
    // old names must NOT appear
    expect(toolNames).not.toContain('diary_create');
    expect(toolNames).not.toContain('diary_get');
    expect(toolNames).not.toContain('diary_list');
    expect(toolNames).not.toContain('diary_search');
    expect(toolNames).not.toContain('diary_update');
    expect(toolNames).not.toContain('diary_delete');

    await app.close();
  });

  it('exposes the expected MCP tool contract', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const contract = (
      body.result.tools as Array<{ name: string; inputSchema?: unknown }>
    )
      .map((tool) => ({
        name: tool.name,
        inputSchema: schemaFingerprint(tool.inputSchema),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(contract).toMatchInlineSnapshot(`
      [
        {
          "inputSchema": "0ab9955c191582ff",
          "name": "agent_lookup",
        },
        {
          "inputSchema": "56de8ac2e1fa313d",
          "name": "crypto_prepare_signature",
        },
        {
          "inputSchema": "dfdff9c8d53e987a",
          "name": "crypto_signing_status",
        },
        {
          "inputSchema": "578b0eeede8a4fd3",
          "name": "crypto_submit_signature",
        },
        {
          "inputSchema": "ad95c699c2f3918a",
          "name": "crypto_verify",
        },
        {
          "inputSchema": "2c6eaaef8f037305",
          "name": "diaries_create",
        },
        {
          "inputSchema": "f69fa72afef3cc0b",
          "name": "diaries_get",
        },
        {
          "inputSchema": "efddc7bd8bbcef73",
          "name": "diaries_list",
        },
        {
          "inputSchema": "931465d379b6500f",
          "name": "diary_grants_create",
        },
        {
          "inputSchema": "902fc52fe3a28906",
          "name": "diary_grants_list",
        },
        {
          "inputSchema": "49ffda98d75c96ec",
          "name": "diary_grants_revoke",
        },
        {
          "inputSchema": "cef778b784ce9fdb",
          "name": "diary_tags",
        },
        {
          "inputSchema": "b8384e3c098573a0",
          "name": "entries_create",
        },
        {
          "inputSchema": "5062b922390dc796",
          "name": "entries_delete",
        },
        {
          "inputSchema": "3e3d9211a7d1b897",
          "name": "entries_get",
        },
        {
          "inputSchema": "2e5eb34aca2fdff1",
          "name": "entries_list",
        },
        {
          "inputSchema": "3dd74a3a8422e86a",
          "name": "entries_map_open",
        },
        {
          "inputSchema": "57f6b1fb46e90520",
          "name": "entries_search",
        },
        {
          "inputSchema": "c19f62f8550fe52e",
          "name": "entries_update",
        },
        {
          "inputSchema": "eaf7752acb2a37ac",
          "name": "moltnet_whoami",
        },
        {
          "inputSchema": "7203f9c2b5fda0c2",
          "name": "packs_create",
        },
        {
          "inputSchema": "1f7e5bd7e8be3f4e",
          "name": "packs_diff",
        },
        {
          "inputSchema": "ff354f6357228512",
          "name": "packs_get",
        },
        {
          "inputSchema": "dd99db67b8eb503c",
          "name": "packs_list",
        },
        {
          "inputSchema": "7203f9c2b5fda0c2",
          "name": "packs_preview",
        },
        {
          "inputSchema": "87315fbdd6f9e88f",
          "name": "packs_provenance",
        },
        {
          "inputSchema": "11c3590d78f15481",
          "name": "packs_render",
        },
        {
          "inputSchema": "8a31ab23dd3cb813",
          "name": "packs_render_preview",
        },
        {
          "inputSchema": "729a208876f7c4e0",
          "name": "packs_update",
        },
        {
          "inputSchema": "50500669829405dc",
          "name": "relations_create",
        },
        {
          "inputSchema": "7b8745a39480ea61",
          "name": "relations_delete",
        },
        {
          "inputSchema": "6a3c57bb68fcdfb5",
          "name": "relations_list",
        },
        {
          "inputSchema": "3c723023712d64ba",
          "name": "relations_update",
        },
        {
          "inputSchema": "a58d5d4db7e37701",
          "name": "rendered_packs_get",
        },
        {
          "inputSchema": "c1f5c00d3c1da2b8",
          "name": "rendered_packs_list",
        },
        {
          "inputSchema": "a80ecff585617f6f",
          "name": "rendered_packs_update",
        },
        {
          "inputSchema": "2a5a9330f4f278d3",
          "name": "tasks_app_open",
        },
        {
          "inputSchema": "8f3230eca1e8976a",
          "name": "tasks_attempts_list",
        },
        {
          "inputSchema": "1c9c9b04f93c865c",
          "name": "tasks_console_link",
        },
        {
          "inputSchema": "fe55512e54ea899c",
          "name": "tasks_continue",
        },
        {
          "inputSchema": "3f626b894d7ae435",
          "name": "tasks_create",
        },
        {
          "inputSchema": "1c9c9b04f93c865c",
          "name": "tasks_get",
        },
        {
          "inputSchema": "c49685b21e0efabe",
          "name": "tasks_list",
        },
        {
          "inputSchema": "a6465451da69050e",
          "name": "tasks_messages_list",
        },
        {
          "inputSchema": "efddc7bd8bbcef73",
          "name": "tasks_schemas",
        },
        {
          "inputSchema": "ed266885cf87734d",
          "name": "team_members_list",
        },
        {
          "inputSchema": "4f16b4d67ae7e928",
          "name": "teams_create",
        },
        {
          "inputSchema": "3a62e02b710424ce",
          "name": "teams_delete",
        },
        {
          "inputSchema": "1d9126b2200a8c9a",
          "name": "teams_invite_create",
        },
        {
          "inputSchema": "0c13c2e99711416a",
          "name": "teams_invite_delete",
        },
        {
          "inputSchema": "157d74b577864e0f",
          "name": "teams_invite_list",
        },
        {
          "inputSchema": "9e89880acb02c75c",
          "name": "teams_join",
        },
        {
          "inputSchema": "efddc7bd8bbcef73",
          "name": "teams_list",
        },
        {
          "inputSchema": "ef8493794e9a3d9a",
          "name": "teams_member_remove",
        },
      ]
    `);

    await app.close();
  });

  it('tasks_list and tasks_app_open do not leak a named TaskStatus schema', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'tools/list',
        id: 1,
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    const tools = body.result.tools as Array<{
      name: string;
      inputSchema?: unknown;
      outputSchema?: unknown;
    }>;

    const taskListTool = tools.find((tool) => tool.name === 'tasks_list');
    const taskAppTool = tools.find((tool) => tool.name === 'tasks_app_open');

    expect(taskListTool).toBeDefined();
    expect(taskAppTool).toBeDefined();

    const namedSchemaIds = new Set<string>();
    collectNamedSchemaIds(taskListTool?.inputSchema, namedSchemaIds);
    collectNamedSchemaIds(taskAppTool?.inputSchema, namedSchemaIds);
    collectNamedSchemaIds(taskAppTool?.outputSchema, namedSchemaIds);

    expect(Array.from(namedSchemaIds)).not.toContain('TaskStatus');

    await app.close();
  });

  describe('GET /healthz/ready', () => {
    it('returns degraded when Ory is not configured', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      const deps = createMockDeps();
      const app = await buildApp({
        config: {
          PORT: 8001,
          NODE_ENV: 'test',
          REST_API_URL: 'http://localhost:3000',
        },
        deps,
        logger: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/healthz/ready',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('degraded');
      expect(body.components.restApi.status).toBe('ok');
      expect(body.components.ory.status).toBe('error');
      expect(body.components.ory.error).toBe('not_configured');

      fetchSpy.mockRestore();
      await app.close();
    });

    it('returns ok when all probes succeed', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response('{}', { status: 200 }));

      const deps = createMockDeps();
      const app = await buildApp({
        config: {
          PORT: 8001,
          NODE_ENV: 'test',
          REST_API_URL: 'http://localhost:3000',
          ORY_PROJECT_URL: 'https://mock-ory.example.com',
        },
        deps,
        logger: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/healthz/ready',
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('ok');
      expect(body.components.restApi.status).toBe('ok');
      expect(body.components.ory.status).toBe('ok');

      fetchSpy.mockRestore();
      await app.close();
    });

    it('returns degraded when REST API probe fails', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockImplementation(async (input: RequestInfo | URL) => {
          const url = typeof input === 'string' ? input : input.toString();
          if (url.includes('/health')) {
            return new Response('', { status: 503 });
          }
          return new Response('{}', { status: 200 });
        });

      const deps = createMockDeps();
      const app = await buildApp({
        config: {
          PORT: 8001,
          NODE_ENV: 'test',
          REST_API_URL: 'http://localhost:3000',
          ORY_PROJECT_URL: 'https://mock-ory.example.com',
        },
        deps,
        logger: false,
      });

      const response = await app.inject({
        method: 'GET',
        url: '/healthz/ready',
      });

      expect(response.statusCode).toBe(503);
      const body = JSON.parse(response.body);
      expect(body.status).toBe('degraded');
      expect(body.components.restApi.status).toBe('error');
      expect(body.components.restApi.error).toBe('http_503');
      expect(body.components.ory.status).toBe('ok');

      fetchSpy.mockRestore();
      await app.close();
    });
  });

  it('DELETE /mcp returns 400 without Mcp-Session-Id header', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/mcp',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.body);
    expect(body.error).toMatch(/Mcp-Session-Id/i);

    await app.close();
  });

  it('DELETE /mcp returns 404 for unknown session', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    const response = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { 'mcp-session-id': 'nonexistent-session' },
    });

    expect(response.statusCode).toBe(404);

    await app.close();
  });

  it('DELETE /mcp returns 204 for valid session', async () => {
    const deps = createMockDeps();
    const app = await buildApp({
      config: {
        PORT: 8001,
        NODE_ENV: 'test',
        REST_API_URL: 'http://localhost:3000',
      },
      deps,
      logger: false,
    });

    // Create a session via initialize
    const initResponse = await app.inject({
      method: 'POST',
      url: '/mcp',
      headers: { 'content-type': 'application/json' },
      payload: {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          clientInfo: { name: 'test', version: '1.0.0' },
        },
        id: 1,
      },
    });

    expect(initResponse.statusCode).toBe(200);
    const sessionId = initResponse.headers['mcp-session-id'] as string;
    expect(sessionId).toBeTruthy();

    // DELETE the session
    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { 'mcp-session-id': sessionId },
    });

    expect(deleteResponse.statusCode).toBe(204);

    // Second DELETE should be 404
    const secondDelete = await app.inject({
      method: 'DELETE',
      url: '/mcp',
      headers: { 'mcp-session-id': sessionId },
    });

    expect(secondDelete.statusCode).toBe(404);

    await app.close();
  });
});
