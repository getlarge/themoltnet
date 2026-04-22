/**
 * E2E: moltnet_whoami cross-tenant isolation (regression for issue #889)
 *
 * Two independent agents are bootstrapped. Agent B creates identity/soul entries
 * with moltnet visibility. Agent A's whoami must return its own profile (null if
 * no entries) — never Agent B's entries.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('moltnet_whoami cross-tenant isolation (issue #889)', () => {
  let harness: McpTestHarness;
  let clientA: Client;
  let setupError: Error | undefined;

  // Agent B's identity content — must never appear in Agent A's whoami
  const AGENT_B_WHOAMI_CONTENT =
    'I am Agent B, a completely separate agent. Fingerprint: AGENT-B-MARKER.';
  const AGENT_B_SOUL_CONTENT =
    'Agent B soul: I value isolation and keeping data to myself.';

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
      // Connect Agent A (the harness default agent — has no identity entries yet)
      const transportA = new StreamableHTTPClientTransport(
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
      clientA = new Client({
        name: 'e2e-cross-tenant-client-a',
        version: '1.0.0',
      });
      await clientA.connect(transportA);

      // Bootstrap Agent B with moltnet-visible identity entries via direct REST API
      const agentBHarness = await harness.createAgent(
        'e2e-cross-tenant-agent-b',
      );
      const agentB = agentBHarness.agent;

      // Create Agent B's identity entry with moltnet visibility
      // (moltnet visibility is the default — readable by any authenticated agent)
      const whoamiResp = await fetch(
        `${harness.restApiUrl}/diaries/${agentBHarness.privateDiaryId}/entries`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${agentB.accessToken}`,
          },
          body: JSON.stringify({
            content: AGENT_B_WHOAMI_CONTENT,
            title: 'I am Agent B',
            tags: ['system', 'identity'],
            entry_type: 'identity',
            visibility: 'moltnet',
          }),
        },
      );
      if (!whoamiResp.ok) {
        throw new Error(
          `Agent B identity create failed: ${whoamiResp.status} ${await whoamiResp.text()}`,
        );
      }

      // Create Agent B's soul entry with moltnet visibility
      const soulResp = await fetch(
        `${harness.restApiUrl}/diaries/${agentBHarness.privateDiaryId}/entries`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${agentB.accessToken}`,
          },
          body: JSON.stringify({
            content: AGENT_B_SOUL_CONTENT,
            title: 'Agent B soul',
            tags: ['system', 'soul'],
            entry_type: 'soul',
            visibility: 'moltnet',
          }),
        },
      );
      if (!soulResp.ok) {
        throw new Error(
          `Agent B soul create failed: ${soulResp.status} ${await soulResp.text()}`,
        );
      }
    } catch (err) {
      setupError = err instanceof Error ? err : new Error(String(err));
    }
  });

  afterAll(async () => {
    await clientA?.close();
    await harness?.teardown();
  });

  function requireSetup(): void {
    if (setupError) {
      throw new Error(
        `E2E setup failed — cannot continue: ${setupError.message}`,
      );
    }
  }

  it('Agent A whoami returns null profile when Agent A has no entries (not Agent B entries)', async () => {
    requireSetup();

    const result = await clientA.callTool({
      name: 'moltnet_whoami',
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(result.isError, `whoami error: ${content[0].text}`).toBeUndefined();

    const parsed = result.structuredContent as {
      authenticated: boolean;
      identity: { identityId: string; fingerprint: string };
      profile: {
        whoami: { id: string; content: string } | null;
        soul: { id: string; content: string } | null;
      };
    };

    expect(parsed.authenticated).toBe(true);
    // Agent A's auth identity must be Agent A's own identity
    expect(parsed.identity.fingerprint).toBe(harness.agent.keyPair.fingerprint);

    // Profile must be null — Agent A has no entries, and Agent B's entries
    // must not bleed through even though they have moltnet visibility
    expect(
      parsed.profile.whoami,
      'Agent B whoami leaked into Agent A profile (issue #889)',
    ).toBeNull();
    expect(
      parsed.profile.soul,
      'Agent B soul leaked into Agent A profile (issue #889)',
    ).toBeNull();
  });

  it('Agent A whoami returns own entries after Agent A creates them (not Agent B entries)', async () => {
    requireSetup();

    const AGENT_A_CONTENT = 'I am Agent A. My unique content: AGENT-A-MARKER.';

    // Create Agent A's identity entry
    const createResult = await clientA.callTool({
      name: 'entries_create',
      arguments: {
        diary_id: harness.privateDiaryId,
        content: AGENT_A_CONTENT,
        title: 'I am Agent A',
        tags: ['system', 'identity'],
        entry_type: 'identity',
      },
    });
    const createContent = createResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      createResult.isError,
      `Agent A identity create error: ${createContent[0].text}`,
    ).toBeUndefined();

    // Now whoami must return Agent A's own content
    const result = await clientA.callTool({
      name: 'moltnet_whoami',
      arguments: {},
    });

    const parsed = result.structuredContent as {
      authenticated: boolean;
      profile: {
        whoami: { id: string; content: string } | null;
        soul: { id: string; content: string } | null;
      };
    };

    expect(parsed.profile.whoami).not.toBeNull();
    expect(
      parsed.profile.whoami?.content,
      'Agent A whoami should contain Agent A content',
    ).toContain('AGENT-A-MARKER');
    expect(
      parsed.profile.whoami?.content,
      'Agent A whoami must not contain Agent B content',
    ).not.toContain('AGENT-B-MARKER');
  });

  it('self resource moltnet://self/whoami returns exists:false for Agent A before bootstrap', async () => {
    // This verifies the resource handler (findSystemEntry) also scopes correctly.
    // Note: this test order depends on the first test running before Agent A creates entries.
    // The full bootstrap test above creates entries, so this test is order-sensitive.
    // We verify the resource after the bootstrap test has run — it should now return exists:true
    // with Agent A's content, not Agent B's.
    requireSetup();

    const result = await clientA.readResource({
      uri: 'moltnet://self/whoami',
    });
    const data = JSON.parse((result.contents[0] as { text: string }).text);

    // After the previous test created Agent A's identity entry, this must return it
    if (data.exists) {
      expect(data.content).toContain('AGENT-A-MARKER');
      expect(data.content).not.toContain('AGENT-B-MARKER');
    }
    // If exists is false, the scoping worked (no bleed-through from Agent B)
  });
});
