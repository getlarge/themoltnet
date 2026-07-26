import { type RuntimePolicy, UniqueViolationError } from '@moltnet/database';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createMockServices,
  createTestApp,
  OWNER_ID,
  resetMockServices,
  VALID_AUTH_CONTEXT,
} from './helpers.js';

const TEAM_ID = 'bbbbbbbb-0000-0000-0000-000000000002';
const POLICY_ID = 'cccccccc-0000-0000-0000-000000000003';
const PROFILE_ID = 'dddddddd-0000-0000-0000-000000000004';
const TEAM_HEADERS = {
  authorization: 'Bearer test-token',
  'x-moltnet-team-id': TEAM_ID,
};

function policyRow(overrides: Partial<RuntimePolicy> = {}): RuntimePolicy {
  return {
    id: POLICY_ID,
    teamId: TEAM_ID,
    name: 'ci',
    description: null,
    createdByAgentId: OWNER_ID,
    createdByHumanId: null,
    createdAt: new Date('2026-07-26T00:00:00.000Z'),
    updatedAt: new Date('2026-07-26T00:00:00.000Z'),
    ...overrides,
  };
}

describe('runtime tool-policy routes', () => {
  let app: FastifyInstance;
  let mocks: ReturnType<typeof createMockServices>;

  beforeAll(async () => {
    mocks = createMockServices();
    app = await createTestApp(mocks, VALID_AUTH_CONTEXT);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    resetMockServices(mocks);
    // Team-membership gate in the auth plugin (x-moltnet-team-id resolution).
    mocks.permissionChecker.canAccessTeam.mockResolvedValue(true);
    mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(true);
  });

  describe('POST /runtime-policies', () => {
    it('creates a policy and writes the team + tool edges', async () => {
      mocks.runtimePolicyRepository.create.mockResolvedValue(policyRow());

      const response = await app.inject({
        method: 'POST',
        url: '/runtime-policies',
        headers: TEAM_HEADERS,
        payload: { name: 'ci', description: 'CI tools', tools: ['git', 'gh'] },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        id: POLICY_ID,
        teamId: TEAM_ID,
        name: 'ci',
        tools: ['git', 'gh'],
      });
      expect(mocks.runtimePolicyRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({
          teamId: TEAM_ID,
          name: 'ci',
          createdByAgentId: OWNER_ID,
        }),
      );
      expect(
        mocks.relationshipWriter.grantRuntimePolicyTeam,
      ).toHaveBeenCalledWith(POLICY_ID, TEAM_ID);
      expect(
        mocks.relationshipWriter.grantRuntimePolicyTool,
      ).toHaveBeenCalledWith(POLICY_ID, 'git');
      expect(
        mocks.relationshipWriter.grantRuntimePolicyTool,
      ).toHaveBeenCalledWith(POLICY_ID, 'gh');
    });

    it('rejects requests without a team header', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime-policies',
        headers: { authorization: 'Bearer test-token' },
        payload: { name: 'ci', tools: [] },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.runtimePolicyRepository.create).not.toHaveBeenCalled();
    });

    it('is forbidden when the caller cannot manage team runtime', async () => {
      mocks.permissionChecker.canManageTeamRuntime.mockResolvedValue(false);

      const response = await app.inject({
        method: 'POST',
        url: '/runtime-policies',
        headers: TEAM_HEADERS,
        payload: { name: 'ci', tools: ['git'] },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.runtimePolicyRepository.create).not.toHaveBeenCalled();
    });

    it('rejects invalid tool names at the schema boundary', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/runtime-policies',
        headers: TEAM_HEADERS,
        payload: { name: 'ci', tools: ['git push'] },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.runtimePolicyRepository.create).not.toHaveBeenCalled();
    });

    it('maps a duplicate policy name to 409', async () => {
      mocks.runtimePolicyRepository.create.mockRejectedValue(
        new UniqueViolationError({
          constraint: 'runtime_policies_team_name_idx',
          target: {
            resource: 'runtime-policy',
            keys: { teamId: TEAM_ID, name: 'ci' },
          },
        }),
      );

      const response = await app.inject({
        method: 'POST',
        url: '/runtime-policies',
        headers: TEAM_HEADERS,
        payload: { name: 'ci', tools: [] },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ code: 'CONFLICT' });
    });
  });

  describe('GET /runtime-policies', () => {
    it('lists policies for the active team', async () => {
      mocks.runtimePolicyRepository.listByTeam.mockResolvedValue([policyRow()]);

      const response = await app.inject({
        method: 'GET',
        url: '/runtime-policies',
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().items).toHaveLength(1);
      expect(mocks.runtimePolicyRepository.listByTeam).toHaveBeenCalledWith(
        TEAM_ID,
      );
    });
  });

  describe('GET /runtime-policies/:policyId', () => {
    it('returns the policy with its tools', async () => {
      mocks.runtimePolicyRepository.findByIdForTeam.mockResolvedValue(
        policyRow(),
      );
      mocks.relationshipReader.listRuntimePolicyTools.mockResolvedValue([
        'git',
      ]);

      const response = await app.inject({
        method: 'GET',
        url: `/runtime-policies/${POLICY_ID}`,
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ id: POLICY_ID, tools: ['git'] });
    });

    it('returns 404 for a policy outside the team', async () => {
      mocks.runtimePolicyRepository.findByIdForTeam.mockResolvedValue(null);

      const response = await app.inject({
        method: 'GET',
        url: `/runtime-policies/${POLICY_ID}`,
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('DELETE /runtime-policies/:policyId', () => {
    it('deletes the policy and removes its Keto relations', async () => {
      mocks.runtimePolicyRepository.delete.mockResolvedValue(true);

      const response = await app.inject({
        method: 'DELETE',
        url: `/runtime-policies/${POLICY_ID}`,
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(204);
      expect(
        mocks.relationshipWriter.removeRuntimePolicyRelations,
      ).toHaveBeenCalledWith(POLICY_ID);
    });

    it('returns 404 when the policy is absent', async () => {
      mocks.runtimePolicyRepository.delete.mockResolvedValue(false);

      const response = await app.inject({
        method: 'DELETE',
        url: `/runtime-policies/${POLICY_ID}`,
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('PUT /runtime-profiles/:profileId/policies', () => {
    it('binds policies to a profile (diffing current vs desired)', async () => {
      mocks.runtimePolicyRepository.profileExistsForTeam.mockResolvedValue(
        true,
      );
      mocks.runtimePolicyRepository.findByIdForTeam.mockResolvedValue(
        policyRow(),
      );
      mocks.relationshipReader.listRuntimeProfilePolicies.mockResolvedValue([]);

      const response = await app.inject({
        method: 'PUT',
        url: `/runtime-profiles/${PROFILE_ID}/policies`,
        headers: TEAM_HEADERS,
        payload: { policyIds: [POLICY_ID] },
      });

      expect(response.statusCode).toBe(204);
      expect(
        mocks.relationshipWriter.grantRuntimeProfilePolicy,
      ).toHaveBeenCalledWith(PROFILE_ID, POLICY_ID);
    });

    it('rejects binding a policy from another team', async () => {
      mocks.runtimePolicyRepository.profileExistsForTeam.mockResolvedValue(
        true,
      );
      mocks.runtimePolicyRepository.findByIdForTeam.mockResolvedValue(null);

      const response = await app.inject({
        method: 'PUT',
        url: `/runtime-profiles/${PROFILE_ID}/policies`,
        headers: TEAM_HEADERS,
        payload: { policyIds: [POLICY_ID] },
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /runtime-profiles/:profileId/allowed-tools', () => {
    it('resolves enforcement + the unioned allowed-tool set', async () => {
      mocks.runtimePolicyRepository.getProfileEnforcement.mockResolvedValue(
        'enforce',
      );
      mocks.relationshipReader.listRuntimeProfilePolicies.mockResolvedValue([
        'P1',
        'P2',
      ]);
      mocks.relationshipReader.listRuntimePolicyTools.mockImplementation(
        async (id: string) => (id === 'P1' ? ['git', 'gh'] : ['gh', 'ls']),
      );

      const response = await app.inject({
        method: 'GET',
        url: `/runtime-profiles/${PROFILE_ID}/allowed-tools`,
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        enforcement: 'enforce',
        allowedTools: ['gh', 'git', 'ls'],
      });
    });

    it('returns 404 when the profile is not in the team', async () => {
      mocks.runtimePolicyRepository.getProfileEnforcement.mockResolvedValue(
        null,
      );

      const response = await app.inject({
        method: 'GET',
        url: `/runtime-profiles/${PROFILE_ID}/allowed-tools`,
        headers: TEAM_HEADERS,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
