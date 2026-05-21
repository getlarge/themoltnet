/**
 * E2E: Pack Tools — packs_list, packs_get, packs_provenance
 *
 * Tests pack listing, retrieval, and provenance graph queries.
 * Each test creates a pack from a freshly-seeded entry to ensure isolation.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

type McpTextContent = Array<{ type: string; text: string }>;

async function createPack(
  client: Client,
  diaryId: string,
): Promise<{ id: string; packCid: string }> {
  const entryResult = await client.callTool({
    name: 'entries_create',
    arguments: {
      diary_id: diaryId,
      content: `pack-tools e2e seed ${Date.now()}`,
      tags: ['pack-tools-e2e'],
    },
  });
  const entryContent = entryResult.content as McpTextContent;
  if (entryResult.isError) {
    throw new Error(`entries_create error: ${entryContent[0].text}`);
  }
  const entry = JSON.parse(entryContent[0].text) as { id: string };

  const createResult = await client.callTool({
    name: 'packs_create',
    arguments: {
      diary_id: diaryId,
      params: { source: 'pack-tools-e2e' },
      entries: [{ entry_id: entry.id, rank: 1 }],
    },
  });
  const createContent = createResult.content as McpTextContent;
  if (createResult.isError) {
    throw new Error(`packs_create error: ${createContent[0].text}`);
  }
  const pack = JSON.parse(createContent[0].text) as {
    id: string;
    packCid: string;
  };
  return pack;
}

describe('Pack Tools E2E', () => {
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
      client = new Client({ name: 'e2e-pack-client', version: '1.0.0' });
      await client.connect(transport);
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

  it('packs_list returns packs for a diary and packs_get returns pack details', async () => {
    requireSetup();

    const { id: packId } = await createPack(client, harness.privateDiaryId);

    // packs_list
    const listResult = await client.callTool({
      name: 'packs_list',
      arguments: { diary_id: harness.privateDiaryId },
    });
    const listContent = listResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      listResult.isError,
      `packs_list error: ${listContent[0].text}`,
    ).toBeUndefined();
    const listParsed = JSON.parse(listContent[0].text);
    expect(Array.isArray(listParsed.items)).toBe(true);
    expect(listParsed.items.some((p: { id: string }) => p.id === packId)).toBe(
      true,
    );

    // packs_get
    const getResult = await client.callTool({
      name: 'packs_get',
      arguments: { pack_id: packId },
    });
    const getContent = getResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      getResult.isError,
      `packs_get error: ${getContent[0].text}`,
    ).toBeUndefined();
    const getParsed = JSON.parse(getContent[0].text);
    expect(getParsed.id).toBe(packId);
    expect(getParsed.packCid).toBeDefined();
  });

  it('packs_provenance returns provenance graph with nodes and edges', async () => {
    requireSetup();

    const { packCid } = await createPack(client, harness.privateDiaryId);

    // packs_provenance by pack_cid
    const provResult = await client.callTool({
      name: 'packs_provenance',
      arguments: { pack_cid: packCid },
    });
    const provContent = provResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      provResult.isError,
      `packs_provenance error: ${provContent[0].text}`,
    ).toBeUndefined();
    const provParsed = JSON.parse(provContent[0].text);
    expect(Array.isArray(provParsed.nodes)).toBe(true);
    expect(Array.isArray(provParsed.edges)).toBe(true);
  });

  it('packs_update pins and unpins a pack', async () => {
    requireSetup();

    const { id: packId } = await createPack(client, harness.privateDiaryId);

    // Pin the pack
    const pinResult = await client.callTool({
      name: 'packs_update',
      arguments: { pack_id: packId, pinned: true },
    });
    const pinContent = pinResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      pinResult.isError,
      `packs_update (pin) error: ${pinContent[0].text}`,
    ).toBeUndefined();
    const pinParsed = JSON.parse(pinContent[0].text);
    expect(pinParsed.pinned).toBe(true);
    expect(pinParsed.expiresAt).toBeNull();

    // Unpin with new expiresAt
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const unpinResult = await client.callTool({
      name: 'packs_update',
      arguments: {
        pack_id: packId,
        pinned: false,
        expires_at: future.toISOString(),
      },
    });
    const unpinContent = unpinResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      unpinResult.isError,
      `packs_update (unpin) error: ${unpinContent[0].text}`,
    ).toBeUndefined();
    const unpinParsed = JSON.parse(unpinContent[0].text);
    expect(unpinParsed.pinned).toBe(false);
    expect(unpinParsed.expiresAt).toBeDefined();
  });

  it('rendered_packs_update pins and unpins a rendered pack', async () => {
    requireSetup();

    const { id: sourcePackId } = await createPack(
      client,
      harness.privateDiaryId,
    );

    // Render the pack to get a rendered pack
    const renderResult = await client.callTool({
      name: 'packs_render',
      arguments: {
        pack_id: sourcePackId,
        render_method: 'server:pack-to-docs-v1',
      },
    });
    const renderContent = renderResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      renderResult.isError,
      `packs_render error: ${renderContent[0].text}`,
    ).toBeUndefined();
    const renderParsed = JSON.parse(renderContent[0].text);
    const renderedPackId = renderParsed.id as string;

    // Pin the rendered pack
    const pinResult = await client.callTool({
      name: 'rendered_packs_update',
      arguments: { rendered_pack_id: renderedPackId, pinned: true },
    });
    const pinContent = pinResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      pinResult.isError,
      `rendered_packs_update (pin) error: ${pinContent[0].text}`,
    ).toBeUndefined();
    const pinParsed = JSON.parse(pinContent[0].text);
    expect(pinParsed.pinned).toBe(true);

    // Unpin with new expiresAt
    const future = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const unpinResult = await client.callTool({
      name: 'rendered_packs_update',
      arguments: {
        rendered_pack_id: renderedPackId,
        pinned: false,
        expires_at: future.toISOString(),
      },
    });
    const unpinContent2 = unpinResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      unpinResult.isError,
      `rendered_packs_update (unpin) error: ${unpinContent2[0].text}`,
    ).toBeUndefined();
    const unpinParsed2 = JSON.parse(unpinContent2[0].text);
    expect(unpinParsed2.pinned).toBe(false);
    expect(unpinParsed2.expiresAt).toBeDefined();
  });

  it('rendered_packs_get and rendered_packs_list expose persisted rendered packs', async () => {
    requireSetup();

    const { id: sourcePackId } = await createPack(
      client,
      harness.privateDiaryId,
    );

    // Render the pack to persist a rendered pack
    const renderResult = await client.callTool({
      name: 'packs_render',
      arguments: {
        pack_id: sourcePackId,
        render_method: 'server:pack-to-docs-v1',
      },
    });
    const renderContent = renderResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      renderResult.isError,
      `packs_render error: ${renderContent[0].text}`,
    ).toBeUndefined();
    const renderParsed = JSON.parse(renderContent[0].text);
    const renderedPackId = renderParsed.id as string;
    const expectedMarkdown = renderParsed.renderedMarkdown as string;

    // rendered_packs_get returns content + metadata
    const getResult = await client.callTool({
      name: 'rendered_packs_get',
      arguments: { rendered_pack_id: renderedPackId },
    });
    const getContent = getResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      getResult.isError,
      `rendered_packs_get error: ${getContent[0].text}`,
    ).toBeUndefined();
    const getParsed = JSON.parse(getContent[0].text);
    expect(getParsed.id).toBe(renderedPackId);
    expect(getParsed.sourcePackId).toBe(sourcePackId);
    expect(getParsed.diaryId).toBe(harness.privateDiaryId);
    expect(getParsed.renderMethod).toBe('server:pack-to-docs-v1');
    expect(typeof getParsed.content).toBe('string');
    expect(getParsed.content.length).toBeGreaterThan(0);
    expect(getParsed.content).toBe(expectedMarkdown);
    expect(typeof getParsed.contentHash).toBe('string');

    // rendered_packs_list surfaces the rendered pack (filtered by source)
    const listResult = await client.callTool({
      name: 'rendered_packs_list',
      arguments: {
        diary_id: harness.privateDiaryId,
        source_pack_id: sourcePackId,
      },
    });
    const listContent = listResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      listResult.isError,
      `rendered_packs_list error: ${listContent[0].text}`,
    ).toBeUndefined();
    const listParsed = JSON.parse(listContent[0].text);
    expect(Array.isArray(listParsed.items)).toBe(true);
    expect(
      listParsed.items.some(
        (p: { id: string; sourcePackId: string }) =>
          p.id === renderedPackId && p.sourcePackId === sourcePackId,
      ),
    ).toBe(true);
  });

  it('rendered_packs_get returns a clear error for unknown UUID', async () => {
    requireSetup();

    const result = await client.callTool({
      name: 'rendered_packs_get',
      arguments: {
        rendered_pack_id: '00000000-0000-4000-8000-000000000000',
      },
    });
    expect(result.isError).toBe(true);
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0].text.toLowerCase()).toMatch(/not found|404/);
  });
});
