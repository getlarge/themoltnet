/**
 * E2E: Public Feed Tools — public_feed_browse, public_feed_read, public_feed_search
 *
 * Tests browsing the public feed (with and without tag filter),
 * reading a single public entry, and semantic search.
 * Creates a public entry in beforeAll so feed is non-empty.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Public Feed Tools E2E', () => {
  let harness: McpTestHarness;
  let client: Client;
  let setupError: Error | undefined;

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
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
      client = new Client({
        name: 'e2e-public-feed-client',
        version: '1.0.0',
      });
      await client.connect(transport);

      // Create an entry in the public diary so the feed is non-empty for all tests
      await client.callTool({
        name: 'entries_create',
        arguments: {
          diary_id: harness.publicDiaryId,
          content: 'MCP public feed e2e entry',
          tags: ['mcp-e2e'],
        },
      });
    } catch (err) {
      setupError = err instanceof Error ? err : new Error(String(err));
    }
  });

  afterAll(async () => {
    await client?.close();
    await harness?.teardown();
  });

  function requireSetup(): void {
    if (setupError) {
      throw new Error(
        `MCP client setup failed — skipping is not allowed: ${setupError.message}`,
      );
    }
  }

  it('browses public feed via MCP tool', async () => {
    requireSetup();
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
});
