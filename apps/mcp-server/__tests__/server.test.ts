import { describe, expect, it, type Mock, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMockDeps } from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: vi.fn(),
  getDiaryEntryById: vi.fn(),
  listDiaryEntries: vi.fn(),
  searchDiary: vi.fn(),
  updateDiaryEntryById: vi.fn(),
  deleteDiaryEntryById: vi.fn(),
  verifyDiaryEntryById: vi.fn(),
  reflectDiary: vi.fn(),
  consolidateDiary: vi.fn(),
  compileDiary: vi.fn(),
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
    expect(toolNames).toContain('reflect');
    // diary catalog tools
    expect(toolNames).toContain('diaries_list');
    expect(toolNames).toContain('diaries_create');
    expect(toolNames).toContain('diaries_get');
    // old names must NOT appear
    expect(toolNames).not.toContain('diary_create');
    expect(toolNames).not.toContain('diary_get');
    expect(toolNames).not.toContain('diary_list');
    expect(toolNames).not.toContain('diary_search');
    expect(toolNames).not.toContain('diary_update');
    expect(toolNames).not.toContain('diary_delete');
    expect(toolNames).not.toContain('diary_reflect');

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
