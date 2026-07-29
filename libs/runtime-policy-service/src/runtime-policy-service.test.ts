import type {
  PermissionChecker,
  RelationshipReader,
  RelationshipWriter,
} from '@moltnet/auth';
import { KetoNamespace } from '@moltnet/auth';
import type {
  RuntimePolicyRepository,
  RuntimePolicySnapshot,
  RuntimePolicySnapshotRepository,
} from '@moltnet/database';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  canonicalEffectivePolicySnapshot,
  createRuntimePolicyService,
  hashEffectivePolicySnapshot,
  type RuntimePolicyServiceDeps,
  type RuntimePolicySubject,
} from './runtime-policy-service.js';

const TEAM_ID = 'team-1';
const AGENT_SUBJECT: RuntimePolicySubject = {
  identityId: 'agent-1',
  creatorId: 'agent-1',
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
    findByIdForTeam: vi.fn(),
    listByTeam: vi.fn(),
    findExistingIdsForTeam: vi.fn(),
    lockRuntimePolicy: vi.fn(),
    lockProfileBindings: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    getProfilePolicyContext: vi.fn(),
    profileExistsForTeam: vi.fn(),
  };
  const snapshotRepo = {
    upsert: vi
      .fn<RuntimePolicySnapshotRepository['upsert']>()
      .mockImplementation((input) =>
        Promise.resolve({ ...input, createdAt: NOW } as RuntimePolicySnapshot),
      ),
    findByHash: vi.fn(),
  };
  const reader = {
    listRuntimeProfilePolicies: vi.fn(),
    listRuntimePolicyTools: vi.fn().mockResolvedValue([]),
    listRuntimePolicyShellCommands: vi.fn().mockResolvedValue([]),
  };
  const writer = {
    writeRuntimePolicyEdges: vi.fn(),
    removeRuntimePolicyRelations: vi.fn(),
    writeRuntimeProfilePolicyEdges: vi.fn(),
  };
  const permissionChecker = {
    canManageTeamRuntime: vi.fn().mockResolvedValue(true),
  };
  const transactionRunner = {
    runInTransaction: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  };
  const service = createRuntimePolicyService({
    runtimePolicyRepository: repo as unknown as RuntimePolicyRepository,
    runtimePolicySnapshotRepository:
      snapshotRepo as unknown as RuntimePolicySnapshotRepository,
    relationshipReader: reader as unknown as RelationshipReader,
    relationshipWriter: writer as unknown as RelationshipWriter,
    permissionChecker: permissionChecker as unknown as PermissionChecker,
    transactionRunner:
      transactionRunner as unknown as RuntimePolicyServiceDeps['transactionRunner'],
  });
  return {
    service,
    repo,
    snapshotRepo,
    reader,
    writer,
    permissionChecker,
    transactionRunner,
  };
}

describe('createRuntimePolicyService', () => {
  let ctx: ReturnType<typeof makeService>;

  beforeEach(() => {
    ctx = makeService();
  });

  describe('resolveAllowedTools', () => {
    it('unions tools across bound policies and reads enforcement', async () => {
      // Arrange
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 3,
        enforcement: 'enforce',
      });
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1', 'P2']);
      ctx.reader.listRuntimePolicyTools.mockImplementation((id: string) =>
        Promise.resolve(id === 'P1' ? ['git', 'gh'] : ['gh', 'ls']),
      );
      ctx.reader.listRuntimePolicyShellCommands.mockImplementation(
        async (id: string) =>
          id === 'P1' ? ['v1/git/diff', 'v1/gh/pr/view'] : ['v1/git/diff'],
      );

      // Act
      const result = await ctx.service.resolveAllowedTools({
        profileId: 'R',
        teamId: TEAM_ID,
      });

      // Assert: enforcement passed through; tools unioned + de-duped + sorted.
      expect(result).toMatchObject({
        enforcement: 'enforce',
        allowedTools: ['gh', 'git', 'ls'],
        allowedShellCommands: [
          { argvPrefix: ['gh', 'pr', 'view'] },
          { argvPrefix: ['git', 'diff'] },
        ],
        runtimeKind: 'gondolin_pi',
        runtimeProfileRevision: 3,
      });
      expect(result.policySnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(ctx.repo.getProfilePolicyContext).toHaveBeenCalledWith(
        'R',
        TEAM_ID,
      );
      expect(ctx.snapshotRepo.upsert).not.toHaveBeenCalled();
    });

    it('persists the immutable snapshot only for claim-time resolution', async () => {
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 3,
        enforcement: 'enforce',
      });
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1']);
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['git']);

      const result = await ctx.service.resolvePinnedAllowedTools({
        profileId: 'R',
        teamId: TEAM_ID,
      });

      expect(ctx.snapshotRepo.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          hash: result.policySnapshotHash,
          allowedTools: ['git'],
          allowedShellCommands: [],
        }),
      );
    });

    it('returns enforcement + empty tools when no policies are bound', async () => {
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 1,
        enforcement: 'off',
      });
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue([]);

      const result = await ctx.service.resolveAllowedTools({
        profileId: 'R',
        teamId: TEAM_ID,
      });

      expect(result).toMatchObject({
        enforcement: 'off',
        allowedTools: [],
        allowedShellCommands: [],
        runtimeKind: 'gondolin_pi',
        capabilityManifestVersion: 'gondolin_pi:v1',
        runtimeProfileRevision: 1,
      });
      expect(result.policySnapshotHash).toMatch(/^sha256:[0-9a-f]{64}$/);
      expect(ctx.reader.listRuntimePolicyTools).not.toHaveBeenCalled();
      expect(ctx.reader.listRuntimePolicyShellCommands).not.toHaveBeenCalled();
    });

    it('fails closed when a stored shell command identifier is malformed', async () => {
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 1,
        enforcement: 'enforce',
      });
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1']);
      ctx.reader.listRuntimePolicyTools.mockResolvedValue([]);
      ctx.reader.listRuntimePolicyShellCommands.mockResolvedValue([
        'v1/git/%2f',
      ]);

      await expect(
        ctx.service.resolveAllowedTools({
          profileId: 'R',
          teamId: TEAM_ID,
        }),
      ).rejects.toThrow('canonically percent-encoded');
    });

    it('throws not-found when the profile is not in the team', async () => {
      ctx.repo.getProfilePolicyContext.mockResolvedValue(null);

      await expect(
        ctx.service.resolveAllowedTools({
          profileId: 'other-team-profile',
          teamId: TEAM_ID,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects tool names containing line breaks before normalization', async () => {
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 1,
        enforcement: 'enforce',
      });
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1']);
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['git\n']);

      await expect(
        ctx.service.resolveAllowedTools({
          profileId: 'R',
          teamId: TEAM_ID,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('create', () => {
    it('writes the row then exact tool and shell-command edges', async () => {
      // Arrange
      ctx.repo.create.mockResolvedValue(policyRow());

      // Act
      const result = await ctx.service.create({
        teamId: TEAM_ID,
        name: '  ci  ',
        description: 'CI tools',
        tools: ['git', 'gh', 'git'], // duplicate de-duped
        shellCommands: [
          { argvPrefix: ['git', 'diff'] },
          { argvPrefix: ['npm', 'run', 'test:unit'] },
          { argvPrefix: ['git', 'diff'] },
        ],
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
      // Keto: team edge + de-duped tool edges in a single batch patch.
      expect(ctx.writer.writeRuntimePolicyEdges).toHaveBeenCalledWith('pol-1', {
        teamId: TEAM_ID,
        addTools: ['gh', 'git'],
        addShellCommands: ['v1/git/diff', 'v1/npm/run/test%3Aunit'],
      });
      expect(ctx.writer.writeRuntimePolicyEdges).toHaveBeenCalledTimes(1);
      expect(result.tools).toEqual(['gh', 'git']);
      expect(result.shellCommands).toEqual([
        { argvPrefix: ['git', 'diff'] },
        { argvPrefix: ['npm', 'run', 'test:unit'] },
      ]);
    });

    it('sets the human creator column for a human subject', async () => {
      ctx.repo.create.mockResolvedValue(policyRow());
      await ctx.service.create({
        teamId: TEAM_ID,
        name: 'ci',
        tools: [],
        subject: {
          identityId: 'kratos-human-9',
          creatorId: 'human-9',
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

    it('rejects invalid shell command rules before writing anything', async () => {
      await expect(
        ctx.service.create({
          teamId: TEAM_ID,
          name: 'ci',
          tools: [],
          shellCommands: [
            {
              argvPrefix: ['git', 'diff\npush'],
            },
          ],
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(ctx.repo.create).not.toHaveBeenCalled();
    });

    it('accepts custom runtime tool names without a server-owned catalogue', async () => {
      ctx.repo.create.mockResolvedValue(policyRow());

      await expect(
        ctx.service.create({
          teamId: TEAM_ID,
          name: 'ci',
          tools: ['customer_dynamic_tool'],
          subject: AGENT_SUBJECT,
        }),
      ).resolves.toMatchObject({ tools: ['customer_dynamic_tool'] });
      expect(ctx.writer.writeRuntimePolicyEdges).toHaveBeenCalledWith('pol-1', {
        teamId: TEAM_ID,
        addTools: ['customer_dynamic_tool'],
      });
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
    it('locks and atomically patches tool and shell-command edges', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      ctx.repo.update.mockResolvedValue(policyRow({ name: 'ci-2' }));
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['gh']);
      ctx.reader.listRuntimePolicyShellCommands.mockResolvedValue([
        'v1/git/diff',
      ]);

      const result = await ctx.service.update(
        'pol-1',
        {
          name: 'ci-2',
          addTools: ['gh'],
          removeTools: ['git'],
          addShellCommands: [{ argvPrefix: ['gh', 'pr', 'view'] }],
          removeShellCommands: [{ argvPrefix: ['git', 'diff'] }],
        },
        { teamId: TEAM_ID, subject: AGENT_SUBJECT },
      );

      expect(ctx.transactionRunner.runInTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.repo.lockRuntimePolicy).toHaveBeenCalledWith('pol-1');
      expect(ctx.repo.update).toHaveBeenCalledWith('pol-1', TEAM_ID, {
        name: 'ci-2',
      });
      expect(ctx.writer.writeRuntimePolicyEdges).toHaveBeenCalledWith('pol-1', {
        addTools: ['gh'],
        removeTools: ['git'],
        addShellCommands: ['v1/gh/pr/view'],
        removeShellCommands: ['v1/git/diff'],
      });
      expect(ctx.repo.update.mock.invocationCallOrder[0]).toBeLessThan(
        ctx.writer.writeRuntimePolicyEdges.mock.invocationCallOrder[0],
      );
      expect(result.name).toBe('ci-2');
      expect(result.tools).toEqual(['gh']);
      expect(result.shellCommands).toEqual([
        { argvPrefix: ['gh', 'pr', 'view'] },
      ]);
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

    it('allows updates for operator-owned custom runtime tools', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      ctx.repo.update.mockResolvedValue(policyRow({ name: 'custom' }));
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['git']);

      await expect(
        ctx.service.update(
          'pol-1',
          { name: 'custom', addTools: ['customer_dynamic_tool'] },
          { teamId: TEAM_ID, subject: AGENT_SUBJECT },
        ),
      ).resolves.toMatchObject({
        tools: ['customer_dynamic_tool', 'git'],
      });
      expect(ctx.writer.writeRuntimePolicyEdges).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('revokes Keto relations before deleting the row', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      ctx.repo.delete.mockResolvedValue(true);
      await ctx.service.delete('pol-1', {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });
      // Keto revoke must happen before the SQL delete (fail-closed / retryable).
      const revokeOrder =
        ctx.writer.removeRuntimePolicyRelations.mock.invocationCallOrder[0];
      const deleteOrder = ctx.repo.delete.mock.invocationCallOrder[0];
      expect(revokeOrder).toBeLessThan(deleteOrder);
      expect(ctx.writer.removeRuntimePolicyRelations).toHaveBeenCalledWith(
        'pol-1',
      );
      expect(ctx.repo.delete).toHaveBeenCalledWith('pol-1', TEAM_ID);
    });

    it('throws not-found (and skips Keto) when the policy is absent', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(null);
      await expect(
        ctx.service.delete('pol-x', {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
      expect(ctx.writer.removeRuntimePolicyRelations).not.toHaveBeenCalled();
      expect(ctx.repo.delete).not.toHaveBeenCalled();
    });
  });

  describe('setProfilePolicies', () => {
    it('locks, diffs current vs desired, and batch-writes', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(true);
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 2,
        enforcement: 'enforce',
      });
      ctx.repo.findExistingIdsForTeam.mockResolvedValue(new Set(['P2', 'P3']));
      // Currently bound: P1, P2. Desired: P2, P3 → remove P1, add P3.
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1', 'P2']);

      await ctx.service.setProfilePolicies('prof-1', ['P2', 'P3'], {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });

      expect(ctx.transactionRunner.runInTransaction).toHaveBeenCalledTimes(1);
      expect(ctx.repo.lockProfileBindings).toHaveBeenCalledWith('prof-1');
      expect(ctx.repo.findExistingIdsForTeam).toHaveBeenCalledWith(
        ['P2', 'P3'],
        TEAM_ID,
      );
      // Single batch patch: add P3, remove P1.
      expect(ctx.writer.writeRuntimeProfilePolicyEdges).toHaveBeenCalledWith(
        'prof-1',
        { addPolicyIds: ['P3'], removePolicyIds: ['P1'] },
      );
    });

    it('rejects binding a policy from another team', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(true);
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 2,
        enforcement: 'enforce',
      });
      ctx.repo.findExistingIdsForTeam.mockResolvedValue(new Set()); // none in team

      await expect(
        ctx.service.setProfilePolicies('prof-1', ['foreign-policy'], {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(ctx.writer.writeRuntimeProfilePolicyEdges).not.toHaveBeenCalled();
    });

    it('binds policies containing operator-owned custom runtime tools', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(true);
      ctx.repo.getProfilePolicyContext.mockResolvedValue({
        runtimeKind: 'gondolin_pi',
        revision: 2,
        enforcement: 'enforce',
      });
      ctx.repo.findExistingIdsForTeam.mockResolvedValue(new Set(['P2']));
      ctx.reader.listRuntimePolicyTools.mockResolvedValue([
        'customer_dynamic_tool',
      ]);
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue([]);

      await expect(
        ctx.service.setProfilePolicies('prof-1', ['P2'], {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).resolves.toBeUndefined();
      expect(ctx.writer.writeRuntimeProfilePolicyEdges).toHaveBeenCalledWith(
        'prof-1',
        { addPolicyIds: ['P2'], removePolicyIds: [] },
      );
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

  describe('getProfilePolicies', () => {
    it('returns the bound policy ids for a team profile', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(true);
      ctx.reader.listRuntimeProfilePolicies.mockResolvedValue(['P1', 'P2']);
      const result = await ctx.service.getProfilePolicies('prof-1', {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });
      expect(result).toEqual({ policyIds: ['P1', 'P2'] });
    });

    it('throws not-found when the profile is not in the team', async () => {
      ctx.repo.profileExistsForTeam.mockResolvedValue(false);
      await expect(
        ctx.service.getProfilePolicies('prof-x', {
          teamId: TEAM_ID,
          subject: AGENT_SUBJECT,
        }),
      ).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('get / list', () => {
    it('get returns the policy with its tools and decoded shell commands', async () => {
      ctx.repo.findByIdForTeam.mockResolvedValue(policyRow());
      ctx.reader.listRuntimePolicyTools.mockResolvedValue(['git']);
      ctx.reader.listRuntimePolicyShellCommands.mockResolvedValue([
        'v1/gh/pr/view',
      ]);
      const result = await ctx.service.get('pol-1', {
        teamId: TEAM_ID,
        subject: AGENT_SUBJECT,
      });
      expect(result).toMatchObject({
        id: 'pol-1',
        tools: ['git'],
        shellCommands: [{ argvPrefix: ['gh', 'pr', 'view'] }],
      });
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

describe('effective policy snapshot hashing', () => {
  it('is stable across tool order and duplicates', () => {
    const first = canonicalEffectivePolicySnapshot({
      runtimeKind: 'gondolin_pi',
      enforcement: 'enforce',
      allowedTools: ['git', 'read', 'git'],
    });
    const second = canonicalEffectivePolicySnapshot({
      runtimeKind: 'gondolin_pi',
      enforcement: 'enforce',
      allowedTools: ['read', 'git'],
    });

    expect(first.allowedTools).toEqual(['git', 'read']);
    expect(hashEffectivePolicySnapshot(first)).toBe(
      hashEffectivePolicySnapshot(second),
    );
    expect(hashEffectivePolicySnapshot(first)).toBe(
      'sha256:3a15f51c2eaf106dcd4268e66e44ff271403f5e7d80d99f4dc1a0c6462cb8c33',
    );
  });
});
