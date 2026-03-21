/**
 * E2E: Pack Tools — packs_list, packs_get, packs_provenance
 *
 * Tests pack listing, retrieval, and provenance graph queries.
 * Each test compiles a diary first to ensure a pack exists.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

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

    // Compile the diary to create a pack
    const compileResult = await client.callTool({
      name: 'diaries_compile',
      arguments: {
        diary_id: harness.privateDiaryId,
        token_budget: 2000,
      },
    });
    const compileContent = compileResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      compileResult.isError,
      `diaries_compile error: ${compileContent[0].text}`,
    ).toBeUndefined();
    const compileParsed = JSON.parse(compileContent[0].text);
    expect(compileParsed.id).toBeDefined();
    const packId = compileParsed.id as string;

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
    expect(getParsed.pack).toBeDefined();
    expect(getParsed.pack.id).toBe(packId);
    expect(getParsed.pack.packCid).toBeDefined();
  });

  it('packs_provenance returns provenance graph with nodes and edges', async () => {
    requireSetup();

    // Compile to get a fresh pack
    const compileResult = await client.callTool({
      name: 'diaries_compile',
      arguments: {
        diary_id: harness.privateDiaryId,
        token_budget: 2000,
      },
    });
    const compileContent = compileResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      compileResult.isError,
      `diaries_compile error: ${compileContent[0].text}`,
    ).toBeUndefined();
    const compileParsed = JSON.parse(compileContent[0].text);
    const packCid = compileParsed.packCid as string;

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
});
