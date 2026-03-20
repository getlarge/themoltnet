/**
 * E2E: MCP Server — infrastructure and protocol tests
 *
 * Tests the MCP protocol transport over HTTP against real Docker infrastructure:
 * - Health check
 * - Server initialization and server info
 * - Tool / resource / prompt listing assertions
 * - Raw HTTP transport rejection behavior
 * - Session lifecycle (creation, concurrent sessions)
 *
 * All services (MCP server, REST API, Ory, Postgres) run in containers.
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
    let setupError: Error | undefined;

    beforeAll(async () => {
      try {
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
      } catch (err) {
        setupError = err instanceof Error ? err : new Error(String(err));
      }
    });

    afterAll(async () => {
      await client?.close();
    });

    function requireSetup(): void {
      if (setupError) {
        throw new Error(
          `MCP client setup failed — skipping is not allowed: ${setupError.message}`,
        );
      }
    }

    it('initializes and receives server info', () => {
      requireSetup();
      const serverVersion = client.getServerVersion();
      expect(serverVersion).toBeDefined();
      expect(serverVersion!.name).toBe('moltnet');
      expect(serverVersion!.version).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('lists all 33 registered tools', async () => {
      requireSetup();
      const { tools } = await client.listTools();

      const toolNames = tools.map((t) => t.name);
      // Diaries catalog + distill (5)
      expect(toolNames).toContain('diaries_list');
      expect(toolNames).toContain('diaries_create');
      expect(toolNames).toContain('diaries_get');
      expect(toolNames).toContain('diaries_consolidate');
      expect(toolNames).toContain('diaries_compile');
      // Entries (7) + reflect (1)
      expect(toolNames).toContain('entries_create');
      expect(toolNames).toContain('entries_get');
      expect(toolNames).toContain('entries_list');
      expect(toolNames).toContain('entries_search');
      expect(toolNames).toContain('entries_update');
      expect(toolNames).toContain('entries_delete');
      expect(toolNames).toContain('entries_verify');
      expect(toolNames).toContain('reflect');
      // Crypto (4)
      expect(toolNames).toContain('crypto_prepare_signature');
      expect(toolNames).toContain('crypto_submit_signature');
      expect(toolNames).toContain('crypto_signing_status');
      expect(toolNames).toContain('crypto_verify');
      // Identity (2)
      expect(toolNames).toContain('moltnet_whoami');
      expect(toolNames).toContain('agent_lookup');
      // Vouch (3)
      expect(toolNames).toContain('moltnet_vouch');
      expect(toolNames).toContain('moltnet_vouchers');
      expect(toolNames).toContain('moltnet_trust_graph');
      // Public Feed (3)
      expect(toolNames).toContain('public_feed_browse');
      expect(toolNames).toContain('public_feed_read');
      expect(toolNames).toContain('public_feed_search');
      // Network Info (1)
      expect(toolNames).toContain('moltnet_info');
      // Relations (4)
      expect(toolNames).toContain('relations_create');
      expect(toolNames).toContain('relations_list');
      expect(toolNames).toContain('relations_update');
      expect(toolNames).toContain('relations_delete');
      // Packs (3)
      expect(toolNames).toContain('packs_get');
      expect(toolNames).toContain('packs_list');
      expect(toolNames).toContain('packs_provenance');

      expect(tools).toHaveLength(33);
    });

    it('lists all registered resources', async () => {
      requireSetup();
      const { resources } = await client.listResources();

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('moltnet://identity');
      expect(uris).toContain('moltnet://entries/recent');
      expect(uris).toContain('moltnet://self/whoami');
      expect(uris).toContain('moltnet://self/soul');
    });

    it('lists all registered prompts', async () => {
      requireSetup();
      const { prompts } = await client.listPrompts();

      const promptNames = prompts.map((p) => p.name);
      expect(promptNames).toContain('identity_bootstrap');
      expect(promptNames).toContain('write_identity');
      expect(promptNames).toContain('sign_message');
    });

    // fastify-mcp@1.x does not expose resources/templates/list
    it('lists resource templates', async () => {
      requireSetup();
      const { resourceTemplates } = await client.listResourceTemplates();

      const templates = resourceTemplates.map((t) => t.uriTemplate);
      expect(templates).toContain('moltnet://diaries/{diaryId}');
      expect(templates).toContain('moltnet://agent/{fingerprint}');
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

  // Note: fastify-mcp@1.x does not implement DELETE for session termination.
  // Tests call client.close() only; terminateSession() would return 404.
  describe('Session lifecycle', () => {
    it('creates a session and lists tools', async () => {
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
      await Promise.all(clients.map((c) => c.close()));
    });
  });
});
