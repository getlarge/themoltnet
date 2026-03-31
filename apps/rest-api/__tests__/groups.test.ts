/**
 * Group routes unit tests
 */

import type { FastifyInstance } from 'fastify';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  type MockServices,
  OTHER_AGENT_ID,
  OWNER_ID,
  TEST_BEARER_TOKEN,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const authHeaders = { authorization: `Bearer ${TEST_BEARER_TOKEN}` };

const GROUP_ID = '990e8400-e29b-41d4-a716-446655440010';
const TEAM_ID = 'aa0e8400-e29b-41d4-a716-446655440011';

const MOCK_GROUP = {
  id: GROUP_ID,
  name: 'Engineering',
  teamId: TEAM_ID,
  createdBy: OWNER_ID,
  createdAt: new Date('2026-01-30T10:00:00Z'),
};

const MOCK_TEAM = {
  id: TEAM_ID,
  name: 'Test Team',
  personal: false,
  createdBy: OWNER_ID,
  status: 'active' as const,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('Group routes', () => {
  let app: FastifyInstance;
  let mocks: MockServices;

  beforeEach(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);

    mocks.transactionRunner.runInTransaction.mockImplementation(
      async (fn: () => Promise<unknown>) => fn(),
    );

    mocks.groupRepository.create.mockResolvedValue(MOCK_GROUP);
    mocks.groupRepository.findById.mockResolvedValue(MOCK_GROUP);
    mocks.groupRepository.listByTeamId.mockResolvedValue([MOCK_GROUP]);
    mocks.groupRepository.delete.mockResolvedValue(true);

    mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(true);
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
  });

  // ── POST /teams/:id/groups ────────────────────────────────────

  describe('POST /teams/:id/groups', () => {
    beforeEach(() => {
      mocks.teamRepository.findById.mockResolvedValue(MOCK_TEAM);
      mocks.relationshipWriter.grantGroupParent.mockResolvedValue(undefined);
    });

    it('creates a group and returns 201, verifies grantGroupParent called', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/teams/${TEAM_ID}/groups`,
        headers: authHeaders,
        payload: { name: 'Engineering' },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        id: GROUP_ID,
        name: 'Engineering',
        teamId: TEAM_ID,
      });
      expect(mocks.relationshipWriter.grantGroupParent).toHaveBeenCalledWith(
        GROUP_ID,
        TEAM_ID,
      );
    });

    it('returns 403 if caller lacks manage_members permission', async () => {
      mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(false);

      const res = await app.inject({
        method: 'POST',
        url: `/teams/${TEAM_ID}/groups`,
        headers: authHeaders,
        payload: { name: 'Engineering' },
      });

      expect(res.statusCode).toBe(403);
    });

    it('returns 400 if team is personal', async () => {
      mocks.teamRepository.findById.mockResolvedValue({
        ...MOCK_TEAM,
        personal: true,
      });

      const res = await app.inject({
        method: 'POST',
        url: `/teams/${TEAM_ID}/groups`,
        headers: authHeaders,
        payload: { name: 'Engineering' },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── GET /teams/:id/groups ─────────────────────────────────────

  describe('GET /teams/:id/groups', () => {
    it('lists groups for a team and returns 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/teams/${TEAM_ID}/groups`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        items: [{ id: GROUP_ID, name: 'Engineering', teamId: TEAM_ID }],
      });
      expect(mocks.groupRepository.listByTeamId).toHaveBeenCalledWith(TEAM_ID);
    });

    it('returns 404 if caller has no team access', async () => {
      mocks.permissionChecker.canAccessTeam.mockResolvedValue(false);

      const res = await app.inject({
        method: 'GET',
        url: `/teams/${TEAM_ID}/groups`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── GET /groups/:groupId ──────────────────────────────────────

  describe('GET /groups/:groupId', () => {
    beforeEach(() => {
      mocks.relationshipReader.listGroupMembers.mockResolvedValue([
        { subjectId: OTHER_AGENT_ID, subjectNs: 'Agent' },
      ]);
    });

    it('returns group details with members and 200', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/groups/${GROUP_ID}`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        id: GROUP_ID,
        name: 'Engineering',
        teamId: TEAM_ID,
        createdBy: OWNER_ID,
        members: [{ subjectId: OTHER_AGENT_ID, subjectNs: 'Agent' }],
      });
    });

    it('returns 404 if group not found', async () => {
      mocks.groupRepository.findById.mockResolvedValue(null);

      const res = await app.inject({
        method: 'GET',
        url: `/groups/${GROUP_ID}`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /groups/:groupId ───────────────────────────────────

  describe('DELETE /groups/:groupId', () => {
    beforeEach(() => {
      mocks.relationshipWriter.removeGroupRelations.mockResolvedValue(
        undefined,
      );
    });

    it('deletes a group and returns 200', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/groups/${GROUP_ID}`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ deleted: true });
      expect(mocks.groupRepository.delete).toHaveBeenCalledWith(GROUP_ID);
      expect(
        mocks.relationshipWriter.removeGroupRelations,
      ).toHaveBeenCalledWith(GROUP_ID);
    });

    it('returns 403 if caller lacks manage_members permission', async () => {
      mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(false);

      const res = await app.inject({
        method: 'DELETE',
        url: `/groups/${GROUP_ID}`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── POST /groups/:groupId/members ─────────────────────────────

  describe('POST /groups/:groupId/members', () => {
    beforeEach(() => {
      mocks.relationshipReader.listTeamMembers.mockResolvedValue([
        { subjectId: OTHER_AGENT_ID, subjectNs: 'Agent', relation: 'member' },
      ]);
      mocks.relationshipWriter.grantGroupMember.mockResolvedValue(undefined);
    });

    it('adds a team member to the group and returns 201', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/groups/${GROUP_ID}/members`,
        headers: authHeaders,
        payload: { subjectId: OTHER_AGENT_ID },
      });

      expect(res.statusCode).toBe(201);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({
        subjectId: OTHER_AGENT_ID,
        subjectNs: 'Agent',
      });
      expect(mocks.relationshipWriter.grantGroupMember).toHaveBeenCalledWith(
        GROUP_ID,
        OTHER_AGENT_ID,
        'Agent',
      );
    });

    it('returns 404 if subject is not a team member', async () => {
      mocks.relationshipReader.listTeamMembers.mockResolvedValue([]);

      const res = await app.inject({
        method: 'POST',
        url: `/groups/${GROUP_ID}/members`,
        headers: authHeaders,
        payload: { subjectId: OTHER_AGENT_ID },
      });

      expect(res.statusCode).toBe(404);
    });

    it('returns 403 if caller lacks manage_members permission', async () => {
      mocks.permissionChecker.canManageTeamMembers.mockResolvedValue(false);

      const res = await app.inject({
        method: 'POST',
        url: `/groups/${GROUP_ID}/members`,
        headers: authHeaders,
        payload: { subjectId: OTHER_AGENT_ID },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── GET /groups/:groupId/members ──────────────────────────────

  describe('GET /groups/:groupId/members', () => {
    it('lists group members and returns 200', async () => {
      mocks.relationshipReader.listGroupMembers.mockResolvedValue([
        { subjectId: OWNER_ID, subjectNs: 'Agent' },
        { subjectId: OTHER_AGENT_ID, subjectNs: 'Agent' },
      ]);

      const res = await app.inject({
        method: 'GET',
        url: `/groups/${GROUP_ID}/members`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.items).toHaveLength(2);
    });
  });

  // ── DELETE /groups/:groupId/members/:subjectId ────────────────

  describe('DELETE /groups/:groupId/members/:subjectId', () => {
    beforeEach(() => {
      mocks.relationshipWriter.removeGroupMember.mockResolvedValue(undefined);
    });

    it('removes a member from the group and returns 200, calls removeGroupMember twice', async () => {
      const res = await app.inject({
        method: 'DELETE',
        url: `/groups/${GROUP_ID}/members/${OTHER_AGENT_ID}`,
        headers: authHeaders,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body).toMatchObject({ removed: true });

      // Called twice: once for Agent namespace, once for Human namespace
      expect(mocks.relationshipWriter.removeGroupMember).toHaveBeenCalledTimes(
        2,
      );
      expect(mocks.relationshipWriter.removeGroupMember).toHaveBeenCalledWith(
        GROUP_ID,
        OTHER_AGENT_ID,
        'Agent',
      );
      expect(mocks.relationshipWriter.removeGroupMember).toHaveBeenCalledWith(
        GROUP_ID,
        OTHER_AGENT_ID,
        'Human',
      );
    });
  });
});
