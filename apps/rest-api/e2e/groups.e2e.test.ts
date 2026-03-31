/**
 * E2E: Groups — creation, members, permissions, edge cases
 *
 * Tests the full group lifecycle with real auth tokens, real Keto, real database.
 * Groups are stored in DB; membership is stored in Keto.
 *
 * Agent roles:
 *   agentA — team owner (has manage_members permission)
 *   agentB — team member (has access but NOT manage_members)
 *   agentC — non-member (no team access at all)
 */

import {
  addGroupMember,
  type Client,
  createClient,
  createGroup,
  createTeam,
  createTeamInvite,
  deleteGroup,
  getGroup,
  joinTeam,
  listGroupMembers,
  listGroups,
  listTeams,
  removeGroupMember,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Groups E2E', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent; // team owner
  let agentB: TestAgent; // team member (non-manager)
  let agentC: TestAgent; // non-member

  // Shared project team created in beforeAll
  let projectTeamId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    // Create three agents
    [agentA, agentB, agentC] = await Promise.all([
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
      createAgent({
        baseUrl: harness.baseUrl,
        db: harness.db,
        bootstrapIdentityId: harness.bootstrapIdentityId,
      }),
    ]);

    // agentA creates a project team
    const { data: teamData } = await createTeam({
      client,
      auth: () => agentA.accessToken,
      body: { name: 'groups-e2e-team' },
    });
    projectTeamId = teamData!.id;

    // agentB joins the team as member via invite
    const { data: inviteData } = await createTeamInvite({
      client,
      auth: () => agentA.accessToken,
      path: { id: projectTeamId },
      body: { role: 'member', maxUses: 1, expiresInHours: 24 },
    });
    await joinTeam({
      client,
      auth: () => agentB.accessToken,
      body: { code: inviteData!.code },
    });

    // agentC is NOT added — stays outside the team
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Happy Paths ────────────────────────────────────────────────

  describe('Happy paths', () => {
    let groupId: string;

    describe('POST /teams/:id/groups', () => {
      it('creates a group in a project team and returns id + name', async () => {
        const { data, error, response } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
          body: { name: 'engineering' },
        });

        expect(error).toBeUndefined();
        expect(response.status).toBe(201);
        expect(data!.id).toBeDefined();
        expect(data!.name).toBe('engineering');
        expect(data!.teamId).toBe(projectTeamId);

        groupId = data!.id;
      });
    });

    describe('GET /teams/:id/groups', () => {
      it('lists groups in a team and shows the created group', async () => {
        const { data, error, response } = await listGroups({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
        });

        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.items.length).toBeGreaterThanOrEqual(1);

        const found = data!.items.find((g) => g.id === groupId);
        expect(found).toBeDefined();
        expect(found!.name).toBe('engineering');
        expect(found!.teamId).toBe(projectTeamId);
      });
    });

    describe('GET /groups/:groupId', () => {
      it('returns group detail including members array', async () => {
        const { data, error, response } = await getGroup({
          client,
          auth: () => agentA.accessToken,
          path: { groupId },
        });

        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.id).toBe(groupId);
        expect(data!.name).toBe('engineering');
        expect(data!.teamId).toBe(projectTeamId);
        expect(data!.createdBy).toBe(agentA.identityId);
        expect(data!.createdAt).toBeDefined();
        expect(data!.members).toBeInstanceOf(Array);
      });
    });

    describe('POST /groups/:groupId/members', () => {
      it('adds a team member to the group and returns 201', async () => {
        const { data, error, response } = await addGroupMember({
          client,
          auth: () => agentA.accessToken,
          path: { groupId },
          body: { subjectId: agentB.identityId },
        });

        expect(error).toBeUndefined();
        expect(response.status).toBe(201);
        expect(data!.subjectId).toBe(agentB.identityId);
        expect(data!.subjectNs).toBeDefined();
      });
    });

    describe('GET /groups/:groupId/members', () => {
      it('lists group members and shows added member', async () => {
        const { data, error, response } = await listGroupMembers({
          client,
          auth: () => agentA.accessToken,
          path: { groupId },
        });

        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.items).toBeInstanceOf(Array);

        const memberB = data!.items.find(
          (m: { subjectId: string }) => m.subjectId === agentB.identityId,
        );
        expect(memberB).toBeDefined();
      });
    });

    describe('DELETE /groups/:groupId/members/:subjectId', () => {
      it('removes member from group — member is gone after removal', async () => {
        const { response: removeRes } = await removeGroupMember({
          client,
          auth: () => agentA.accessToken,
          path: { groupId, subjectId: agentB.identityId },
        });
        expect(removeRes.status).toBe(200);

        // Verify member is gone
        const { data: afterData } = await listGroupMembers({
          client,
          auth: () => agentA.accessToken,
          path: { groupId },
        });
        const stillPresent = afterData!.items.find(
          (m: { subjectId: string }) => m.subjectId === agentB.identityId,
        );
        expect(stillPresent).toBeUndefined();
      });
    });

    describe('DELETE /groups/:groupId', () => {
      it('deletes group and returns 200 — group gone on re-fetch', async () => {
        // Create a fresh group to delete
        const { data: created } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
          body: { name: 'to-delete' },
        });
        const toDeleteId = created!.id;

        const { data, error, response } = await deleteGroup({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: toDeleteId },
        });

        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.deleted).toBe(true);

        // Group should be gone
        const { response: getRes } = await getGroup({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: toDeleteId },
        });
        expect(getRes.status).toBe(404);
      });
    });
  });

  // ── Permission Checks ──────────────────────────────────────────

  describe('Permission checks (Keto enforcement)', () => {
    // Use a shared group for permission tests to avoid repeated creation
    let permGroupId: string;

    beforeAll(async () => {
      const { data } = await createGroup({
        client,
        auth: () => agentA.accessToken,
        path: { id: projectTeamId },
        body: { name: 'perm-test-group' },
      });
      permGroupId = data!.id;

      // Add agentB as group member so we can test removal permissions
      await addGroupMember({
        client,
        auth: () => agentA.accessToken,
        path: { groupId: permGroupId },
        body: { subjectId: agentB.identityId },
      });
    });

    describe('non-team-member (agentC)', () => {
      it('cannot create group — 403', async () => {
        const { response } = await createGroup({
          client,
          auth: () => agentC.accessToken,
          path: { id: projectTeamId },
          body: { name: 'forbidden-group' },
        });
        expect(response.status).toBe(403);
      });

      it('cannot list groups — 404 (access denied surfaced as not-found)', async () => {
        const { response } = await listGroups({
          client,
          auth: () => agentC.accessToken,
          path: { id: projectTeamId },
        });
        expect(response.status).toBe(404);
      });

      it('cannot get group detail — 404', async () => {
        const { response } = await getGroup({
          client,
          auth: () => agentC.accessToken,
          path: { groupId: permGroupId },
        });
        expect(response.status).toBe(404);
      });

      it('cannot delete group — 403', async () => {
        const { response } = await deleteGroup({
          client,
          auth: () => agentC.accessToken,
          path: { groupId: permGroupId },
        });
        // Route checks group existence first; group exists but agentC can't manage
        expect([403, 404]).toContain(response.status);
      });

      it('cannot add member to group — 403', async () => {
        const { response } = await addGroupMember({
          client,
          auth: () => agentC.accessToken,
          path: { groupId: permGroupId },
          body: { subjectId: agentB.identityId },
        });
        expect([403, 404]).toContain(response.status);
      });

      it('cannot list group members — 404', async () => {
        const { response } = await listGroupMembers({
          client,
          auth: () => agentC.accessToken,
          path: { groupId: permGroupId },
        });
        expect(response.status).toBe(404);
      });

      it('cannot remove member from group — 403', async () => {
        const { response } = await removeGroupMember({
          client,
          auth: () => agentC.accessToken,
          path: { groupId: permGroupId, subjectId: agentB.identityId },
        });
        expect([403, 404]).toContain(response.status);
      });
    });

    describe('team member without manage_members (agentB)', () => {
      it('cannot create group — 403', async () => {
        const { response } = await createGroup({
          client,
          auth: () => agentB.accessToken,
          path: { id: projectTeamId },
          body: { name: 'member-cannot-create' },
        });
        expect(response.status).toBe(403);
      });

      it('cannot delete group — 403', async () => {
        const { response } = await deleteGroup({
          client,
          auth: () => agentB.accessToken,
          path: { groupId: permGroupId },
        });
        expect(response.status).toBe(403);
      });

      it('cannot add member to group — 403', async () => {
        const { response } = await addGroupMember({
          client,
          auth: () => agentB.accessToken,
          path: { groupId: permGroupId },
          body: { subjectId: agentA.identityId },
        });
        expect(response.status).toBe(403);
      });

      it('cannot remove member from group — 403', async () => {
        const { response } = await removeGroupMember({
          client,
          auth: () => agentB.accessToken,
          path: { groupId: permGroupId, subjectId: agentB.identityId },
        });
        expect(response.status).toBe(403);
      });

      it('CAN list groups — 200 (only needs team access)', async () => {
        const { data, error, response } = await listGroups({
          client,
          auth: () => agentB.accessToken,
          path: { id: projectTeamId },
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.items).toBeInstanceOf(Array);
      });

      it('CAN view group detail — 200 (only needs team access)', async () => {
        const { data, error, response } = await getGroup({
          client,
          auth: () => agentB.accessToken,
          path: { groupId: permGroupId },
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.id).toBe(permGroupId);
      });

      it('CAN list group members — 200 (only needs team access)', async () => {
        const { data, error, response } = await listGroupMembers({
          client,
          auth: () => agentB.accessToken,
          path: { groupId: permGroupId },
        });
        expect(error).toBeUndefined();
        expect(response.status).toBe(200);
        expect(data!.items).toBeInstanceOf(Array);
      });
    });

    describe('unauthenticated requests', () => {
      it('create group rejects without auth — 401', async () => {
        const { response } = await createGroup({
          client,
          path: { id: projectTeamId },
          body: { name: 'no-auth' },
        });
        expect(response.status).toBe(401);
      });

      it('list groups rejects without auth — 401', async () => {
        const { response } = await listGroups({
          client,
          path: { id: projectTeamId },
        });
        expect(response.status).toBe(401);
      });

      it('get group rejects without auth — 401', async () => {
        const { response } = await getGroup({
          client,
          path: { groupId: permGroupId },
        });
        expect(response.status).toBe(401);
      });

      it('delete group rejects without auth — 401', async () => {
        const { response } = await deleteGroup({
          client,
          path: { groupId: permGroupId },
        });
        expect(response.status).toBe(401);
      });

      it('add member rejects without auth — 401', async () => {
        const { response } = await addGroupMember({
          client,
          path: { groupId: permGroupId },
          body: { subjectId: agentB.identityId },
        });
        expect(response.status).toBe(401);
      });

      it('list members rejects without auth — 401', async () => {
        const { response } = await listGroupMembers({
          client,
          path: { groupId: permGroupId },
        });
        expect(response.status).toBe(401);
      });

      it('remove member rejects without auth — 401', async () => {
        const { response } = await removeGroupMember({
          client,
          path: { groupId: permGroupId, subjectId: agentB.identityId },
        });
        expect(response.status).toBe(401);
      });
    });
  });

  // ── Edge Cases ─────────────────────────────────────────────────

  describe('Edge cases', () => {
    describe('cannot create group on personal team', () => {
      it('returns 400 with team-personal-immutable error', async () => {
        // Find agentA's personal team
        const { data: teamsData } = await listTeams({
          client,
          auth: () => agentA.accessToken,
        });
        const personalTeam = teamsData!.items.find(
          (t: { personal: boolean }) => t.personal,
        );
        expect(personalTeam).toBeDefined();

        const { response } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: personalTeam!.id },
          body: { name: 'not-allowed' },
        });
        expect(response.status).toBe(400);
      });
    });

    describe('cannot add non-team-member to a group', () => {
      it('returns 404 because agentC is not in the team', async () => {
        const { data: group } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
          body: { name: 'non-member-add-test' },
        });

        const { response } = await addGroupMember({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: group!.id },
          body: { subjectId: agentC.identityId },
        });
        expect(response.status).toBe(404);

        // Cleanup
        await deleteGroup({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: group!.id },
        });
      });
    });

    describe('group name uniqueness within team', () => {
      it('rejects duplicate name in the same team', async () => {
        const uniqueName = `unique-${Date.now()}`;

        const { data: first } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
          body: { name: uniqueName },
        });
        expect(first!.id).toBeDefined();

        // Second creation with the same name should fail
        const { response } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
          body: { name: uniqueName },
        });
        expect([409, 500]).toContain(response.status);

        // Cleanup
        await deleteGroup({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: first!.id },
        });
      });
    });

    describe('deleted group cleanup', () => {
      it('members list returns 404 after group is deleted', async () => {
        const { data: group } = await createGroup({
          client,
          auth: () => agentA.accessToken,
          path: { id: projectTeamId },
          body: { name: 'cleanup-test-group' },
        });
        const gId = group!.id;

        // Add agentB to the group
        await addGroupMember({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: gId },
          body: { subjectId: agentB.identityId },
        });

        // Delete the group
        await deleteGroup({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: gId },
        });

        // Members list should 404 — group is gone
        const { response } = await listGroupMembers({
          client,
          auth: () => agentA.accessToken,
          path: { groupId: gId },
        });
        expect(response.status).toBe(404);
      });
    });
  });
});
