/**
 * E2E: Team Tools — full team lifecycle
 *
 * Tests teams_list, teams_create, teams_invite_create, teams_invite_list,
 * teams_join, team_members_list, teams_member_remove, teams_invite_delete,
 * teams_delete, and permission enforcement (non-manager cannot invite).
 *
 * Uses two MCP clients: agentA (owner) and agentB (joiner).
 * Tests are sequential — each depends on state created by the prior test.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createMcpTestHarness, type McpTestHarness } from './setup.js';

describe('Team Tools E2E', () => {
  let harness: McpTestHarness;
  let clientA: Client;
  let clientB: Client;
  let setupError: Error | undefined;

  // State accumulated across sequential tests
  let personalTeamId: string;
  let createdTeamId: string;
  let inviteCode: string;
  let createdInviteId: string;
  let agentBIdentityId: string;

  beforeAll(async () => {
    harness = await createMcpTestHarness();

    try {
      // --- AgentA (owner) ---
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
      clientA = new Client({ name: 'e2e-team-client-a', version: '1.0.0' });
      await clientA.connect(transportA);

      // --- AgentB (joiner) ---
      const agentBHarness = await harness.createAgent('e2e-team-agentB');
      agentBIdentityId = agentBHarness.agent.identityId;

      const transportB = new StreamableHTTPClientTransport(
        new URL(`${harness.mcpBaseUrl}/mcp`),
        {
          requestInit: {
            headers: {
              'X-Client-Id': agentBHarness.agent.clientId,
              'X-Client-Secret': agentBHarness.agent.clientSecret,
            },
          },
        },
      );
      clientB = new Client({ name: 'e2e-team-client-b', version: '1.0.0' });
      await clientB.connect(transportB);
    } catch (err) {
      setupError = err instanceof Error ? err : new Error(String(err));
    }
  });

  afterAll(async () => {
    await clientA?.close();
    await clientB?.close();
    await harness?.teardown();
  });

  function requireSetup(): void {
    if (setupError) {
      throw new Error(`MCP client setup failed: ${setupError.message}`);
    }
  }

  function parseResult(result: { content: unknown }): unknown {
    const content = result.content as Array<{ type: string; text: string }>;
    return JSON.parse(content[0].text);
  }

  // ── 1. teams_list returns the personal team ──

  it('teams_list returns the personal team', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_list',
      arguments: {},
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_list error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as { items: Array<{ id: string }> };
    expect(parsed.items).toBeDefined();
    expect(parsed.items.length).toBeGreaterThanOrEqual(1);

    // Capture the personal team ID
    const personal = parsed.items.find(
      (t: { id: string }) => t.id === harness.personalTeamId,
    );
    expect(personal, 'personal team should be in list').toBeDefined();
    personalTeamId = harness.personalTeamId;
  });

  // ── 2. teams_create creates a shared team ──

  it('teams_create creates a shared team', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_create',
      arguments: { name: 'e2e-mcp-team' },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_create error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as { success: boolean; id: string };
    expect(parsed.success).toBe(true);
    expect(parsed.id).toBeDefined();
    createdTeamId = parsed.id;
  });

  // ── 3. teams_invite_create creates an invite code ──

  it('teams_invite_create creates an invite code', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_invite_create',
      arguments: {
        team_id: createdTeamId,
        role: 'member',
      },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_invite_create error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as {
      success: boolean;
      id: string;
      code: string;
    };
    expect(parsed.success).toBe(true);
    expect(parsed.id).toBeDefined();
    expect(parsed.code).toBeDefined();
    createdInviteId = parsed.id;
    inviteCode = parsed.code;
  });

  // ── 4. teams_invite_list returns the created invite ──

  it('teams_invite_list returns the created invite', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_invite_list',
      arguments: { team_id: createdTeamId },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_invite_list error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as { items: Array<{ id: string }> };
    expect(parsed.items).toBeDefined();
    const found = parsed.items.find((inv) => inv.id === createdInviteId);
    expect(found, 'created invite should appear in list').toBeDefined();
  });

  // ── 5. teams_join lets agentB join via invite code ──

  it('teams_join lets agentB join via invite code', async () => {
    requireSetup();
    const result = await clientB.callTool({
      name: 'teams_join',
      arguments: { code: inviteCode },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_join error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  // ── 6. team_members_list shows both agents ──

  it('team_members_list shows both agents', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'team_members_list',
      arguments: { team_id: createdTeamId },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `team_members_list error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as {
      teamId: string;
      members: Array<{ subjectId: string; role: string }>;
    };
    expect(parsed.members).toBeDefined();
    expect(parsed.members.length).toBeGreaterThanOrEqual(2);
    const memberB = parsed.members.find(
      (m) => m.subjectId === agentBIdentityId,
    );
    expect(
      memberB,
      'agentB should appear in members after joining',
    ).toBeDefined();
    expect(memberB!.role).toBe('members');
  });

  // ── 7. teams_member_remove removes agentB ──

  it('teams_member_remove removes agentB', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_member_remove',
      arguments: {
        team_id: createdTeamId,
        subject_id: agentBIdentityId,
      },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_member_remove error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  // ── 8. teams_invite_delete removes an invite ──
  // The original invite was consumed by agentB's join, so create a fresh one first.

  it('teams_invite_delete removes the invite', async () => {
    requireSetup();

    // Create a fresh invite since the previous one may have been consumed
    const createResult = await clientA.callTool({
      name: 'teams_invite_create',
      arguments: { team_id: createdTeamId, role: 'member' },
    });
    expect(
      createResult.isError,
      `fresh invite create error: ${(createResult.content as Array<{ type: string; text: string }>)[0].text}`,
    ).toBeUndefined();

    const freshInvite = parseResult(createResult) as {
      success: boolean;
      id: string;
    };
    const freshInviteId = freshInvite.id;

    // Now delete it
    const deleteResult = await clientA.callTool({
      name: 'teams_invite_delete',
      arguments: { team_id: createdTeamId, invite_id: freshInviteId },
    });

    const content = deleteResult.content as Array<{
      type: string;
      text: string;
    }>;
    expect(
      deleteResult.isError,
      `teams_invite_delete error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(deleteResult) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  // ── 9. teams_delete removes the team ──

  it('teams_delete removes the team', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_delete',
      arguments: { team_id: createdTeamId },
    });

    const content = result.content as Array<{ type: string; text: string }>;
    expect(
      result.isError,
      `teams_delete error: ${content[0].text}`,
    ).toBeUndefined();

    const parsed = parseResult(result) as { success: boolean };
    expect(parsed.success).toBe(true);
  });

  // ── 10. non-manager cannot create invites ──

  it('non-manager cannot create invites', async () => {
    requireSetup();

    // AgentA creates a fresh team
    const createTeamResult = await clientA.callTool({
      name: 'teams_create',
      arguments: { name: 'e2e-mcp-perm-team' },
    });
    expect(createTeamResult.isError).toBeUndefined();
    const teamData = parseResult(createTeamResult) as {
      success: boolean;
      id: string;
    };
    const permTeamId = teamData.id;

    // AgentB (not a member of this team) tries to create an invite
    const result = await clientB.callTool({
      name: 'teams_invite_create',
      arguments: { team_id: permTeamId, role: 'member' },
    });

    expect(result.isError).toBe(true);

    // Cleanup: delete the team so it doesn't pollute other tests
    await clientA.callTool({
      name: 'teams_delete',
      arguments: { team_id: permTeamId },
    });
  });

  // Sanity: verify personal team still appears after all mutations
  it('personal team is unaffected by shared team operations', async () => {
    requireSetup();
    const result = await clientA.callTool({
      name: 'teams_list',
      arguments: {},
    });

    expect(result.isError).toBeUndefined();
    const parsed = parseResult(result) as { items: Array<{ id: string }> };
    const found = parsed.items.find((t) => t.id === personalTeamId);
    expect(found, 'personal team should still exist').toBeDefined();
  });
});
