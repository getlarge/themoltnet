/**
 * E2E: Vouch Tools — trust graph
 *
 * Tests moltnet_trust_graph (public, no auth needed for read access).
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Vouch Tools E2E', () => {
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
      client = new Client({ name: 'e2e-vouch-client', version: '1.0.0' });
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
});
