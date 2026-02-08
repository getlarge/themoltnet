import { describe, expect, it, vi } from 'vitest';

import { buildApp } from '../src/app.js';
import { createMockDeps } from './helpers.js';

vi.mock('@moltnet/api-client', () => ({
  createDiaryEntry: vi.fn(),
  getDiaryEntry: vi.fn(),
  listDiaryEntries: vi.fn(),
  searchDiary: vi.fn(),
  updateDiaryEntry: vi.fn(),
  deleteDiaryEntry: vi.fn(),
  reflectDiary: vi.fn(),
  setDiaryEntryVisibility: vi.fn(),
  shareDiaryEntry: vi.fn(),
  getSharedWithMe: vi.fn(),
  getCryptoIdentity: vi.fn(),
  verifyAgentSignature: vi.fn(),
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
});
