import type {
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
import { KetoNamespace } from '@moltnet/auth';
import type { RuntimePolicyRepository } from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createRuntimePolicyService,
  type RuntimePolicySubject,
} from './runtime-policy-service.js';

const TEAM_ID = 'team-1';
const AGENT_SUBJECT: RuntimePolicySubject = {
  identityId: 'agent-1',
  subjectNs: KetoNamespace.Agent,
  subjectType: 'agent',
};
const NOW = new Date('2026-07-26T00:00:00.000Z');

function policyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pol-1',
    teamId: TEAM_ID,
    name: 'ci',
    description: null,
    createdByAgentId: 'agent-1',
    createdByHumanId: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeService() {
  const repo = {
    create: vi.fn(),
    findById: vi.fn(),
    findByIdForTeam: vi.fn(),
    listByTeam: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getProfileEnforcement: vi.fn(),
    profileExistsForTeam: vi.fn(),
  };
  const reader = {
    listRuntimeProfilePolicies: vi.fn(),
    listRuntimePolicyTools: vi.fn(),
  };
  const writer = {
    grantRuntimePolicyTeam: vi.fn(),
    grantRuntimePolicyTool: vi.fn(),
    removeRuntimePolicyTool: vi.fn(),
    removeRuntimePolicyRelations: vi.fn(),
    grantRuntimeProfilePolicy: vi.fn(),
    removeRuntimeProfilePolicy: vi.fn(),
  };
  const permissionChecker = {
    canManageTeamRuntime: vi.fn().mockResolvedValue(true),
  };
  const service = createRuntimePolicyService({
    runtimePolicyRepository: repo as unknown as RuntimePolicyRepository,
    relationshipReader: reader as unknown as RelationshipReader,
    relationshipWriter: writer as unknown as RelationshipWriter,
    permissionChecker: permissionChecker as unknown as PermissionChecker,
  });
  return { service, repo, reader, writer, permissionChecker };
}

describe('createRuntimePolicyService', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  describe('resolveAllowedTools', () => {
    it('unions tools across bound policies and reads enforcement', async () => {
      // Arrange
      ctx.repo.getProfileEnforcement.mockResolvedValue('enforce');
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1', 'P2']);
      ctx.reader.listRuntimePolicyTools.mockImplementation(
        async (id: string) => (id === 'P1' ? ['git', 'gh'] : ['gh', 'ls']),
      );

      // Act
      const result = await ctx.service.resolveAllowedTools({
        profileId: 'R',
        teamId: TEAM_ID,
      });

      // Assert: enforcement passed through; tools unioned + de-duped + sorted.
      expect(result).toEqual({
        enforcement: 'enforce',
        allowedTools: ['gh', 'git', 'ls'],
      });
      expect(ctx.repo.getProfileEnforcement).toHaveBeenCalledWith('R', TEAM_ID);
    });

    it('returns enforcement + empty tools when no policies are bound', async () => {
      ctx.repo.getProfileEnforcement.mockResolvedValue('off');
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue([]);

      const result = await ctx.service.resolveAllowedTools({
        profileId: 'R',
        teamId: TEAM_ID,
      });

      expect(result).toEqual({ enforcement: 'off', allowedTools: [] });
      expect(ctx.reader.listRuntimePolicyTools).not.toHaveBeenCalled();
    });

    it('throws not-found when the profile is not in the team', async () => {
      ctx.repo.getProfileEnforcement.mockResolvedValue(null);

      await expect(
        ctx.service.resolveAllowedTools({
          profileId: 'other-team-profile',
          teamId: TEAM_ID,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('create', () => {
    it('writes the row then team + tool edges, manager-authorized', async () => {
      // Arrange
      ctx.repo.create.mockResolvedValue(policyRow());

      // Act
      const result = await ctx.service.create({
        teamId: TEAM_ID,
        name: '  ci  ',
        description: 'CI tools',
        tools: ['git', 'gh', 'git'], // duplicate de-duped
        subject: AGENT_SUBJECT,
      });

      // Assert: authorized via team runtime-manage.
      expect(ctx.permissionChecker.canManageTeamRuntime).toHaveBeenCalledWith(
        TEAM_ID,
        'agent-1',
        KetoNamespace.Agent,
      );
      // Row inserted with trimmed name + agent creator (XOR).
      expect(ctx.repo.create).toHaveBeenCalledWith({
        teamId: TEAM_ID,
        name: 'ci',
        description: 'CI tools',
        createdByAgentId: 'agent-1',
      });
      // Keto: team edge + one tool edge per de-duped tool.
      expect(ctx.writer.grantRuntimePolicyTeam).toHaveBeenCalledWith(
        'pol-1',
        TEAM_ID,
      );
      expect(ctx.writer.grantRuntimePolicyTool).toHaveBeenCalledWith(
        'pol-1',
        'git',
      );
      expect(ctx.writer.grantRuntimePolicyTool).toHaveBeenCalledWith(
        'pol-1',
        'gh',
      );
      expect(ctx.writer.grantRuntimePolicyTool).toHaveBeenCalledTimes(2);
      expect(result.tools).toEqual(['git', 'gh']);
    });

    it('sets the human creator column for a human subject', async () => {
      ctx.repo.create.mockResolvedValue(policyRow());
      await ctx.service.create({
        teamId: TEAM_ID,
        name: 'ci',
        tools: [],
        subject: {
          identityId: 'human-9',
          subjectNs: KetoNamespace.Human,
          subjectType: 'human',
        },
      });
      expect(ctx.repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ createdByHumanId: 'human-9' }),
      );
    });

    it('is forbidden when the subject cannot manage team runtime', async () => {
      ctx.permissionChecker.canManageTeamRuntime.mockResolvedValue(false);
      await expect(
        ctx.service.create({
          teamId: TEAM_ID,
          name: 'ci',
          tools: ['git'],
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 403 });
      expect(ctx.repo.create).not.toHaveBeenCalled();
    });

    it('rejects invalid tool names before writing anything', async () => {
      await expect(
        ctx.service.create({
          teamId: TEAM_ID,
          name: 'ci',
          tools: ['git push'], // space is invalid
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(ctx.repo.create).not.toHaveBeenCalled();
    });

    it('rejects an empty name', async () => {
      await expect(
        ctx.service.create({
          teamId: TEAM_ID,
          name: '   ',
          tools: [],
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('update', () => {
    it('patches name and diffs tool edges', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      ctx.repo.update.mockResolvedValue(policyRow({ name: 'ci-2' }));
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['gh']);

      const result = await ctx.service.update(
        'pol-1',
        { name: 'ci-2', addTools: ['gh'], removeTools: ['git'] },
        { teamId: TEAM_ID, subject: AGENT_SUBJECT },
      );

      expect(ctx.repo.update).toHaveBeenCalledWith('pol-1', TEAM_ID, {
        name: 'ci-2',
      });
      expect(ctx.writer.removeRuntimePolicyTool).toHaveBeenCalledWith(
        'pol-1',
        'git',
      );
      expect(ctx.writer.grantRuntimePolicyTool).toHaveBeenCalledWith(
        'pol-1',
        'gh',
      );
      expect(result.name).toBe('ci-2');
      expect(result.tools).toEqual(['gh']);
    });

    it('throws not-found for a policy outside the team', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(null);
      await expect(
        ctx.service.update(
          'pol-x',
          { name: 'x' },
          { teamId: TEAM_ID, subject: AGENT_SUBJECT },
        ),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('delete', () => {
    it('deletes the row then removes its Keto relations', async () => {
      ctx.repo.delete.mockResolvedValue(true);
      await ctx.service.delete('pol-1', {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });
      expect(ctx.repo.delete).toHaveBeenCalledWith('pol-1', TEAM_ID);
      expect(ctx.writer.removeRuntimePolicyRelations).toHaveBeenCalledWith(
        'pol-1',
      );
    });

    it('throws not-found (and skips Keto) when the row is absent', async () => {
      ctx.repo.delete.mockResolvedValue(false);
      await expect(
        ctx.service.delete('pol-x', {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(ctx.writer.removeRuntimePolicyRelations).not.toHaveBeenCalled();
    });
  });

  describe('setProfilePolicies', () => {
    it('diffs current vs desired bindings', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(true);
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      // Currently bound: P1, P2. Desired: P2, P3 → remove P1, add P3.
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1', 'P2']);

      await ctx.service.setProfilePolicies('prof-1', ['P2', 'P3'], {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });

      expect(ctx.writer.removeRuntimeProfilePolicy).toHaveBeenCalledWith(
        'prof-1',
        'P1',
      );
      expect(ctx.writer.grantRuntimeProfilePolicy).toHaveBeenCalledWith(
        'prof-1',
        'P3',
      );
      expect(ctx.writer.removeRuntimeProfilePolicy).toHaveBeenCalledTimes(1);
      expect(ctx.writer.grantRuntimeProfilePolicy).toHaveBeenCalledTimes(1);
    });

    it('rejects binding a policy from another team', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(true);
      ctx.repo.findByIdForTeam.mockResolvedValue(null); // policy not in team

      await expect(
        ctx.service.setProfilePolicies('prof-1', ['foreign-policy'], {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(ctx.writer.grantRuntimeProfilePolicy).not.toHaveBeenCalled();
    });

    it('throws not-found when the profile is not in the team', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(false);
      await expect(
        ctx.service.setProfilePolicies('prof-x', [], {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('get / list', () => {
    it('get returns the policy with its tools', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['git']);
      const result = await ctx.service.get('pol-1', {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });
      expect(result).toMatchObject({ id: 'pol-1', tools: ['git'] });
    });

    it('list maps rows without expanding tools', async () => {
      ctx.repo.listByTeam.mockResolvedValue([policyRow()]);
      const result = await ctx.service.list({
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });
      expect(result).toHaveLength(1);
      expect(ctx.reader.listRuntimePolicyTools).not.toHaveBeenCalled();
    });
  });
});
