/**
 * E2E: Diary Tools — diary CRUD, entry CRUD, distill
 *
 * Tests diaries_list, diaries_create, diaries_get, diaries_consolidate,
 * diaries_compile, entries_create, entries_get, entries_list.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Diary Tools E2E', () => {
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
      client = new Client({ name: 'e2e-diary-client', version: '1.0.0' });
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

  // ── Direct REST API sanity check ──

  it('direct REST API diary create works with token', async () => {
    requireSetup();
    const response = await fetch(
      `${harness.restApiUrl}/diaries/${harness.privateDiaryId}/entries`,
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

  // ── Diaries catalog tools ──

  it('diaries_list returns the agent diaries including the harness diaries', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'diaries_list',
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `diaries_list error: ${content[0].text}`,
    ).toBeUndefined();
    const parsed = JSON.parse(content[0].text);
    expect(parsed.items).toBeDefined();
    const ids = parsed.items.map((d: { id: string }) => d.id);
    expect(ids).toContain(harness.privateDiaryId);
    expect(ids).toContain(harness.publicDiaryId);
  });

  it('diaries_create creates a new diary and diaries_get retrieves it', async () => {
    requireSetup();
    const createResult = await client.callTool({
      name: 'diaries_create',
      arguments: { name: 'e2e-test-diary', team_id: harness.personalTeamId },
    });

    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      createResult.isError,
      `diaries_create error: ${createContent[0].text}`,
    ).toBeUndefined();
    const created = JSON.parse(createContent[0].text);
    expect(created.id).toBeDefined();
    expect(created.name).toBe('e2e-test-diary');

    // Read it back
    const getResult = await client.callTool({
      name: 'diaries_get',
      arguments: { diary_id: created.id },
    });

    const getContent = getResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      getResult.isError,
      `diaries_get error: ${getContent[0].text}`,
    ).toBeUndefined();
    const getParsed = JSON.parse(getContent[0].text);
    expect(getParsed.id).toBe(created.id);
    expect(getParsed.name).toBe('e2e-test-diary');
  });

  it('diaries_get returns error for unknown diary id', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'diaries_get',
      arguments: { diary_id: '00000000-0000-0000-0000-000000000000' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).toBe(true);
    expect(content[0].text).toMatch(/not found|Failed/i);
  });

  it('diaries_consolidate and diaries_compile return distill outputs', async () => {
    requireSetup();
    const createResult = await client.callTool({
      name: 'diaries_create',
      arguments: {
        name: 'e2e-distill-diary',
        team_id: harness.personalTeamId,
      },
    });
    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(createResult.isError).toBeUndefined();
    const createdDiary = JSON.parse(createContent[0].text) as {
      id: string;
    };

    const consolidateResult = await client.callTool({
      name: 'diaries_consolidate',
      arguments: { diary_id: createdDiary.id },
    });
    const consolidateContent = consolidateResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      consolidateResult.isError,
      `diaries_consolidate error: ${consolidateContent[0].text}`,
    ).toBeUndefined();
    const consolidateParsed = JSON.parse(consolidateContent[0].text);
    expect(consolidateParsed).toHaveProperty('workflowId');
    expect(consolidateParsed).toHaveProperty('clusters');

    const compileResult = await client.callTool({
      name: 'diaries_compile',
      arguments: { diary_id: createdDiary.id, token_budget: 4000 },
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
    expect(compileParsed).toHaveProperty('packCid');
    expect(compileParsed).toHaveProperty('entries');
    expect(compileParsed).toHaveProperty('compileStats');
  });

  it('diaries_compile accepts temporal and entryType filter params', async () => {
    requireSetup();

    // Use a past cutoff so no entries qualify → compile returns empty pack
    const compileResult = await client.callTool({
      name: 'diaries_compile',
      arguments: {
        diary_id: harness.privateDiaryId,
        token_budget: 4000,
        created_before: '2020-01-01T00:00:00Z',
        entry_types: ['semantic', 'procedural'],
      },
    });
    const compileContent = compileResult.content as Array<{
      type: string;
      text: string;
    }>;

    // Should succeed (not error) — the params are accepted by the schema
    // The pack may have 0 entries since the cutoff is in the distant past
    if (compileResult.isError) {
      // If compile errors on empty input, that's acceptable — the point is
      // the params were accepted and forwarded, not rejected as unknown
      expect(compileContent[0].text).not.toMatch(/unknown.*param/i);
    } else {
      const parsed = JSON.parse(compileContent[0].text);
      expect(parsed).toHaveProperty('packCid');
      expect(parsed.entries).toHaveLength(0);
    }
  });

  // ── Entry CRUD via MCP tools ──

  it('creates and reads back a diary entry', async () => {
    requireSetup();
    const createResult = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'MCP e2e test entry',
      },
    });

    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      createResult.isError,
      `entries_create error: ${createContent[0].text}`,
    ).toBeUndefined();
    const created = JSON.parse(createContent[0].text);
    expect(created.id).toBeDefined();
    expect(created.content).toBe('MCP e2e test entry');

    // Read back
    const getResult = await client.callTool({
      name: 'entries_get',
      arguments: { diary_id: harness.privateDiaryId, entry_id: created.id },
    });

    const getContent = getResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      getResult.isError,
      `entries_get error: ${getContent[0].text}`,
    ).toBeUndefined();
    const fetched = JSON.parse(getContent[0].text);
    expect(fetched.id).toBe(created.id);
    expect(fetched.content).toBe('MCP e2e test entry');
  });

  it('supports diary_id for read operations', async () => {
    requireSetup();
    const createResult = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'MCP diary id ref test',
      },
    });
    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      createResult.isError,
      `entries_create error: ${createContent[0].text}`,
    ).toBeUndefined();
    const created = JSON.parse(createContent[0].text) as { id: string };

    const getResult = await client.callTool({
      name: 'entries_get',
      arguments: { diary_id: harness.privateDiaryId, entry_id: created.id },
    });
    const getContent = getResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      getResult.isError,
      `entries_get by diary id error: ${getContent[0].text}`,
    ).toBeUndefined();
  });

  it('ignores diary_id mismatch for by-id entry reads', async () => {
    requireSetup();
    const createResult = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'MCP wrong diary ref test',
      },
    });
    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(createResult.isError).toBeUndefined();
    const created = JSON.parse(createContent[0].text) as { id: string };

    const getResult = await client.callTool({
      name: 'entries_get',
      arguments: { diary_id: 'does-not-exist', entry_id: created.id },
    });
    const getContent = getResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      getResult.isError,
      `entries_get with mismatched diary_id error: ${getContent[0].text}`,
    ).toBeUndefined();
  });

  it('lists diary entries', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'entries_list',
      arguments: { diary_id: harness.privateDiaryId },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `entries_list error: ${content[0].text}`,
    ).toBeUndefined();
    const parsed = JSON.parse(content[0].text);
    expect(parsed.items).toBeDefined();
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);
  });

  it('batch-fetches entries by ids', async () => {
    requireSetup();
    const createA = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'MCP ids-filter entry A',
      },
    });
    const createB = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'MCP ids-filter entry B',
      },
    });
    const createC = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'MCP ids-filter entry C (excluded)',
      },
    });

    const parseId = (result: typeof createA) => {
      const content = result.content as Array<{ type: string; text: string }>;
      return JSON.parse(content[0].text).id as string;
    };
    const idA = parseId(createA);
    const idB = parseId(createB);
    const idC = parseId(createC);

    const result = await client.callTool({
      name: 'entries_list',
      arguments: {
        diary_id: harness.privateDiaryId,
        ids: [idA, idB],
      },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `entries_list with ids error: ${content[0].text}`,
    ).toBeUndefined();
    const parsed = JSON.parse(content[0].text);
    const returnedIds = parsed.items.map((e: { id: string }) => e.id);
    expect(returnedIds).toHaveLength(2);
    expect(returnedIds).toEqual(expect.arrayContaining([idA, idB]));
    expect(returnedIds).not.toContain(idC);
  });

  it('returns error when listing an unknown diary_id', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'entries_list',
      arguments: { diary_id: '00000000-0000-0000-0000-000000000000' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).toBe(true);
    expect(content[0].text).toMatch(/Diary not found|not found/i);
  });

  it('validates required diary_id for scoped entry tools', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'entries_create',
      arguments: { content: 'missing diary ref should fail' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError).toBe(true);
    expect(content[0].text).toContain('Invalid tool arguments');
  });
});
