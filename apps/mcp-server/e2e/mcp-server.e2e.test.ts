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
  const PRIVATE_DIARY_REF = 'private';
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

    it('lists all 23 registered tools', async () => {
      requireSetup();
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
      // Crypto (4)
      expect(toolNames).toContain('crypto_prepare_signature');
      expect(toolNames).toContain('crypto_submit_signature');
      expect(toolNames).toContain('crypto_signing_status');
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
      // Public Feed (3)
      expect(toolNames).toContain('public_feed_browse');
      expect(toolNames).toContain('public_feed_read');
      expect(toolNames).toContain('public_feed_search');
      // Network Info (1)
      expect(toolNames).toContain('moltnet_info');

      expect(tools).toHaveLength(23);
    });

    it('lists all registered resources', async () => {
      requireSetup();
      const { resources } = await client.listResources();

      const uris = resources.map((r) => r.uri);
      expect(uris).toContain('moltnet://identity');
      expect(uris).toContain('moltnet://diary/recent');
      expect(uris).toContain('moltnet://self/whoami');
      expect(uris).toContain('moltnet://self/soul');
    });

    it('lists all registered prompts', async () => {
      requireSetup();
      const { prompts } = await client.listPrompts();

      const promptNames = prompts.map((p) => p.name);
      expect(promptNames).toContain('identity_bootstrap');
      expect(promptNames).toContain('sign_message');
    });

    // fastify-mcp@1.x does not expose resources/templates/list
    it('lists resource templates', async () => {
      requireSetup();
      const { resourceTemplates } = await client.listResourceTemplates();

      const templates = resourceTemplates.map((t) => t.uriTemplate);
      expect(templates).toContain('moltnet://diary/{id}');
      expect(templates).toContain('moltnet://agent/{fingerprint}');
    });

    // ── Identity tools ──

    it('calls moltnet_whoami and gets agent identity with profile', async () => {
      requireSetup();
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
      // Profile fields are present (null before bootstrap)
      expect(parsed.profile).toBeDefined();
      expect(parsed.profile.whoami).toBeNull();
      expect(parsed.profile.soul).toBeNull();
      // Hint nudges the agent to bootstrap
      expect(parsed.hint).toContain('identity_bootstrap');
    });

    // ── Direct REST API sanity check ──

    it('direct REST API diary create works with token', async () => {
      requireSetup();
      const response = await fetch(
        `${harness.restApiUrl}/diaries/private/entries`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${harness.agent.accessToken}`,
          },
          body: JSON.stringify({ content: 'direct REST test' }),
        },
      );
      const body = await response.text();
      expect(
        response.status,
        `direct diary create: ${response.status} ${body}`,
      ).toBe(201);
    });

    // ── Diary CRUD via MCP tools ──

    it('creates and reads back a diary entry', async () => {
      requireSetup();
      const createResult = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'MCP e2e test entry',
        },
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
        arguments: { diary_ref: PRIVATE_DIARY_REF, entry_id: created.id },
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

    it('supports diary_ref as diary id for read operations', async () => {
      requireSetup();
      const createResult = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'MCP diary id ref test',
        },
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
      const created = createParsed.entry as { id: string };

      const getResult = await client.callTool({
        name: 'diary_get',
        arguments: { diary_ref: harness.privateDiaryId, entry_id: created.id },
      });
      const getContent = getResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        getResult.isError,
        `diary_get by diary id error: ${getContent[0].text}`,
      ).toBeUndefined();
    });

    it('returns error when diary_ref does not match the entry diary', async () => {
      requireSetup();
      const createResult = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'MCP wrong diary ref test',
        },
      });
      const createContent = createResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(createResult.isError).toBeUndefined();
      const createParsed = JSON.parse(createContent[0].text);
      const created = createParsed.entry as { id: string };

      const getResult = await client.callTool({
        name: 'diary_get',
        arguments: { diary_ref: 'does-not-exist', entry_id: created.id },
      });
      const getContent = getResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(getResult.isError).toBe(true);
      expect(getContent[0].text).toContain('not found');
    });

    it('lists diary entries', async () => {
      requireSetup();
      const result = await client.callTool({
        name: 'diary_list',
        arguments: { diary_ref: PRIVATE_DIARY_REF },
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

    it('returns error when listing an unknown diary_ref', async () => {
      requireSetup();
      const result = await client.callTool({
        name: 'diary_list',
        arguments: { diary_ref: 'does-not-exist' },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(result.isError).toBe(true);
      expect(content[0].text).toContain('Failed to list entries');
    });

    it('validates required diary_ref for scoped diary tools', async () => {
      requireSetup();
      const result = await client.callTool({
        name: 'diary_create',
        arguments: { content: 'missing diary ref should fail' },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(result.isError).toBe(true);
      expect(content[0].text).toContain('Invalid tool arguments');
    });

    it('returns error when sharing with an unknown agent fingerprint', async () => {
      requireSetup();
      const createResult = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'MCP share negative test',
        },
      });
      const createContent = createResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(createResult.isError).toBeUndefined();
      const created = JSON.parse(createContent[0].text).entry as { id: string };

      const shareResult = await client.callTool({
        name: 'diary_share',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          entry_id: created.id,
          with_agent: 'AAAA-BBBB-CCCC-DDDD',
        },
      });
      const shareContent = shareResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(shareResult.isError).toBe(true);
      expect(shareContent[0].text.toLowerCase()).toContain('not found');
    });

    // ── Crypto tools ──

    it('prepares a signature envelope', async () => {
      requireSetup();
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
      expect(parsed.request_id).toBeDefined();
      expect(parsed.nonce).toBeDefined();
      expect(parsed.next_step).toBeDefined();
      // signing_payload must not be present — it caused agents to sign the wrong thing
      expect(parsed.signing_payload).toBeUndefined();
    });

    it('full signing workflow: prepare → sign → submit → verify', async () => {
      requireSetup();

      // 1. Prepare signing request
      const prepareResult = await client.callTool({
        name: 'crypto_prepare_signature',
        arguments: { message: 'MCP e2e signing test' },
      });
      const prepareContent = prepareResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        prepareResult.isError,
        `prepare error: ${prepareContent[0].text}`,
      ).toBeUndefined();
      const envelope = JSON.parse(prepareContent[0].text);
      const { request_id, message, nonce } = envelope;
      expect(request_id).toBeDefined();

      // 2. Sign locally using the deterministic pre-hash protocol
      const { cryptoService } = await import('@moltnet/crypto-service');
      const signature = await cryptoService.signWithNonce(
        message,
        nonce,
        harness.agent.keyPair.privateKey,
      );

      // 3. Submit signature
      const submitResult = await client.callTool({
        name: 'crypto_submit_signature',
        arguments: { request_id, signature },
      });
      const submitContent = submitResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        submitResult.isError,
        `submit error: ${submitContent[0].text}`,
      ).toBeUndefined();
      const submitParsed = JSON.parse(submitContent[0].text);
      expect(submitParsed.status).toBe('completed');
      expect(submitParsed.valid).toBe(true);

      // 4. Verify by signature
      const verifyResult = await client.callTool({
        name: 'crypto_verify',
        arguments: { signature },
      });
      const verifyContent = verifyResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        verifyResult.isError,
        `verify error: ${verifyContent[0].text}`,
      ).toBeUndefined();
      const verifyParsed = JSON.parse(verifyContent[0].text);
      expect(verifyParsed.valid).toBe(true);
    });

    it('full signing workflow with multiline message', async () => {
      requireSetup();
      const message = 'line1\nline2\nline3';

      // 1. Prepare
      const prepareResult = await client.callTool({
        name: 'crypto_prepare_signature',
        arguments: { message },
      });
      const prepareContent = prepareResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        prepareResult.isError,
        `prepare error: ${prepareContent[0].text}`,
      ).toBeUndefined();
      const envelope = JSON.parse(prepareContent[0].text);
      expect(envelope.message).toBe(message);

      // 2. Sign with deterministic pre-hash
      const { cryptoService } = await import('@moltnet/crypto-service');
      const signature = await cryptoService.signWithNonce(
        envelope.message,
        envelope.nonce,
        harness.agent.keyPair.privateKey,
      );

      // 3. Submit
      const submitResult = await client.callTool({
        name: 'crypto_submit_signature',
        arguments: { request_id: envelope.request_id, signature },
      });
      const submitContent = submitResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        submitResult.isError,
        `submit error: ${submitContent[0].text}`,
      ).toBeUndefined();
      const submitParsed = JSON.parse(submitContent[0].text);
      expect(submitParsed.status).toBe('completed');
      expect(submitParsed.valid).toBe(true);
    });

    it('returns false for signature not yet submitted', async () => {
      requireSetup();

      const prepareResult = await client.callTool({
        name: 'crypto_prepare_signature',
        arguments: { message: 'MCP unsigned signature' },
      });
      const prepareContent = prepareResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        prepareResult.isError,
        `prepare error: ${prepareContent[0].text}`,
      ).toBeUndefined();
      const envelope = JSON.parse(prepareContent[0].text);

      const { cryptoService } = await import('@moltnet/crypto-service');
      const signature = await cryptoService.signWithNonce(
        envelope.message,
        envelope.nonce,
        harness.agent.keyPair.privateKey,
      );

      const verifyResult = await client.callTool({
        name: 'crypto_verify',
        arguments: { signature },
      });
      const verifyContent = verifyResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        verifyResult.isError,
        `verify error: ${verifyContent[0].text}`,
      ).toBeUndefined();
      const verifyParsed = JSON.parse(verifyContent[0].text);
      expect(verifyParsed.valid).toBe(false);
    });

    // ── Vouch tools ──

    it('fetches the trust graph (public, no auth needed)', async () => {
      requireSetup();
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

    // ── Public Feed tools ──

    it('browses public feed via MCP tool', async () => {
      requireSetup();
      // First create a public entry so there's data to find
      const createResult = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'MCP public feed e2e entry',
          tags: ['mcp-e2e'],
        },
      });
      const createContent = createResult.content as Array<{
        type: string;
        text: string;
      }>;
      const created = JSON.parse(createContent[0].text).entry;

      // Make it public via set_visibility
      const visResult = await client.callTool({
        name: 'diary_set_visibility',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          entry_id: created.id,
          visibility: 'public',
        },
      });
      const visContent = visResult.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        visResult.isError,
        `set_visibility error: ${visContent[0].text}`,
      ).toBeUndefined();

      // Browse the public feed
      const result = await client.callTool({
        name: 'public_feed_browse',
        arguments: {},
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `public_feed_browse error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.items).toBeDefined();
      expect(parsed.items.length).toBeGreaterThanOrEqual(1);
    });

    it('browses public feed with tag filter', async () => {
      requireSetup();
      const result = await client.callTool({
        name: 'public_feed_browse',
        arguments: { tag: 'mcp-e2e' },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `public_feed_browse error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.items.length).toBeGreaterThanOrEqual(1);
      for (const item of parsed.items) {
        expect(item.tags).toContain('mcp-e2e');
      }
    });

    it('reads a single public entry via MCP tool', async () => {
      requireSetup();
      // Get an entry ID from the feed
      const browseResult = await client.callTool({
        name: 'public_feed_browse',
        arguments: { limit: 1 },
      });
      const browseContent = browseResult.content as Array<{
        type: string;
        text: string;
      }>;
      const feedItems = JSON.parse(browseContent[0].text).items;
      expect(feedItems.length).toBeGreaterThanOrEqual(1);

      const entryId = feedItems[0].id;

      // Read that specific entry
      const result = await client.callTool({
        name: 'public_feed_read',
        arguments: { entry_id: entryId },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `public_feed_read error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.id).toBe(entryId);
      expect(parsed.author).toBeDefined();
      expect(parsed.author.fingerprint).toBeDefined();
    });

    it('returns error for non-existent public entry', async () => {
      requireSetup();
      const result = await client.callTool({
        name: 'public_feed_read',
        arguments: { entry_id: '00000000-0000-0000-0000-000000000000' },
      });

      expect(result.isError).toBe(true);
    });

    it('searches public feed via MCP tool', async () => {
      requireSetup();
      const result = await client.callTool({
        name: 'public_feed_search',
        arguments: { query: 'public feed' },
      });

      const content = result.content as Array<{ type: string; text: string }>;
      expect(
        result.isError,
        `public_feed_search error: ${content[0].text}`,
      ).toBeUndefined();
      const parsed = JSON.parse(content[0].text);
      expect(parsed.items).toBeDefined();
    });

    // ── Sign Message Prompt ──

    it('sign_message prompt returns step-by-step signing instructions', async () => {
      requireSetup();
      const result = await client.getPrompt({
        name: 'sign_message',
        arguments: { message: 'hello from e2e' },
      });

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      const text = (
        result.messages[0].content as { type: string; text: string }
      ).text;
      expect(text).toContain('hello from e2e');
      expect(text).toContain('crypto_prepare_signature');
      expect(text).toContain('crypto_submit_signature');
    });

    // ── Identity Bootstrap Flow ──

    it('calls identity_bootstrap prompt and gets guidance', async () => {
      requireSetup();
      const result = await client.getPrompt({
        name: 'identity_bootstrap',
      });

      expect(result.messages).toBeDefined();
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      const text = (
        result.messages[0].content as { type: string; text: string }
      ).text;
      // Should contain the agent's fingerprint
      expect(text).toContain(harness.agent.keyPair.fingerprint);
      // Should guide creation of missing entries
      expect(text).toContain('Whoami (missing)');
      expect(text).toContain('Soul (missing)');
    });

    it('self resources return exists:false before bootstrap', async () => {
      requireSetup();

      const whoamiResult = await client.readResource({
        uri: 'moltnet://self/whoami',
      });
      const whoamiData = JSON.parse(
        (whoamiResult.contents[0] as { text: string }).text,
      );
      expect(whoamiData.exists).toBe(false);

      const soulResult = await client.readResource({
        uri: 'moltnet://self/soul',
      });
      const soulData = JSON.parse(
        (soulResult.contents[0] as { text: string }).text,
      );
      expect(soulData.exists).toBe(false);
    });

    it('full bootstrap flow: create entries, verify whoami and resources', async () => {
      requireSetup();

      // 1. Create whoami entry
      const whoamiCreate = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'I am E2E Test Agent, a MoltNet integration test agent.',
          title: 'I am E2E Test Agent',
          tags: ['system', 'identity'],
        },
      });
      const whoamiContent = whoamiCreate.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        whoamiCreate.isError,
        `whoami create error: ${whoamiContent[0].text}`,
      ).toBeUndefined();

      const whoamiEntry = JSON.parse(whoamiContent[0].text).entry as {
        id: string;
      };
      const whoamiVisibility = await client.callTool({
        name: 'diary_set_visibility',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          entry_id: whoamiEntry.id,
          visibility: 'moltnet',
        },
      });
      expect(whoamiVisibility.isError).toBeUndefined();

      // 2. Create soul entry
      const soulCreate = await client.callTool({
        name: 'diary_create',
        arguments: {
          diary_ref: PRIVATE_DIARY_REF,
          content: 'I value correctness and thorough testing.',
          title: 'What I care about',
          tags: ['system', 'soul'],
        },
      });
      const soulContent = soulCreate.content as Array<{
        type: string;
        text: string;
      }>;
      expect(
        soulCreate.isError,
        `soul create error: ${soulContent[0].text}`,
      ).toBeUndefined();

      // 3. Verify moltnet_whoami now returns populated profile
      const whoamiResult = await client.callTool({
        name: 'moltnet_whoami',
        arguments: {},
      });
      const whoamiParsed = JSON.parse(
        (whoamiResult.content as Array<{ text: string }>)[0].text,
      );
      expect(whoamiParsed.profile.whoami).not.toBeNull();
      expect(whoamiParsed.profile.whoami.content).toContain('E2E Test Agent');
      expect(whoamiParsed.profile.soul).not.toBeNull();
      expect(whoamiParsed.profile.soul.content).toContain('correctness');
      // No hint when profile is complete
      expect(whoamiParsed.hint).toBeUndefined();

      // 4. Verify self resources return the entries
      const selfWhoami = await client.readResource({
        uri: 'moltnet://self/whoami',
      });
      const selfWhoamiData = JSON.parse(
        (selfWhoami.contents[0] as { text: string }).text,
      );
      expect(selfWhoamiData.exists).toBe(true);
      expect(selfWhoamiData.content).toContain('E2E Test Agent');

      const selfSoul = await client.readResource({
        uri: 'moltnet://self/soul',
      });
      const selfSoulData = JSON.parse(
        (selfSoul.contents[0] as { text: string }).text,
      );
      expect(selfSoulData.exists).toBe(true);
      expect(selfSoulData.content).toContain('correctness');

      // 5. Verify prompt confirms setup
      const promptResult = await client.getPrompt({
        name: 'identity_bootstrap',
      });
      const promptText = (
        promptResult.messages[0].content as { type: string; text: string }
      ).text;
      expect(promptText).toContain('Whoami (established)');
      expect(promptText).toContain('Soul (established)');
    });

    // ── Resources ──

    it('reads identity resource', async () => {
      requireSetup();
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
      requireSetup();
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
