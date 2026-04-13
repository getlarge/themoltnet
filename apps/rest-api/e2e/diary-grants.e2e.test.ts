/**
 * E2E: Diary Grants — per-diary writer/manager access control
 *
 * Tests the full grant lifecycle: create, list, revoke, with permission
 * cascade through Keto. Grants are pure Keto tuples — no DB table.
 *
 * Agent roles:
 *   agentA — team owner (diary creator, has diary.manage via team)
 *   agentB — team member (has diary.read/write via team membership)
 *   agentC — non-member (no access unless granted directly)
 */

import {
  addGroupMember,
  type Client,
  createClient,
  createDiary,
  createDiaryEntry,
  createDiaryGrant,
  createGroup,
  createTeam,
  createTeamInvite,
  getDiary,
  joinTeam,
  listDiaryGrants,
  removeGroupMember,
  revokeDiaryGrant,
} from '@moltnet/api-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Diary Grants E2E', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent; // team owner
  let agentB: TestAgent; // team member
  let agentC: TestAgent; // non-member

  let projectTeamId: string;
  let teamDiaryId: string;
  let groupId: string;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    // Create three agents in parallel
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
      body: { name: 'grants-e2e-team' },
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

    // agentA creates a diary scoped to the project team
    const { data: diaryData } = await createDiary({
      client,
      auth: () => agentA.accessToken,
      headers: { 'x-moltnet-team-id': projectTeamId },
      body: { name: 'grants-test-diary', visibility: 'moltnet' },
    });
    teamDiaryId = diaryData!.id;

    // agentA creates a group within the team
    const { data: groupData } = await createGroup({
      client,
      auth: () => agentA.accessToken,
      path: { id: projectTeamId },
      body: { name: 'grants-test-group' },
    });
    groupId = groupData!.id;

    // Add agentB to the group
    await addGroupMember({
      client,
      auth: () => agentA.accessToken,
      path: { groupId },
      body: { subjectId: agentB.identityId },
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Grant Creation ─────────────────────────────────────────────

  describe('POST /diaries/:id/grants', () => {
    it('grants writer to non-member agent → agent can write entries', async () => {
      // Grant agentC writer access
      const { data, error, response } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(data!.subjectId).toBe(agentC.identityId);
      expect(data!.role).toBe('writer');

      // agentC should now be able to create entries
      const { data: entryData, error: entryError } = await createDiaryEntry({
        client,
        auth: () => agentC.accessToken,
        path: { diaryId: teamDiaryId },
        body: { content: 'Entry by granted writer' },
      });

      expect(entryError).toBeUndefined();
      expect(entryData!.content).toBe('Entry by granted writer');
    });

    it('grants manager to agent → agent can manage diary', async () => {
      // Grant agentB manager access (in addition to team membership)
      const {
        data: grantData,
        error,
        response,
      } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentB.identityId,
          subjectNs: 'Agent',
          role: 'manager',
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(grantData!.role).toBe('manager');
    });

    it('grants writer to group → group members can write', async () => {
      // Create a separate diary to test group grants in isolation
      const { data: diary2 } = await createDiary({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': projectTeamId },
        body: { name: 'group-grant-test-diary', visibility: 'moltnet' },
      });
      const diary2Id = diary2!.id;

      // Grant writer to the group
      const { error, response } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: diary2Id },
        body: {
          subjectId: groupId,
          subjectNs: 'Group',
          role: 'writer',
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);

      // agentB (group member) should be able to write to this diary
      const { data: entryData, error: entryError } = await createDiaryEntry({
        client,
        auth: () => agentB.accessToken,
        path: { diaryId: diary2Id },
        body: { content: 'Entry via group grant' },
      });

      expect(entryError).toBeUndefined();
      expect(entryData!.content).toBe('Entry via group grant');
    });

    it('duplicate grant is idempotent (201)', async () => {
      const { response: res1 } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });
      expect(res1.status).toBe(201);

      // Same grant again
      const { response: res2 } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });
      expect(res2.status).toBe(201);
    });

    it('conflicting grant returns 409', async () => {
      // agentC already has writer grant from the first test
      const { error, response } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'manager',
        },
      });

      expect(response.status).toBe(409);
      expect(error).toBeDefined();
    });

    it('non-manager gets 403', async () => {
      const { error, response } = await createDiaryGrant({
        client,
        auth: () => agentC.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      // agentC has writer grant but not manager — should be forbidden
      // Note: after earlier test, agentC has writer but NOT manager
      expect(error).toBeDefined();
      expect(response.status).toBe(403);
    });

    it('grant to non-existent diary returns 403', async () => {
      const fakeDiaryId = '00000000-0000-0000-0000-000000000000';
      const { error, response } = await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: fakeDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      // Keto returns false for canManageDiary on non-existent diary
      expect(error).toBeDefined();
      expect(response.status).toBe(403);
    });
  });

  // ── Grant Listing ──────────────────────────────────────────────

  describe('GET /diaries/:id/grants', () => {
    it('lists both writers and managers', async () => {
      const { data, error, response } = await listDiaryGrants({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.grants.length).toBeGreaterThanOrEqual(2);

      // Should contain agentC as writer and agentB as manager
      const writerGrant = data!.grants.find(
        (g) => g.subjectId === agentC.identityId && g.role === 'writer',
      );
      const managerGrant = data!.grants.find(
        (g) => g.subjectId === agentB.identityId && g.role === 'manager',
      );

      expect(writerGrant).toBeDefined();
      expect(managerGrant).toBeDefined();
    });

    it('agent with read access can list grants', async () => {
      // agentB is a team member (has read access)
      const { error, response } = await listDiaryGrants({
        client,
        auth: () => agentB.accessToken,
        path: { id: teamDiaryId },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
    });

    it('agent with writer grant can list grants', async () => {
      // agentC has writer grant (which implies read)
      const { error, response } = await listDiaryGrants({
        client,
        auth: () => agentC.accessToken,
        path: { id: teamDiaryId },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
    });
  });

  // ── Grant Revocation ───────────────────────────────────────────

  describe('DELETE /diaries/:id/grants', () => {
    it('revokes writer → agent loses write access', async () => {
      // First, create a separate diary + grant for isolation
      const { data: diary3 } = await createDiary({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': projectTeamId },
        body: { name: 'revoke-test-diary', visibility: 'moltnet' },
      });
      const diary3Id = diary3!.id;

      // Grant writer to agentC
      await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: diary3Id },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      // Verify agentC can write
      const { error: writeError1 } = await createDiaryEntry({
        client,
        auth: () => agentC.accessToken,
        path: { diaryId: diary3Id },
        body: { content: 'Before revoke' },
      });
      expect(writeError1).toBeUndefined();

      // Revoke the grant
      const { data, error, response } = await revokeDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: diary3Id },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.revoked).toBe(true);

      // agentC should no longer be able to write
      const { error: writeError2, response: writeRes2 } =
        await createDiaryEntry({
          client,
          auth: () => agentC.accessToken,
          path: { diaryId: diary3Id },
          body: { content: 'After revoke' },
        });

      expect(writeError2).toBeDefined();
      expect(writeRes2.status).toBe(403);
    });

    it('team member retains team-based access after direct grant revoked', async () => {
      // agentB has manager grant on teamDiaryId — revoke it
      await revokeDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentB.identityId,
          subjectNs: 'Agent',
          role: 'manager',
        },
      });

      // agentB should still have read access via team membership
      const { error, response } = await getDiary({
        client,
        auth: () => agentB.accessToken,
        path: { id: teamDiaryId },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
    });

    it('non-manager gets 403 when revoking', async () => {
      const { error, response } = await revokeDiaryGrant({
        client,
        auth: () => agentC.accessToken,
        path: { id: teamDiaryId },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(403);
    });
  });

  // ── Cascading Behavior ─────────────────────────────────────────

  describe('Cascading grants', () => {
    it('granted manager can grant another agent', async () => {
      // Create a fresh diary for this test
      const { data: diary4 } = await createDiary({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': projectTeamId },
        body: { name: 'cascade-test-diary', visibility: 'moltnet' },
      });
      const diary4Id = diary4!.id;

      // Grant manager to agentB
      await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: diary4Id },
        body: {
          subjectId: agentB.identityId,
          subjectNs: 'Agent',
          role: 'manager',
        },
      });

      // agentB (now manager) grants writer to agentC
      const { error, response } = await createDiaryGrant({
        client,
        auth: () => agentB.accessToken,
        path: { id: diary4Id },
        body: {
          subjectId: agentC.identityId,
          subjectNs: 'Agent',
          role: 'writer',
        },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);

      // agentC should be able to write
      const { error: writeError } = await createDiaryEntry({
        client,
        auth: () => agentC.accessToken,
        path: { diaryId: diary4Id },
        body: { content: 'Entry via cascading grant' },
      });

      expect(writeError).toBeUndefined();
    });
  });

  describe('Group membership changes', () => {
    it('removing member from group does not break team-based access', async () => {
      // Create a fresh diary + group grant setup
      const { data: diary5 } = await createDiary({
        client,
        auth: () => agentA.accessToken,
        headers: { 'x-moltnet-team-id': projectTeamId },
        body: { name: 'group-revoke-test', visibility: 'moltnet' },
      });
      const diary5Id = diary5!.id;

      // Create a new group with agentC as member
      const { data: group2Data } = await createGroup({
        client,
        auth: () => agentA.accessToken,
        path: { id: projectTeamId },
        body: { name: 'ephemeral-group' },
      });
      const group2Id = group2Data!.id;

      // agentC needs to be a team member to be added to a group
      const { data: invite2 } = await createTeamInvite({
        client,
        auth: () => agentA.accessToken,
        path: { id: projectTeamId },
        body: { role: 'member', maxUses: 1, expiresInHours: 24 },
      });
      await joinTeam({
        client,
        auth: () => agentC.accessToken,
        body: { code: invite2!.code },
      });

      await addGroupMember({
        client,
        auth: () => agentA.accessToken,
        path: { groupId: group2Id },
        body: { subjectId: agentC.identityId },
      });

      // Grant writer to the group on diary5
      await createDiaryGrant({
        client,
        auth: () => agentA.accessToken,
        path: { id: diary5Id },
        body: {
          subjectId: group2Id,
          subjectNs: 'Group',
          role: 'writer',
        },
      });

      // agentC should be able to write (via group grant)
      const { error: writeOk } = await createDiaryEntry({
        client,
        auth: () => agentC.accessToken,
        path: { diaryId: diary5Id },
        body: { content: 'Via group before removal' },
      });
      expect(writeOk).toBeUndefined();

      // Remove agentC from the group
      await removeGroupMember({
        client,
        auth: () => agentA.accessToken,
        path: { groupId: group2Id, subjectId: agentC.identityId },
      });

      // agentC still has team membership (joined above), so they retain
      // team-based access. The group grant path is broken, but team access
      // keeps them able to read/write. This tests that the group grant
      // removal doesn't break team-based access.
      const { error: readStillOk } = await getDiary({
        client,
        auth: () => agentC.accessToken,
        path: { id: diary5Id },
      });
      expect(readStillOk).toBeUndefined();
    });
  });
});
