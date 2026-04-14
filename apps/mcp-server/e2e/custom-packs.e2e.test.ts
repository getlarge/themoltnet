/**
 * E2E: MCP custom pack tools
 *
 * Simulates an external Ax-style agent that does its own retrieval and ranking,
 * then asks the MCP server to preview and create a custom context pack from an
 * explicit selection manifest.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

const LONG_AUTH_CONTENT =
  'Keto authorization debugging notes describe tuple checks, auth middleware ordering, token refresh behavior, and diary pack composition details. '.repeat(
    8,
  );

type ToolTextContent = Array<{ type: string; text: string }>;

function parseToolJson<T>(content: ToolTextContent): T {
  return JSON.parse(content[0].text) as T;
}

async function connectClient(
  baseUrl: string,
  clientId: string,
  clientSecret: string,
  name: string,
): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(
    new URL(`${baseUrl}/mcp`),
    {
      requestInit: {
        headers: {
          'X-Client-Id': clientId,
          'X-Client-Secret': clientSecret,
        },
      },
    },
  );

  const client = new Client({ name, version: '1.0.0' });
  await client.connect(transport);
  return client;
}

describe('Custom pack tools E2E', () => {
  let harness: McpTestHarness;
  let clientA: Client;
  let clientB: Client;
  let agentBDiaryId: string;
  let agentAEntryIds: string[] = [];

  beforeAll(async () => {
    harness = await createMcpTestHarness();
    const agentB = await harness.createAgent('e2e-mcp-custom-pack-agent-b');
    agentBDiaryId = agentB.privateDiaryId;

    clientA = await connectClient(
      harness.mcpBaseUrl,
      harness.agent.clientId,
      harness.agent.clientSecret,
      'e2e-mcp-custom-pack-agent-a',
    );
    clientB = await connectClient(
      harness.mcpBaseUrl,
      agentB.agent.clientId,
      agentB.agent.clientSecret,
      'e2e-mcp-custom-pack-agent-b',
    );

    const seededEntries = await Promise.all([
      clientA.callTool({
        name: 'entries_create',
        arguments: {
          diary_id: harness.privateDiaryId,
          content: LONG_AUTH_CONTENT,
          tags: ['auth', 'keto'],
          title: 'Keto authorization debugging',
        },
      }),
      clientA.callTool({
        name: 'entries_create',
        arguments: {
          diary_id: harness.privateDiaryId,
          content:
            LONG_AUTH_CONTENT +
            ' Added notes about rate limiting and race-condition mitigation.',
          tags: ['auth', 'rate-limit'],
          title: 'Auth rate limit investigation',
        },
      }),
      clientA.callTool({
        name: 'entries_create',
        arguments: {
          diary_id: harness.privateDiaryId,
          content:
            LONG_AUTH_CONTENT +
            ' Persistence path validates entry ownership before pack creation.',
          tags: ['context-packs', 'auth'],
          title: 'Custom pack validation notes',
        },
      }),
      clientA.callTool({
        name: 'entries_create',
        arguments: {
          diary_id: harness.privateDiaryId,
          content:
            'Irrelevant deployment notes about Fly.io machine sizing and image rollout.',
          tags: ['deployment'],
          title: 'Deployment unrelated to auth',
        },
      }),
    ]);

    for (const result of seededEntries) {
      const content = result.content as ToolTextContent;
      expect(
        result.isError,
        `entries_create failed: ${content[0].text}`,
      ).toBeUndefined();
    }

    agentAEntryIds = seededEntries.map((result) => {
      const parsed = parseToolJson<{ id: string }>(
        result.content as ToolTextContent,
      );
      return parsed.id;
    });

    const foreignEntryResult = await clientB.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: agentBDiaryId,
        content: 'Agent B private notes',
        tags: ['auth'],
        title: 'Agent B auth notes',
      },
    });
    const foreignContent = foreignEntryResult.content as ToolTextContent;
    expect(
      foreignEntryResult.isError,
      `entries_create failed for agent B: ${foreignContent[0].text}`,
    ).toBeUndefined();
  }, 90_000);

  afterAll(async () => {
    await clientA?.close();
    await clientB?.close();
    await harness?.teardown();
  });

  it('supports an Ax-style retrieval, preview, and create flow', async () => {
    const searchResult = await clientA.callTool({
      name: 'entries_search',
      arguments: {
        diary_id: harness.privateDiaryId,
        query: 'Keto authorization debugging',
        limit: 3,
      },
    });
    const searchContent = searchResult.content as ToolTextContent;
    expect(
      searchResult.isError,
      `entries_search failed: ${searchContent[0].text}`,
    ).toBeUndefined();
    const searchParsed = parseToolJson<{ results: Array<{ id: string }> }>(
      searchContent,
    );

    const listResult = await clientA.callTool({
      name: 'entries_list',
      arguments: {
        diary_id: harness.privateDiaryId,
        tags: ['auth'],
        limit: 10,
      },
    });
    const listContent = listResult.content as ToolTextContent;
    expect(
      listResult.isError,
      `entries_list failed: ${listContent[0].text}`,
    ).toBeUndefined();
    const listParsed = parseToolJson<{ items: Array<{ id: string }> }>(
      listContent,
    );

    const rankedEntryIds = [
      ...searchParsed.results.map((entry) => entry.id),
      ...listParsed.items.map((entry) => entry.id),
    ].filter((entryId, index, all) => all.indexOf(entryId) === index);
    const selectedEntries = rankedEntryIds
      .slice(0, 3)
      .map((entryId, index) => ({
        entry_id: entryId,
        rank: index + 1,
      }));
    expect(selectedEntries).toHaveLength(3);

    const packsBeforeResult = await clientA.callTool({
      name: 'packs_list',
      arguments: { diary_id: harness.privateDiaryId, limit: 20 },
    });
    const packsBeforeContent = packsBeforeResult.content as ToolTextContent;
    expect(
      packsBeforeResult.isError,
      `packs_list failed: ${packsBeforeContent[0].text}`,
    ).toBeUndefined();
    const packsBeforeParsed = parseToolJson<{ items: unknown[] }>(
      packsBeforeContent,
    );
    expect(packsBeforeParsed.items).toHaveLength(0);

    const previewResult = await clientA.callTool({
      name: 'packs_preview',
      arguments: {
        diary_id: harness.privateDiaryId,
        params: {
          recipe: 'ax-agent-selected',
          taskPrompt: 'Keto authorization debugging',
          selectionMethod: 'rag-multi-query',
        },
        entries: selectedEntries,
        token_budget: 260,
      },
    });
    const previewContent = previewResult.content as ToolTextContent;
    expect(
      previewResult.isError,
      `packs_preview failed: ${previewContent[0].text}`,
    ).toBeUndefined();
    const previewParsed = parseToolJson<{
      packType: string;
      packCid: string;
      entries: Array<{ rank: number; compressionLevel: string }>;
      compileStats: { totalTokens: number };
    }>(previewContent);
    expect(previewParsed.packType).toBe('custom');
    expect(previewParsed.entries.map((entry) => entry.rank)).toEqual(
      [...previewParsed.entries.map((entry) => entry.rank)].sort(
        (a, b) => a - b,
      ),
    );
    expect(previewParsed.compileStats.totalTokens).toBeLessThanOrEqual(260);
    expect(
      previewParsed.entries.some((entry) => entry.compressionLevel !== 'full'),
    ).toBe(true);

    const packsAfterPreviewResult = await clientA.callTool({
      name: 'packs_list',
      arguments: { diary_id: harness.privateDiaryId, limit: 20 },
    });
    const packsAfterPreviewParsed = parseToolJson<{ items: unknown[] }>(
      packsAfterPreviewResult.content as ToolTextContent,
    );
    expect(packsAfterPreviewResult.isError).toBeUndefined();
    expect(packsAfterPreviewParsed.items).toHaveLength(0);

    const createResult = await clientA.callTool({
      name: 'packs_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        params: {
          recipe: 'ax-agent-selected',
          taskPrompt: 'Keto authorization debugging',
          selectionMethod: 'rag-multi-query',
        },
        entries: selectedEntries,
        token_budget: 260,
        pinned: true,
      },
    });
    const createContent = createResult.content as ToolTextContent;
    expect(
      createResult.isError,
      `packs_create failed: ${createContent[0].text}`,
    ).toBeUndefined();
    const createParsed = parseToolJson<{
      packType: string;
      packCid: string;
      entries: Array<{ entryId: string }>;
    }>(createContent);
    expect(createParsed.packType).toBe('custom');
    expect(createParsed.entries.length).toBeGreaterThan(0);

    const packsAfterCreateResult = await clientA.callTool({
      name: 'packs_list',
      arguments: {
        diary_id: harness.privateDiaryId,
        expand: 'entries',
        limit: 20,
      },
    });
    const packsAfterCreateContent =
      packsAfterCreateResult.content as ToolTextContent;
    expect(
      packsAfterCreateResult.isError,
      `packs_list failed after create: ${packsAfterCreateContent[0].text}`,
    ).toBeUndefined();
    const packsAfterCreateParsed = parseToolJson<{
      items: Array<{
        id: string;
        packCid: string;
        packType: string;
        pinned: boolean;
        entries?: Array<{ entryId: string }>;
      }>;
    }>(packsAfterCreateContent);
    expect(packsAfterCreateParsed.items).toHaveLength(1);

    const persistedPack = packsAfterCreateParsed.items.find(
      (pack) => pack.packCid === createParsed.packCid,
    );
    expect(persistedPack).toBeDefined();
    expect(persistedPack!.packType).toBe('custom');
    expect(persistedPack!.pinned).toBe(true);

    const getResult = await clientA.callTool({
      name: 'packs_get',
      arguments: {
        pack_id: persistedPack!.id,
        expand: 'entries',
      },
    });
    const getContent = getResult.content as ToolTextContent;
    expect(
      getResult.isError,
      `packs_get failed: ${getContent[0].text}`,
    ).toBeUndefined();
    const getParsed = parseToolJson<{
      id: string;
      entries?: Array<{ entryId: string }>;
    }>(getContent);
    expect(getParsed.id).toBe(persistedPack!.id);
    expect(getParsed.entries?.every((entry) => entry.entryId)).toBe(true);
  });

  it('blocks cross-agent preview and pack retrieval', async () => {
    const previewResult = await clientB.callTool({
      name: 'packs_preview',
      arguments: {
        diary_id: harness.privateDiaryId,
        params: { recipe: 'ax-agent-selected' },
        entries: [{ entry_id: agentAEntryIds[0], rank: 1 }],
      },
    });
    const previewContent = previewResult.content as ToolTextContent;
    expect(previewResult.isError).toBe(true);
    expect(previewContent[0].text).toMatch(/not found|forbidden/i);

    const createResult = await clientA.callTool({
      name: 'packs_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        params: { recipe: 'ax-agent-selected' },
        entries: [{ entry_id: agentAEntryIds[0], rank: 1 }],
      },
    });
    const createParsed = parseToolJson<{ packCid: string }>(
      createResult.content as ToolTextContent,
    );
    expect(createResult.isError).toBeUndefined();

    const packsListResult = await clientA.callTool({
      name: 'packs_list',
      arguments: { diary_id: harness.privateDiaryId, limit: 20 },
    });
    const packsListParsed = parseToolJson<{
      items: Array<{ id: string; packCid: string }>;
    }>(packsListResult.content as ToolTextContent);
    const createdPack = packsListParsed.items.find(
      (pack) => pack.packCid === createParsed.packCid,
    );
    expect(createdPack).toBeDefined();

    const getResult = await clientB.callTool({
      name: 'packs_get',
      arguments: { pack_id: createdPack!.id },
    });
    const getContent = getResult.content as ToolTextContent;
    expect(getResult.isError).toBe(true);
    expect(getContent[0].text).toMatch(/not found|forbidden|not authorized/i);
  });

  it('rejects selections that include entries outside the target diary', async () => {
    const result = await clientB.callTool({
      name: 'packs_create',
      arguments: {
        diary_id: agentBDiaryId,
        params: { recipe: 'ax-agent-selected' },
        entries: [{ entry_id: agentAEntryIds[0], rank: 1 }],
      },
    });
    const content = result.content as ToolTextContent;
    expect(result.isError).toBe(true);
    expect(content[0].text).toMatch(/Entries not found in diary/);
  });
});
