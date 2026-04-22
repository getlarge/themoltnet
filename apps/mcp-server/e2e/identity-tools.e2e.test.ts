/**
 * E2E: Identity Tools — moltnet_whoami, prompts, self resources, bootstrap flow
 *
 * Tests moltnet_whoami, identity_bootstrap prompt, sign_message prompt,
 * self resources (moltnet://self/whoami, moltnet://self/soul),
 * the full bootstrap flow, identity resource, and recent diary resource.
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

  it('calls moltnet_whoami and gets agent identity with profile', async () => {
    requireSetup();
    const result = await client.callTool({
      name: 'moltnet_whoami',
      arguments: { diary_id: harness.privateDiaryId },
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
      profile: { whoami: unknown; soul: unknown };
      hint?: string;
    };
    expect(parsed.authenticated).toBe(true);
    expect(parsed.identity).toBeDefined();
    expect(parsed.identity.identityId).toBeDefined();
    expect(parsed.identity.clientId).toBeDefined();
    expect(parsed.identity.fingerprint).toBe(harness.agent.keyPair.fingerprint);
    // Profile fields are present (null before bootstrap)
    expect(parsed.profile).toBeDefined();
    expect(parsed.profile.whoami).toBeNull();
    expect(parsed.profile.soul).toBeNull();
    // Hint nudges the agent to bootstrap
    expect(parsed.hint).toContain('identity_bootstrap');
  });

  it('calls identity_bootstrap prompt and gets guidance', async () => {
    requireSetup();
    const result = await client.getPrompt({
      name: 'identity_bootstrap',
      arguments: { diary_id: harness.privateDiaryId },
    });

    expect(result.messages).toBeDefined();
    expect(result.messages.length).toBeGreaterThanOrEqual(1);
    const text = (result.messages[0].content as { type: string; text: string })
      .text;
    // Should contain the agent's fingerprint
    expect(text).toContain(harness.agent.keyPair.fingerprint);
    // Should guide creation of missing entries
    expect(text).toContain('Whoami (missing)');
    expect(text).toContain('Soul (missing)');
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

  it('self resources return exists:false before bootstrap', async () => {
    requireSetup();
    // self/whoami and self/soul are template resources (moltnet://diaries/{diaryId}/self/{type}).
    // The fastify-mcp plugin routes readResource via exact-match only — template expansion
    // for readResource is not supported. Coverage for these handlers is in unit tests.
    // Here we verify the moltnet_whoami tool reflects the same state.
    const result = await client.callTool({
      name: 'moltnet_whoami',
      arguments: { diary_id: harness.privateDiaryId },
    });
    const parsed = result.structuredContent as {
      profile: { whoami: null; soul: null };
    };
    expect(parsed.profile.whoami).toBeNull();
    expect(parsed.profile.soul).toBeNull();
  });

  it('full bootstrap flow: create entries, verify whoami and resources', async () => {
    requireSetup();

    // 1. Create whoami entry
    const whoamiCreate = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'I am E2E Test Agent, a MoltNet integration test agent.',
        title: 'I am E2E Test Agent',
        tags: ['system', 'identity'],
        entry_type: 'identity',
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

    // 2. Create soul entry
    const soulCreate = await client.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: 'I value correctness and thorough testing.',
        title: 'What I care about',
        tags: ['system', 'soul'],
        entry_type: 'soul',
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
      arguments: { diary_id: harness.privateDiaryId },
    });
    const whoamiParsed = whoamiResult.structuredContent as {
      profile: {
        whoami: { content: string } | null;
        soul: { content: string } | null;
      };
      hint?: string;
    };
    expect(whoamiParsed.profile.whoami).not.toBeNull();
    expect(whoamiParsed.profile.whoami?.content).toContain('E2E Test Agent');
    expect(whoamiParsed.profile.soul).not.toBeNull();
    expect(whoamiParsed.profile.soul?.content).toContain('correctness');
    expect(whoamiParsed.hint).toBeUndefined();

    // 4. Verify prompt shows established state
    const promptResult = await client.getPrompt({
      name: 'identity_bootstrap',
      arguments: { diary_id: harness.privateDiaryId },
    });
    const promptText = (
      promptResult.messages[0].content as { type: string; text: string }
    ).text;
    expect(promptText).toContain('Whoami (established)');
    expect(promptText).toContain('Soul (established)');
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
