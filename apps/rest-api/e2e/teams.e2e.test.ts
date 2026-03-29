/**
 * E2E: Teams — creation, members, invites, join flow
 *
 * Tests the full team lifecycle with real auth tokens, real Keto, real database.
 * Team membership is stored in Keto only — no team_members DB table.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createAgent, createTestVoucher, type TestAgent } from './helpers.js';
import {
  createTestHarness,
  SERVER_BASE_URL,
  type TestHarness,
} from './setup.js';

async function apiCall(
  method: string,
  path: string,
  token: string,
  body?: unknown,
) {
  const res = await fetch(`${SERVER_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json')
    ? await res.json()
    : null;
  return { status: res.status, data };
}

describe('Teams', () => {
  let harness: TestHarness;
  let agentA: TestAgent;
  let agentB: TestAgent;

  beforeAll(async () => {
    harness = await createTestHarness();

    // Create two agents for team collaboration tests
    const voucherA = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentA = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherA,
    });

    const voucherB = await createTestVoucher({
      db: harness.db,
      issuerId: harness.bootstrapIdentityId,
    });
    agentB = await createAgent({
      baseUrl: harness.baseUrl,
      identityApi: harness.identityApi,
      hydraAdminOAuth2: harness.hydraAdminOAuth2,
      webhookApiKey: harness.webhookApiKey,
      voucherCode: voucherB,
    });
  });

  afterAll(async () => {
    await harness?.teardown();
  });

  // ── Team CRUD ──────────────────────────────────────────────────

  describe('POST /teams', () => {
    it('creates a team and makes caller the owner', async () => {
      const { status, data } = await apiCall(
        'POST',
        '/teams',
        agentA.accessToken,
        { name: 'e2e-test-team' },
      );

      expect(status).toBe(201);
      expect(data.id).toBeDefined();
      expect(data.name).toBe('e2e-test-team');
    });

    it('rejects unauthenticated requests', async () => {
      const res = await fetch(`${SERVER_BASE_URL}/teams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'no-auth' }),
      });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /teams', () => {
    it('lists teams the caller belongs to', async () => {
      // Create a team first
      await apiCall('POST', '/teams', agentA.accessToken, {
        name: 'list-test-team',
      });

      const { status, data } = await apiCall(
        'GET',
        '/teams',
        agentA.accessToken,
      );

      expect(status).toBe(200);
      expect(data.items.length).toBeGreaterThanOrEqual(1);
      const team = data.items.find(
        (t: { name: string }) => t.name === 'list-test-team',
      );
      expect(team).toBeDefined();
      expect(team.role).toBe('owner');
    });
  });

  describe('GET /teams/:id', () => {
    it('returns team details with members', async () => {
      const { data: created } = await apiCall(
        'POST',
        '/teams',
        agentA.accessToken,
        { name: 'detail-test' },
      );

      const { status, data } = await apiCall(
        'GET',
        `/teams/${created.id}`,
        agentA.accessToken,
      );

      expect(status).toBe(200);
      expect(data.name).toBe('detail-test');
      expect(data.members).toBeInstanceOf(Array);
      expect(data.members.length).toBeGreaterThanOrEqual(1);
    });

    it('returns 404 for non-member', async () => {
      const { data: created } = await apiCall(
        'POST',
        '/teams',
        agentA.accessToken,
        { name: 'private-team' },
      );

      const { status } = await apiCall(
        'GET',
        `/teams/${created.id}`,
        agentB.accessToken,
      );

      expect(status).toBe(404);
    });
  });

  // ── Invite + Join Flow ─────────────────────────────────────────

  describe('invite and join', () => {
    let teamId: string;
    let inviteCode: string;

    beforeAll(async () => {
      const { data } = await apiCall('POST', '/teams', agentA.accessToken, {
        name: 'invite-flow-team',
      });
      teamId = data.id;
    });

    it('creates an invite code', async () => {
      const { status, data } = await apiCall(
        'POST',
        `/teams/${teamId}/invites`,
        agentA.accessToken,
        { role: 'member', maxUses: 3, expiresInHours: 24 },
      );

      expect(status).toBe(201);
      expect(data.code).toMatch(/^mlt_inv_/);
      expect(data.expiresAt).toBeDefined();
      inviteCode = data.code;
    });

    it('lists invites for the team', async () => {
      const { status, data } = await apiCall(
        'GET',
        `/teams/${teamId}/invites`,
        agentA.accessToken,
      );

      expect(status).toBe(200);
      expect(data.items.length).toBeGreaterThanOrEqual(1);
    });

    it('non-member cannot list invites', async () => {
      const { status } = await apiCall(
        'GET',
        `/teams/${teamId}/invites`,
        agentB.accessToken,
      );

      expect(status).toBe(403);
    });

    it('agent B joins team with invite code', async () => {
      const { status, data } = await apiCall(
        'POST',
        '/teams/join',
        agentB.accessToken,
        { code: inviteCode },
      );

      expect(status).toBe(200);
      expect(data.teamId).toBe(teamId);
      expect(data.role).toBe('member');
    });

    it('agent B is now listed as a member', async () => {
      const { status, data } = await apiCall(
        'GET',
        `/teams/${teamId}/members`,
        agentA.accessToken,
      );

      expect(status).toBe(200);
      const memberB = data.items.find(
        (m: { subjectId: string }) => m.subjectId === agentB.identityId,
      );
      expect(memberB).toBeDefined();
      expect(memberB.role).toBe('member');
    });

    it('agent B can now view the team', async () => {
      const { status, data } = await apiCall(
        'GET',
        `/teams/${teamId}`,
        agentB.accessToken,
      );

      expect(status).toBe(200);
      expect(data.name).toBe('invite-flow-team');
    });

    it('rejects duplicate join', async () => {
      const { status } = await apiCall(
        'POST',
        '/teams/join',
        agentB.accessToken,
        { code: inviteCode },
      );

      expect(status).toBe(409);
    });
  });

  // ── Member Management ──────────────────────────────────────────

  describe('member management', () => {
    let teamId: string;

    beforeAll(async () => {
      const { data } = await apiCall('POST', '/teams', agentA.accessToken, {
        name: 'member-mgmt-team',
      });
      teamId = data.id;
    });

    it('owner adds agent B as member directly', async () => {
      const { status, data } = await apiCall(
        'POST',
        `/teams/${teamId}/members`,
        agentA.accessToken,
        {
          subjectId: agentB.identityId,
          subjectNs: 'Agent',
          role: 'member',
        },
      );

      expect(status).toBe(201);
      expect(data.role).toBe('member');
    });

    it('non-owner cannot add members', async () => {
      const { status } = await apiCall(
        'POST',
        `/teams/${teamId}/members`,
        agentB.accessToken,
        {
          subjectId: agentA.identityId,
          subjectNs: 'Agent',
          role: 'member',
        },
      );

      expect(status).toBe(403);
    });

    it('owner removes agent B', async () => {
      const { status } = await apiCall(
        'DELETE',
        `/teams/${teamId}/members/${agentB.identityId}`,
        agentA.accessToken,
      );

      expect(status).toBe(200);
    });

    it('cannot remove last owner', async () => {
      const { status } = await apiCall(
        'DELETE',
        `/teams/${teamId}/members/${agentA.identityId}`,
        agentA.accessToken,
      );

      expect(status).toBe(400);
    });
  });

  // ── Delete Team ────────────────────────────────────────────────

  describe('DELETE /teams/:id', () => {
    it('owner deletes team', async () => {
      const { data: created } = await apiCall(
        'POST',
        '/teams',
        agentA.accessToken,
        { name: 'to-delete' },
      );

      const { status } = await apiCall(
        'DELETE',
        `/teams/${created.id}`,
        agentA.accessToken,
      );

      expect(status).toBe(200);

      // Verify it's gone
      const { status: getStatus } = await apiCall(
        'GET',
        `/teams/${created.id}`,
        agentA.accessToken,
      );
      expect(getStatus).toBe(404);
    });

    it('non-owner cannot delete team', async () => {
      const { data: created } = await apiCall(
        'POST',
        '/teams',
        agentA.accessToken,
        { name: 'not-deletable' },
      );

      const { status } = await apiCall(
        'DELETE',
        `/teams/${created.id}`,
        agentB.accessToken,
      );

      expect(status).toBe(403);
    });
  });
});
