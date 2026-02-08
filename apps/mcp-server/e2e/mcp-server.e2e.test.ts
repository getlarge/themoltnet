/**
 * E2E: MCP Server — Streamable HTTP transport
 *
 * Tests the full MCP protocol flow over HTTP against real Docker
 * infrastructure. All services (MCP server, REST API, Ory, Postgres)
 * run in containers. The test agent is bootstrapped via admin APIs.
 *
 * Auth: MCP requests use X-Client-Id / X-Client-Secret headers.
 * @moltnet/mcp-auth-proxy exchanges them for a Bearer token via Hydra.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('MCP Server E2E', () => {
  let harness: McpTestHarness;

  beforeAll(async () => {
    harness = await createMcpTestHarness();
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Health Check ─────────────────────────────────────────────

  describe('GET /healthz', () => {
    it('returns ok', async () => {
      const response = await fetch(`${harness.mcpBaseUrl}/healthz`);

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  // ── MCP Protocol — Client SDK ────────────────────────────────

  describe('MCP protocol via SDK client', () => {
    let client: Client;
    let transport: StreamableHTTPClientTransport;

    beforeAll(async () => {
      transport = new StreamableHTTPClientTransport(
        new URL(`${harness.mcpBaseUrl}/mcp`),
        {
          requestInit: {
            headers: {
              'X-Client-Id': harness.agent.clientId,
              'X-Client-Secret': harness.agent.clientSecret,
            },
          },
        },
      );
      client = new Client({ name: 'e2e-test-client', version: '1.0.0' });
      await client.connect(transport);
    });

    afterAll(async () => {
      await transport.terminateSession();
      await client.close();
    });

    it('initializes and receives server info', () => {
      const serverVersion = client.getServerVersion();
      expect(serverVersion).toBeDefined();
      expect(serverVersion!.name).toBe('moltnet');
      expect(serverVersion!.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('lists all 18 registered tools', async () => {
      const { tools } = await client.listTools();

      const toolNames = tools.map((t) => t.name);
      // Diary (7)
      expect(toolNames).toContain('diary_create');
      expect(toolNames).toContain('diary_get');
      expect(toolNames).toContain('diary_list');
      expect(toolNames).toContain('diary_search');
      expect(toolNames).toContain('diary_update');
      expect(toolNames).toContain('diary_delete');
      expect(toolNames).toContain('diary_reflect');
      // Crypto (3)
      expect(toolNames).toContain('crypto_prepare_signature');
      expect(toolNames).toContain('crypto_submit_signature');
      expect(toolNames).toContain('crypto_verify');
      // Identity (2)
      expect(toolNames).toContain('moltnet_whoami');
      expect(toolNames).toContain('agent_lookup');
      // Sharing (3)
      expect(toolNames).toContain('diary_set_visibility');
      expect(toolNames).toContain('diary_share');
      expect(toolNames).toContain('diary_shared_with_me');
      // Vouch (3)
      expect(toolNames).toContain('moltnet_vouch');
      expect(toolNames).toContain('moltnet_vouchers');
      expect(toolNames).toContain('moltnet_trust_graph');

      expect(tools).toHaveLength(18);
    });

    it('lists all registered resources', async () => {
      const { resources } = await client.listResources();

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('moltnet://identity');
      expect(uris).toContain('moltnet://diary/recent');
    });

    it('lists resource templates', async () => {
      const { resourceTemplates } = await client.listResourceTemplates();

      const templates = resourceTemplates.map((t) => t.uriTemplate);
      expect(templates).toContain('moltnet://diary/{id}');
      expect(templates).toContain('moltnet://agent/{fingerprint}');
    });

    // ── Identity tools ──

    it('calls moltnet_whoami and gets agent identity', async () => {
      const result = await client.callTool({
        name: 'moltnet_whoami',
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `whoami error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.authenticated).toBe(true);
      expect(parsed.identity).toBeDefined();
      expect(parsed.identity.fingerprint).toBe(
        harness.agent.keyPair.fingerprint,
      );
    });

    // ── Direct REST API sanity check ──

    it('direct REST API diary create works with token', async () => {
      const response = await fetch(`${harness.restApiUrl}/diary/entries`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${harness.agent.accessToken}`,
        },
        body: JSON.stringify({ content: 'direct REST test' }),
      });
      const body = await response.text();
      expect(
        response.status,
        `direct diary create: ${response.status} ${body}`,
      ).toBe(201);
    });

    // ── Diary CRUD via MCP tools ──

    it('creates and reads back a diary entry', async () => {
      const createResult = await client.callTool({
        name: 'diary_create',
        arguments: { content: 'MCP e2e test entry' },
      });

      const createContent = createResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        createResult.isError,
        `diary_create error: ${createContent[0].text}`,
      ).toBeUndefined();
      const createParsed = JSON.parse(createContent[0].text);
      expect(createParsed.entry).toBeDefined();
      const created = createParsed.entry;
      expect(created.content).toBe('MCP e2e test entry');

      // Read back
      const getResult = await client.callTool({
        name: 'diary_get',
        arguments: { entry_id: created.id },
      });

      const getContent = getResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        getResult.isError,
        `diary_get error: ${getContent[0].text}`,
      ).toBeUndefined();
      const getParsed = JSON.parse(getContent[0].text);
      const fetched = getParsed.entry ?? getParsed;
      expect(fetched.id).toBe(created.id);
      expect(fetched.content).toBe('MCP e2e test entry');
    });

    it('lists diary entries', async () => {
      const result = await client.callTool({
        name: 'diary_list',
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `diary_list error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.items).toBeDefined();
      expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    });

    // ── Crypto tools ──

    it('prepares a signature envelope', async () => {
      const result = await client.callTool({
        name: 'crypto_prepare_signature',
        arguments: { message: 'hello moltnet' },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `crypto_prepare_signature error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.message).toBe('hello moltnet');
      expect(parsed.signer_fingerprint).toBe(harness.agent.keyPair.fingerprint);
      expect(parsed.instructions).toBeDefined();
    });

    // ── Vouch tools ──

    it('fetches the trust graph (public, no auth needed)', async () => {
      const result = await client.callTool({
        name: 'moltnet_trust_graph',
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `trust_graph error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.edges).toBeDefined();
    });

    // ── Resources ──

    it('reads identity resource', async () => {
      const result = await client.readResource({
        uri: 'moltnet://identity',
      });

      expect(result.contents).toBeDefined();
      expect(result.contents.length).toBe(1);
      const content = result.contents[0];
      expect(content.uri).toBe('moltnet://identity');
      const parsed = JSON.parse((content as { text: string }).text);
      expect(
        parsed,
        `identity resource: ${JSON.stringify(parsed)}`,
      ).toHaveProperty('public_key');
      expect(parsed).toHaveProperty('fingerprint');
    });

    it('reads recent diary resource', async () => {
      const result = await client.readResource({
        uri: 'moltnet://diary/recent',
      });

      expect(result.contents).toBeDefined();
      expect(result.contents.length).toBe(1);
      const parsed = JSON.parse((result.contents[0] as { text: string }).text);
      expect(parsed.entries).toBeDefined();
    });
  });

  // ── Raw HTTP transport behavior ──────────────────────────────

  describe('Raw HTTP transport', () => {
    it('rejects POST without session ID or initialize request', async () => {
      const response = await fetch(`${harness.mcpBaseUrl}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      // Without auth, the server may return 401 before checking session
      expect([400, 401]).toContain(response.status);
    });

    it('rejects GET without session ID', async () => {
      const response = await fetch(`${harness.mcpBaseUrl}/mcp`);

      expect([400, 401, 405]).toContain(response.status);
    });

    it('rejects DELETE without session ID', async () => {
      const response = await fetch(`${harness.mcpBaseUrl}/mcp`, {
        method: 'DELETE',
      });

      expect([400, 401, 405]).toContain(response.status);
    });

    it('rejects POST with invalid session ID', async () => {
      const response = await fetch(`${harness.mcpBaseUrl}/mcp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'mcp-session-id': 'nonexistent-session',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'tools/list',
          id: 1,
        }),
      });

      expect([400, 401]).toContain(response.status);
    });
  });

  // ── Session lifecycle ────────────────────────────────────────

  describe('Session lifecycle', () => {
    it('creates and terminates a session', async () => {
      const transport = new StreamableHTTPClientTransport(
        new URL(`${harness.mcpBaseUrl}/mcp`),
        {
          requestInit: {
            headers: {
              'X-Client-Id': harness.agent.clientId,
              'X-Client-Secret': harness.agent.clientSecret,
            },
          },
        },
      );
      const client = new Client({
        name: 'e2e-session-test',
        version: '1.0.0',
      });

      await client.connect(transport);
      expect(transport.sessionId).toBeDefined();

      const { tools } = await client.listTools();
      expect(tools.length).toBeGreaterThan(0);

      await transport.terminateSession();
      await client.close();
    });

    it('supports multiple concurrent sessions', async () => {
      const transports = Array.from(
        { length: 3 },
        () =>
          new StreamableHTTPClientTransport(
            new URL(`${harness.mcpBaseUrl}/mcp`),
            {
              requestInit: {
                headers: {
                  'X-Client-Id': harness.agent.clientId,
                  'X-Client-Secret': harness.agent.clientSecret,
                },
              },
            },
          ),
      );
      const clients = transports.map(
        (_, i) =>
          new Client({
            name: `e2e-concurrent-${i}`,
            version: '1.0.0',
          }),
      );

      // Connect all
      await Promise.all(clients.map((c, i) => c.connect(transports[i])));

      // All should have different session IDs
      const sessionIds = transports.map((t) => t.sessionId);
      const unique = new Set(sessionIds);
      expect(unique.size).toBe(3);

      // All can list tools independently
      const results = await Promise.all(clients.map((c) => c.listTools()));
      for (const { tools } of results) {
        expect(tools.length).toBeGreaterThan(0);
      }

      // Clean up
      await Promise.all(transports.map((t) => t.terminateSession()));
      await Promise.all(clients.map((c) => c.close()));
    });
  });
});
