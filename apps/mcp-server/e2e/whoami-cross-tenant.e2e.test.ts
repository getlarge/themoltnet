/**
 * E2E: moltnet_whoami cross-tenant isolation (regression for issue #889)
 *
 * Two independent agents are bootstrapped. Agent B creates identity/soul entries
 * in its public diary (readable by any authenticated agent). Agent A's whoami
 * must return its own profile (null if no entries) — never Agent B's entries,
 * even though Agent B's entries are in a publicly readable diary.
 *
 * This test catches the specific regression: before the fix, searchDiary without
 * diaryId scoping would return Agent B's public entries when Agent A called whoami.
 * After the fix, only diaries created by Agent A (createdBy === identityId) are
 * searched, so Agent B's public diary is excluded entirely.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createClient, createDiaryEntry } from '@moltnet/api-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

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

      // Bootstrap Agent B and create identity entries in Agent B's PUBLIC diary.
      // The public diary is readable by any authenticated agent — this is the
      // exact scenario that triggered issue #889 (unscoped searchDiary returns
      // other agents' publicly visible entries).
      const agentBHarness = await harness.createAgent(
        'e2e-cross-tenant-agent-b',
      );
      const agentB = agentBHarness.agent;

      const apiClient = createClient({ baseUrl: harness.restApiUrl });

      // Create Agent B's identity entry in Agent B's PUBLIC diary
      // so any authenticated agent (including Agent A) can read it.
      const { error: whoamiError } = await createDiaryEntry({
        client: apiClient,
        auth: () => agentB.accessToken,
        path: { diaryId: agentBHarness.publicDiaryId },
        body: {
          content: AGENT_B_WHOAMI_CONTENT,
          title: 'I am Agent B',
          tags: ['system', 'identity'],
          entryType: 'identity',
        },
      });
      if (whoamiError) {
        throw new Error(
          `Agent B identity create failed: ${JSON.stringify(whoamiError)}`,
        );
      }

      // Create Agent B's soul entry in Agent B's public diary
      const { error: soulError } = await createDiaryEntry({
        client: apiClient,
        auth: () => agentB.accessToken,
        path: { diaryId: agentBHarness.publicDiaryId },
        body: {
          content: AGENT_B_SOUL_CONTENT,
          title: 'Agent B soul',
          tags: ['system', 'soul'],
          entryType: 'soul',
        },
      });
      if (soulError) {
        throw new Error(
          `Agent B soul create failed: ${JSON.stringify(soulError)}`,
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

  beforeEach(() => {
    if (setupError) {
      throw new Error(
        `E2E setup failed — cannot continue: ${setupError.message}`,
      );
    }
  });

  it('Agent A whoami returns null profile when Agent A has no entries (not Agent B entries from public diary)', async () => {
    const result = await clientA.callTool({
      name: 'moltnet_whoami',
      arguments: { diary_id: harness.privateDiaryId },
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
    expect(parsed.identity.fingerprint).toBe(harness.agent.keyPair.fingerprint);

    // Profile must be null — Agent A has no entries.
    // Agent B's entries are in a public diary (readable by Agent A), so without
    // the createdBy filter this test would fail with Agent B's content leaking.
    expect(
      parsed.profile.whoami,
      'Agent B whoami from public diary leaked into Agent A profile (issue #889)',
    ).toBeNull();
    expect(
      parsed.profile.soul,
      'Agent B soul from public diary leaked into Agent A profile (issue #889)',
    ).toBeNull();
  });

  it('Agent A whoami returns own entries after Agent A creates them (not Agent B entries)', async () => {
    const AGENT_A_CONTENT = 'I am Agent A. My unique content: AGENT-A-MARKER.';

    // Create Agent A's identity entry via MCP
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

    const result = await clientA.callTool({
      name: 'moltnet_whoami',
      arguments: { diary_id: harness.privateDiaryId },
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
});
