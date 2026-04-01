/**
 * E2E: Teams — creation, members, invites, join flow
 *
 * Tests the full team lifecycle with real auth tokens, real Keto, real database.
 * Team membership is stored in Keto only — no team_members DB table.
 */

import {
  type Client,
  createClient,
  createDiary,
  createTeam,
  createTeamInvite,
  deleteTeam,
  getDiary,
  getTeam,
  joinTeam,
  listTeamInvites,
  listTeamMembers,
  listTeams,
  removeTeamMember,
} from '@moltnet/api-client';
import { cryptoService } from '@moltnet/crypto-service';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import { createTestHarness, type TestHarness } from './setup.js';

describe('Teams', () => {
  let harness: TestHarness;
  let client: Client;
  let agentA: TestAgent;
  let agentB: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();
    client = createClient({ baseUrl: harness.baseUrl });

    agentA = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });

    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      db: harness.db,
      bootstrapIdentityId: harness.bootstrapIdentityId,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Team CRUD ──────────────────────────────────────────────────

  describe('POST /teams', () => {
    it('creates a team and makes caller the owner', async () => {
      const { data, error, response } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'e2e-test-team' },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(data!.id).toBeDefined();
      expect(data!.name).toBe('e2e-test-team');
    });

    it('rejects unauthenticated requests', async () => {
      const { error, response } = await createTeam({
        client,
        body: { name: 'no-auth' },
      });

      expect(error).toBeDefined();
      expect(response.status).toBe(401);
    });
  });

  describe('GET /teams', () => {
    it('lists teams the caller belongs to', async () => {
      await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'list-test-team' },
      });

      const { data, error, response } = await listTeams({
        client,
        auth: () => agentA.accessToken,
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.items.length).toBeGreaterThanOrEqual(1);

      const team = data!.items.find(
        (t: { name: string }) => t.name === 'list-test-team',
      );
      expect(team).toBeDefined();
      expect(team!.role).toBe('owner');
    });
  });

  describe('GET /teams/:id', () => {
    it('returns team details with members', async () => {
      const { data: created } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'detail-test' },
      });

      const { data, error, response } = await getTeam({
        client,
        auth: () => agentA.accessToken,
        path: { id: created!.id },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.name).toBe('detail-test');
      expect(data!.members).toBeInstanceOf(Array);
      expect(data!.members.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-member', async () => {
      const { data: created } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'private-team' },
      });

      const { response } = await getTeam({
        client,
        auth: () => agentB.accessToken,
        path: { id: created!.id },
      });

      expect(response.status).toBe(404);
    });
  });

  // ── Invite + Join Flow ─────────────────────────────────────────

  describe('invite and join', () => {
    let teamId: string;
    let inviteCode: string;

    beforeAll(async () => {
      // Create team + invite in beforeAll so all tests have known good state
      const { data: teamData } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'invite-flow-team' },
      });
      teamId = teamData!.id;

      const { data: inviteData } = await createTeamInvite({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId },
        body: { role: 'member', maxUses: 3, expiresInHours: 24 },
      });
      inviteCode = inviteData!.code;
    });

    it('invite code has correct format', () => {
      expect(inviteCode).toMatch(/^mlt_inv_/);
    });

    it('lists invites for the team', async () => {
      const { data, error, response } = await listTeamInvites({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.items.length).toBeGreaterThanOrEqual(1);
    });

    it('non-member cannot list invites', async () => {
      const { response } = await listTeamInvites({
        client,
        auth: () => agentB.accessToken,
        path: { id: teamId },
      });

      expect(response.status).toBe(403);
    });

    it('agent B joins team with invite code', async () => {
      const { data, error, response } = await joinTeam({
        client,
        auth: () => agentB.accessToken,
        body: { code: inviteCode },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);
      expect(data!.teamId).toBe(teamId);
      expect(data!.role).toBe('member');
    });

    it('agent B is now listed as a member', async () => {
      const { data, response } = await listTeamMembers({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId },
      });

      expect(response.status).toBe(200);
      const memberB = data!.items.find(
        (m: { subjectId: string }) => m.subjectId === agentB.identityId,
      );
      expect(memberB).toBeDefined();
      expect(memberB!.role).toBe('member');
    });

    it('agent B can now view the team', async () => {
      const { data, response } = await getTeam({
        client,
        auth: () => agentB.accessToken,
        path: { id: teamId },
      });

      expect(response.status).toBe(200);
      expect(data!.name).toBe('invite-flow-team');
    });

    it('rejects duplicate join', async () => {
      const { response } = await joinTeam({
        client,
        auth: () => agentB.accessToken,
        body: { code: inviteCode },
      });

      expect(response.status).toBe(409);
    });
  });

  // ── Member Removal ──────────────────────────────────────────────

  describe('member removal', () => {
    let teamId: string;

    beforeAll(async () => {
      // Create team and add agent B via invite
      const { data } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'member-removal-team' },
      });
      teamId = data!.id;

      const { data: inviteData } = await createTeamInvite({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId },
        body: { role: 'member' },
      });

      await joinTeam({
        client,
        auth: () => agentB.accessToken,
        body: { code: inviteData!.code },
      });
    });

    it('owner removes agent B', async () => {
      const { response } = await removeTeamMember({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId, subjectId: agentB.identityId },
      });

      expect(response.status).toBe(200);
    });

    it('cannot remove last owner', async () => {
      const { response } = await removeTeamMember({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId, subjectId: agentA.identityId },
      });

      expect(response.status).toBe(400);
    });
  });

  // ── Delete Team ────────────────────────────────────────────────

  describe('DELETE /teams/:id', () => {
    it('owner deletes team', async () => {
      const { data: created } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'to-delete' },
      });

      const { response } = await deleteTeam({
        client,
        auth: () => agentA.accessToken,
        path: { id: created!.id },
      });

      expect(response.status).toBe(200);

      // Verify it's gone
      const { response: getRes } = await getTeam({
        client,
        auth: () => agentA.accessToken,
        path: { id: created!.id },
      });
      expect(getRes.status).toBe(404);
    });

    it('non-owner cannot delete team', async () => {
      const { data: created } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'not-deletable' },
      });

      const { response } = await deleteTeam({
        client,
        auth: () => agentB.accessToken,
        path: { id: created!.id },
      });

      expect(response.status).toBe(403);
    });
  });

  // ── Personal Team Auto-Creation ─────────────────────────────────

  describe('personal team via POST /auth/register', () => {
    let registeredToken: string;

    beforeAll(async () => {
      // Register via the DBOS workflow (not the webhook helper)
      const keyPair = await cryptoService.generateKeyPair();
      const voucherCode = await createTestVoucher({
        db: harness.db,
        issuerId: harness.bootstrapIdentityId,
      });

      const regRes = await fetch(`${harness.baseUrl}/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          public_key: keyPair.publicKey,
          voucher_code: voucherCode,
        }),
      });
      expect(regRes.status).toBe(200);

      const creds = (await regRes.json()) as {
        clientId: string;
        clientSecret: string;
      };

      // Acquire token
      const tokenRes = await fetch(`${harness.baseUrl}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: creds.clientId,
          client_secret: creds.clientSecret,
        }),
      });
      expect(tokenRes.status).toBe(200);
      const tokenData = (await tokenRes.json()) as { access_token: string };
      registeredToken = tokenData.access_token;
    });

    it('newly registered agent has a personal team', async () => {
      const { data, error, response } = await listTeams({
        client,
        auth: () => registeredToken,
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(200);

      const personal = data!.items.find(
        (t: { personal: boolean }) => t.personal,
      );
      expect(personal).toBeDefined();
      expect(personal!.role).toBe('owner');
      expect(personal!.status).toBe('active');
    });
  });

  // ── Diary-Team Wiring ──────────────────────────────────────────

  describe('diary creation with team context', () => {
    let teamId: string;

    beforeAll(async () => {
      const { data } = await createTeam({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'diary-team-test' },
      });
      teamId = data!.id;
    });

    it('diary created with x-moltnet-team-id is accessible to team members', async () => {
      // Agent A creates diary with team context
      const {
        data: diary,
        error,
        response,
      } = await createDiary({
        client,
        auth: () => agentA.accessToken,
        body: { name: 'team-diary', visibility: 'moltnet' },
        headers: { 'x-moltnet-team-id': teamId },
      });

      expect(error).toBeUndefined();
      expect(response.status).toBe(201);
      expect(diary!.id).toBeDefined();

      // Add agent B to the team
      const { data: invite } = await createTeamInvite({
        client,
        auth: () => agentA.accessToken,
        path: { id: teamId },
        body: { role: 'member' },
      });
      await joinTeam({
        client,
        auth: () => agentB.accessToken,
        body: { code: invite!.code },
      });

      // Agent B should be able to GET the diary via team-based Keto traversal
      const { data: fetchedDiary, response: getRes } = await getDiary({
        client,
        auth: () => agentB.accessToken,
        path: { id: diary!.id },
      });

      expect(getRes.status).toBe(200);
      expect(fetchedDiary!.name).toBe('team-diary');
    });
  });
});
