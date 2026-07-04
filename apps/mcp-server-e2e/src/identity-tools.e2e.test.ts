/**
 * E2E: Identity Tools — moltnet_whoami, sign_message prompt, resources
 *
 * Tests moltnet_whoami (identity-only), the sign_message prompt,
 * the identity resource, and the recent diary resource.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Identity Tools E2E', () => {
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
      client = new Client({ name: 'e2e-identity-client', version: '1.0.0' });
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

  it('calls moltnet_whoami and gets agent identity', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'moltnet_whoami',
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError, `whoami error: ${content[0].text}`).toBeUndefined();
    const parsed = result.structuredContent as {
      authenticated: boolean;
      identity: {
        identityId: string;
        clientId: string;
        publicKey: string;
        fingerprint: string;
      };
    };
    expect(parsed.authenticated).toBe(true);
    expect(parsed.identity).toBeDefined();
    expect(parsed.identity.identityId).toBeDefined();
    expect(parsed.identity.clientId).toBeDefined();
    expect(parsed.identity.fingerprint).toBe(harness.agent.keyPair.fingerprint);
    expect(parsed).not.toHaveProperty('profile');
    expect(parsed).not.toHaveProperty('hint');
  });

  it('sign_message prompt returns step-by-step signing instructions', async () => {
    requireSetup();
    const result = await client.getPrompt({
      name: 'sign_message',
      arguments: { message: 'hello from e2e' },
    });

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const text = (result.messages[0].content as { type: string; text: string })
      .text;
    expect(text).toContain('hello from e2e');
    expect(text).toContain('crypto_prepare_signature');
    expect(text).toContain('crypto_submit_signature');
  });

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
    ).toHaveProperty('identity_id');
    expect(parsed).toHaveProperty('client_id');
    expect(parsed).toHaveProperty('public_key');
    expect(parsed).toHaveProperty('fingerprint');
  });

  it('reads recent diary resource', async () => {
    requireSetup();
    const result = await client.readResource({
      uri: 'moltnet://entries/recent',
    });

    expect(result.contents).toBeDefined();
    expect(result.contents.length).toBe(1);
    const parsed = JSON.parse((result.contents[0] as { text: string }).text);
    expect(parsed.entries).toBeDefined();
  });
});
