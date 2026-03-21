/**
 * E2E: Relation Tools — relations_create, relations_list, relations_update, relations_delete
 *
 * Tests the full CRUD lifecycle for entry relations.
 * Each test sets up its own entries in beforeAll/inline to remain self-contained.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Relation Tools E2E', () => {
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
      client = new Client({ name: 'e2e-relation-client', version: '1.0.0' });
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

  it('relations_create creates a relation and relations_list retrieves it', async () => {
    requireSetup();

    // Create two entries in the private diary to relate
    const createA = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'Relation source entry',
      },
    });
    const contentA = createA.content as Array<{ type: string; text: string }>;
    expect(
      createA.isError,
      `entries_create A error: ${contentA[0].text}`,
    ).toBeUndefined();
    const entryA = JSON.parse(contentA[0].text).entry as { id: string };

    const createB = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'Relation target entry',
      },
    });
    const contentB = createB.content as Array<{ type: string; text: string }>;
    expect(
      createB.isError,
      `entries_create B error: ${contentB[0].text}`,
    ).toBeUndefined();
    const entryB = JSON.parse(contentB[0].text).entry as { id: string };

    // Create relation
    const createRelResult = await client.callTool({
      name: 'relations_create',
      arguments: {
        entry_id: entryA.id,
        target_id: entryB.id,
        relation: 'elaborates',
      },
    });
    const createRelContent = createRelResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      createRelResult.isError,
      `relations_create error: ${createRelContent[0].text}`,
    ).toBeUndefined();
    const createRelParsed = JSON.parse(createRelContent[0].text);
    expect(createRelParsed.success).toBe(true);
    expect(createRelParsed.relation).toBeDefined();
    const relation = createRelParsed.relation as {
      id: string;
      sourceId: string;
      targetId: string;
      relation: string;
      status: string;
    };
    expect(relation.id).toBeDefined();
    expect(relation.sourceId).toBe(entryA.id);
    expect(relation.targetId).toBe(entryB.id);
    expect(relation.relation).toBe('elaborates');
    expect(relation.status).toBe('proposed');

    // List relations
    const listRelResult = await client.callTool({
      name: 'relations_list',
      arguments: { entry_id: entryA.id },
    });
    const listRelContent = listRelResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      listRelResult.isError,
      `relations_list error: ${listRelContent[0].text}`,
    ).toBeUndefined();
    const listRelParsed = JSON.parse(listRelContent[0].text);
    expect(Array.isArray(listRelParsed.items)).toBe(true);
    const found = listRelParsed.items.find(
      (r: { id: string }) => r.id === relation.id,
    );
    expect(found, `Relation ${relation.id} not found in list`).toBeDefined();
  });

  it('relations_update accepts a proposed relation', async () => {
    requireSetup();

    // Create two entries
    const createA = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'Update-test source entry',
      },
    });
    const entryA = JSON.parse(
      (createA.content as Array<{ type: string; text: string }>)[0].text,
    ).entry as { id: string };

    const createB = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'Update-test target entry',
      },
    });
    const entryB = JSON.parse(
      (createB.content as Array<{ type: string; text: string }>)[0].text,
    ).entry as { id: string };

    // Create a proposed relation
    const createRelResult = await client.callTool({
      name: 'relations_create',
      arguments: {
        entry_id: entryA.id,
        target_id: entryB.id,
        relation: 'supports',
      },
    });
    const relation = JSON.parse(
      (createRelResult.content as Array<{ type: string; text: string }>)[0]
        .text,
    ).relation as { id: string; status: string };
    expect(relation.status).toBe('proposed');

    // Accept it
    const updateResult = await client.callTool({
      name: 'relations_update',
      arguments: { relation_id: relation.id, status: 'accepted' },
    });
    const updateContent = updateResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      updateResult.isError,
      `relations_update error: ${updateContent[0].text}`,
    ).toBeUndefined();
    const updateParsed = JSON.parse(updateContent[0].text);
    expect(updateParsed.success).toBe(true);
    expect(updateParsed.relation.status).toBe('accepted');
  });

  it('relations_delete removes a relation', async () => {
    requireSetup();

    // Create two entries
    const createA = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'Delete-test source entry',
      },
    });
    const entryA = JSON.parse(
      (createA.content as Array<{ type: string; text: string }>)[0].text,
    ).entry as { id: string };

    const createB = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'Delete-test target entry',
      },
    });
    const entryB = JSON.parse(
      (createB.content as Array<{ type: string; text: string }>)[0].text,
    ).entry as { id: string };

    // Create relation
    const createRelResult = await client.callTool({
      name: 'relations_create',
      arguments: {
        entry_id: entryA.id,
        target_id: entryB.id,
        relation: 'references',
      },
    });
    const relation = JSON.parse(
      (createRelResult.content as Array<{ type: string; text: string }>)[0]
        .text,
    ).relation as { id: string };

    // Delete it
    const deleteResult = await client.callTool({
      name: 'relations_delete',
      arguments: { relation_id: relation.id },
    });
    const deleteContent = deleteResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      deleteResult.isError,
      `relations_delete error: ${deleteContent[0].text}`,
    ).toBeUndefined();
    const deleteParsed = JSON.parse(deleteContent[0].text);
    expect(deleteParsed.success).toBe(true);

    // Verify it's gone from list
    const listResult = await client.callTool({
      name: 'relations_list',
      arguments: { entry_id: entryA.id },
    });
    const listParsed = JSON.parse(
      (listResult.content as Array<{ type: string; text: string }>)[0].text,
    );
    const stillPresent = listParsed.items.find(
      (r: { id: string }) => r.id === relation.id,
    );
    expect(stillPresent).toBeUndefined();
  });
});
