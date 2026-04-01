/**
 * Team Management Routes
 *
 * CRUD for teams, invite codes, and join flow.
 * Membership is stored in Keto — routes write Keto tuples on member changes.
 * Mutating operations use transaction + compensation for DB/Keto consistency.
 */

import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, TeamRelation } from '@moltnet/auth';
import {
  CreateTeamInviteSchema,
  CreateTeamSchema,
  DeletedResponseSchema,
  JoinTeamResponseSchema,
  JoinTeamSchema,
  ProblemDetailsSchema,
  RemovedResponseSchema,
  TeamDetailSchema,
  TeamInviteParamsSchema,
  TeamInviteResponseSchema,
  TeamListItemSchema,
  TeamMemberParamsSchema,
  TeamMemberSchema,
  TeamParamsSchema,
  TeamResponseSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';

// ── Routes ─────────────────────────────────────────────────────

export async function teamRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // ── Create Team ──────────────────────────────────────────────
  server.post(
    '/teams',
    {
      schema: {
        operationId: 'createTeam',
        tags: ['teams'],
        description: 'Create a new project team. Caller becomes owner.',
        security: [{ bearerAuth: [] }],
        body: CreateTeamSchema,
        response: {
          201: TeamResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const { name } = request.body;

      const team = await fastify.transactionRunner.runInTransaction(
        async () => {
          return fastify.teamRepository.create({
            name,
            personal: false,
            createdBy: identityId,
            status: 'active',
          });
        },
      );

      try {
        await fastify.relationshipWriter.grantTeamOwners(
          team.id,
          identityId,
          subjectNs,
        );
      } catch (err) {
        request.log.error(
          { teamId: team.id, identityId, err },
          'team.keto_grant_owner_failed',
        );
        try {
          await fastify.teamRepository.delete(team.id);
        } catch (deleteErr) {
          request.log.error(
            { teamId: team.id, deleteErr },
            'team.compensation_delete_failed',
          );
        }
        throw err;
      }

      return reply.status(201).send({ id: team.id, name: team.name });
    },
  );

  // ── List My Teams ────────────────────────────────────────────
  server.get(
    '/teams',
    {
      schema: {
        operationId: 'listTeams',
        tags: ['teams'],
        description: 'List teams the caller belongs to.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Object({
            items: Type.Array(TeamListItemSchema),
          }),
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { identityId } = request.authContext!;

      // Single Keto call: get all team IDs + roles for this subject
      const teamRoles =
        await fastify.relationshipReader.listTeamIdsAndRolesBySubject(
          identityId,
        );
      if (teamRoles.length === 0) return { items: [] };

      // Single DB query: batch fetch all team metadata
      const teamsMap = new Map(
        (
          await fastify.teamRepository.listByIds(teamRoles.map((r) => r.teamId))
        ).map((t) => [t.id, t]),
      );

      // Build role map from the Keto tuples we already have
      const roleMap = new Map(teamRoles.map((r) => [r.teamId, r.relation]));

      const items = teamRoles
        .map((r) => {
          const team = teamsMap.get(r.teamId);
          if (!team) return null;
          return {
            id: team.id,
            name: team.name,
            personal: team.personal,
            status: team.status,
            role: roleMap.get(r.teamId) ?? 'member',
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);

      return { items };
    },
  );

  // ── Get Team ─────────────────────────────────────────────────
  server.get(
    '/teams/:id',
    {
      schema: {
        operationId: 'getTeam',
        tags: ['teams'],
        description: 'Get team details. Requires team access.',
        security: [{ bearerAuth: [] }],
        params: TeamParamsSchema,
        response: {
          200: TeamDetailSchema,
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canAccess = await fastify.permissionChecker.canAccessTeam(
        id,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      const members = await fastify.relationshipReader.listTeamMembers(id);

      return {
        ...team,
        members: members.map((m) => ({
          subjectId: m.subjectId,
          subjectNs: m.subjectNs,
          role: m.relation,
        })),
      };
    },
  );

  // ── Delete Team ──────────────────────────────────────────────
  server.delete(
    '/teams/:id',
    {
      schema: {
        operationId: 'deleteTeam',
        tags: ['teams'],
        description: 'Delete a team. Requires manage permission (owner only).',
        security: [{ bearerAuth: [] }],
        params: TeamParamsSchema,
        response: {
          200: DeletedResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManage = await fastify.permissionChecker.canManageTeam(
        id,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      if (team.personal) {
        throw createProblem('team-personal-immutable');
      }

      // Snapshot members before DB delete for Keto cleanup
      const members = await fastify.relationshipReader.listTeamMembers(id);

      // Delete DB row first (cascade handles team_invites).
      // If this fails, Keto tuples remain consistent.
      await fastify.teamRepository.delete(id);

      // Best-effort Keto cleanup — orphan tuples are harmless
      // (team no longer exists in DB so tuples are dead references)
      for (const member of members) {
        try {
          await fastify.relationshipWriter.removeTeamMemberRelation(
            id,
            member.subjectId,
            member.subjectNs as KetoNamespace,
          );
        } catch (err) {
          request.log.warn(
            { teamId: id, subjectId: member.subjectId, err },
            'team.delete_keto_cleanup_failed',
          );
        }
      }

      return reply.status(200).send({ deleted: true });
    },
  );

  // ── List Members ─────────────────────────────────────────────
  server.get(
    '/teams/:id/members',
    {
      schema: {
        operationId: 'listTeamMembers',
        tags: ['teams'],
        description: 'List team members. Requires team access.',
        security: [{ bearerAuth: [] }],
        params: TeamParamsSchema,
        response: {
          200: Type.Object({ items: Type.Array(TeamMemberSchema) }),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canAccess = await fastify.permissionChecker.canAccessTeam(
        id,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');

      const members = await fastify.relationshipReader.listTeamMembers(id);

      return {
        items: members.map((m) => ({
          subjectId: m.subjectId,
          subjectNs: m.subjectNs,
          role: m.relation,
        })),
      };
    },
  );

  // ── Remove Member ────────────────────────────────────────────
  server.delete(
    '/teams/:id/members/:subjectId',
    {
      schema: {
        operationId: 'removeTeamMember',
        tags: ['teams'],
        description: 'Remove a member. Requires manage_members permission.',
        security: [{ bearerAuth: [] }],
        params: TeamMemberParamsSchema,
        response: {
          200: RemovedResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { id, subjectId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          id,
          identityId,
          subjectNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      const members = await fastify.relationshipReader.listTeamMembers(id);
      const owners = members.filter(
        (m) => m.relation === (TeamRelation.Owners as string),
      );
      const isRemovingOwner = owners.some((o) => o.subjectId === subjectId);
      if (isRemovingOwner && owners.length <= 1) {
        throw createProblem('team-last-owner');
      }

      // Remove all role tuples for both possible namespaces
      await fastify.relationshipWriter.removeTeamMemberRelation(
        id,
        subjectId,
        KetoNamespace.Agent,
      );
      await fastify.relationshipWriter.removeTeamMemberRelation(
        id,
        subjectId,
        KetoNamespace.Human,
      );

      // Post-delete safety check: verify we didn't race with a concurrent
      // removal and leave the team ownerless. If so, re-grant.
      // (Proper fix is a DBOS workflow — this is a best-effort guard.)
      if (isRemovingOwner) {
        const postMembers =
          await fastify.relationshipReader.listTeamMembers(id);
        const postOwners = postMembers.filter(
          (m) => m.relation === (TeamRelation.Owners as string),
        );
        if (postOwners.length === 0 && postMembers.length > 0) {
          request.log.error(
            { teamId: id, removedSubject: subjectId },
            'team.last_owner_removed_race — re-granting ownership',
          );
          // Re-grant to the subject we just removed
          await fastify.relationshipWriter.grantTeamOwners(
            id,
            subjectId,
            KetoNamespace.Agent,
          );
          throw createProblem('team-last-owner');
        }
      }

      return reply.status(200).send({ removed: true });
    },
  );

  // ── Create Invite ────────────────────────────────────────────
  server.post(
    '/teams/:id/invites',
    {
      schema: {
        operationId: 'createTeamInvite',
        tags: ['teams'],
        description:
          'Create an invite code. Requires manage_members permission.',
        security: [{ bearerAuth: [] }],
        params: TeamParamsSchema,
        body: CreateTeamInviteSchema,
        response: {
          201: TeamInviteResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          id,
          identityId,
          subjectNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      if (team.personal) {
        throw createProblem('team-personal-immutable');
      }

      const expiresInHours = request.body.expiresInHours ?? 168;
      const invite = await fastify.teamRepository.createInvite({
        teamId: id,
        role: request.body.role ?? 'member',
        maxUses: request.body.maxUses ?? 1,
        expiresAt: new Date(Date.now() + expiresInHours * 3600_000),
        createdBy: identityId,
      });

      return reply
        .status(201)
        .send({ code: invite.code, expiresAt: invite.expiresAt });
    },
  );

  // ── List Invites ─────────────────────────────────────────────
  server.get(
    '/teams/:id/invites',
    {
      schema: {
        operationId: 'listTeamInvites',
        tags: ['teams'],
        description: 'List invite codes. Requires manage_members permission.',
        security: [{ bearerAuth: [] }],
        params: TeamParamsSchema,
        response: {
          200: Type.Object({ items: Type.Array(TeamInviteResponseSchema) }),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          id,
          identityId,
          subjectNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      const invites = await fastify.teamRepository.listInvites(id);
      return { items: invites };
    },
  );

  // ── Delete Invite ────────────────────────────────────────────
  server.delete(
    '/teams/:id/invites/:inviteId',
    {
      schema: {
        operationId: 'deleteTeamInvite',
        tags: ['teams'],
        description:
          'Delete an invite code. Requires manage_members permission.',
        security: [{ bearerAuth: [] }],
        params: TeamInviteParamsSchema,
        response: {
          200: DeletedResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { id, inviteId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          id,
          identityId,
          subjectNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      const deleted = await fastify.teamRepository.deleteInviteByTeam(
        inviteId,
        id,
      );
      if (!deleted) throw createProblem('not-found');
      return reply.status(200).send({ deleted: true });
    },
  );

  // ── Join Team via Invite Code ────────────────────────────────
  server.post(
    '/teams/join',
    {
      schema: {
        operationId: 'joinTeam',
        tags: ['teams'],
        description: 'Join a team using an invite code.',
        security: [{ bearerAuth: [] }],
        body: JoinTeamSchema,
        response: {
          200: JoinTeamResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
          410: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { identityId } = request.authContext!;
      const { code } = request.body;

      const invite = await fastify.teamRepository.findInviteByCode(code);
      if (!invite) {
        throw createProblem('not-found', 'Invalid invite code');
      }

      if (invite.expiresAt < new Date()) {
        throw createProblem('invite-expired');
      }

      const team = await fastify.teamRepository.findById(invite.teamId);
      if (!team || team.personal) {
        throw createProblem('not-found', 'Invalid invite code');
      }

      if (team.status !== 'active') {
        throw createProblem('team-not-active');
      }

      // Check if already a member
      const existingMembers = await fastify.relationshipReader.listTeamMembers(
        invite.teamId,
      );
      if (existingMembers.some((m) => m.subjectId === identityId)) {
        throw createProblem('conflict', 'Already a member of this team');
      }

      // Atomic claim: INCREMENT use_count WHERE use_count < max_uses
      // Returns null if exhausted — no race condition.
      const claimed = await fastify.teamRepository.claimInvite(invite.id);
      if (!claimed) {
        throw createProblem('invite-exhausted');
      }

      const ns =
        request.authContext!.subjectType === 'human'
          ? KetoNamespace.Human
          : KetoNamespace.Agent;
      try {
        if (invite.role === 'manager') {
          await fastify.relationshipWriter.grantTeamManagers(
            invite.teamId,
            identityId,
            ns,
          );
        } else {
          await fastify.relationshipWriter.grantTeamMembers(
            invite.teamId,
            identityId,
            ns,
          );
        }
      } catch (err) {
        request.log.error(
          { teamId: invite.teamId, identityId, inviteId: invite.id, err },
          'team.join_keto_grant_failed — invite claimed but Keto write failed',
        );
        try {
          await fastify.teamRepository.revertInviteClaim(invite.id);
        } catch (revertErr) {
          request.log.error(
            { inviteId: invite.id, revertErr },
            'team.join_invite_revert_failed',
          );
        }
        throw err;
      }

      return reply.status(200).send({
        teamId: invite.teamId,
        role: invite.role,
      });
    },
  );
}
