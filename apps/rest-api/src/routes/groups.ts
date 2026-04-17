/**
 * Group Management Routes
 *
 * CRUD for groups within teams, and group membership management.
 * Groups are stored in DB; membership is stored in Keto.
 * Mutating operations use transaction + compensation for DB/Keto consistency.
 */

import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  AddGroupMemberSchema,
  CreateGroupSchema,
  DeletedResponseSchema,
  GroupDetailSchema,
  GroupMemberParamsSchema,
  GroupMemberResponseSchema,
  GroupParamsSchema,
  GroupResponseSchema,
  ProblemDetailsSchema,
  RemovedResponseSchema,
  TeamParamsSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem, isUniqueViolation } from '../problems/index.js';

// ── Routes ─────────────────────────────────────────────────────

export async function groupRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // ── Create Group ─────────────────────────────────────────────
  server.post(
    '/teams/:id/groups',
    {
      schema: {
        operationId: 'createGroup',
        tags: ['groups'],
        description:
          'Create a group within a team. Requires manage_members permission.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        body: CreateGroupSchema,
        response: {
          201: GroupResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
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

      const { name } = request.body;

      let group;
      try {
        group = await fastify.transactionRunner.runInTransaction(async () => {
          return fastify.groupRepository.create({
            name,
            teamId: id,
            createdBy: identityId,
          });
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw createProblem(
            'conflict',
            'A group with this name already exists in this team',
          );
        }
        throw err;
      }

      try {
        await fastify.relationshipWriter.grantGroupParent(group.id, id);
      } catch (err) {
        request.log.error(
          { groupId: group.id, teamId: id, err },
          'group.keto_grant_parent_failed',
        );
        try {
          await fastify.groupRepository.delete(group.id);
        } catch (deleteErr) {
          request.log.error(
            { groupId: group.id, deleteErr },
            'group.compensation_delete_failed',
          );
        }
        throw err;
      }

      return reply.status(201).send({
        id: group.id,
        name: group.name,
        teamId: group.teamId,
      });
    },
  );

  // ── List Groups ──────────────────────────────────────────────
  server.get(
    '/teams/:id/groups',
    {
      schema: {
        operationId: 'listGroups',
        tags: ['groups'],
        description: 'List groups within a team. Requires team access.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Object({ items: Type.Array(GroupResponseSchema) }),
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

      const groups = await fastify.groupRepository.listByTeamId(id);

      return {
        items: groups.map((g) => ({
          id: g.id,
          name: g.name,
          teamId: g.teamId,
        })),
      };
    },
  );

  // ── Get Group Detail ─────────────────────────────────────────
  server.get(
    '/groups/:groupId',
    {
      schema: {
        operationId: 'getGroup',
        tags: ['groups'],
        description: 'Get group details. Requires team access.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: GroupParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: GroupDetailSchema,
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { groupId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const group = await fastify.groupRepository.findById(groupId);
      if (!group) throw createProblem('not-found');

      const canAccess = await fastify.permissionChecker.canAccessTeam(
        group.teamId,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');

      const members =
        await fastify.relationshipReader.listGroupMembers(groupId);

      return {
        id: group.id,
        name: group.name,
        teamId: group.teamId,
        createdBy: group.createdBy,
        createdAt: group.createdAt,
        members: members.map((m) => ({
          subjectId: m.subjectId,
          subjectNs: m.subjectNs,
        })),
      };
    },
  );

  // ── Delete Group ─────────────────────────────────────────────
  server.delete(
    '/groups/:groupId',
    {
      schema: {
        operationId: 'deleteGroup',
        tags: ['groups'],
        description: 'Delete a group. Requires manage_members permission.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: GroupParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: DeletedResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { groupId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const group = await fastify.groupRepository.findById(groupId);
      if (!group) throw createProblem('not-found');

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          group.teamId,
          identityId,
          subjectNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      // Delete DB row first. If this fails, Keto tuples remain consistent.
      await fastify.groupRepository.delete(groupId);

      // Best-effort Keto cleanup — orphan tuples are harmless
      try {
        await fastify.relationshipWriter.removeGroupRelations(groupId);
      } catch (err) {
        request.log.warn({ groupId, err }, 'group.delete_keto_cleanup_failed');
      }

      return reply.status(200).send({ deleted: true });
    },
  );

  // ── Add Member ───────────────────────────────────────────────
  server.post(
    '/groups/:groupId/members',
    {
      schema: {
        operationId: 'addGroupMember',
        tags: ['groups'],
        description:
          'Add a member to a group. Requires manage_members permission.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: GroupParamsSchema,
        body: AddGroupMemberSchema,
        response: {
          201: GroupMemberResponseSchema,
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { groupId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const group = await fastify.groupRepository.findById(groupId);
      if (!group) throw createProblem('not-found');

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          group.teamId,
          identityId,
          callerNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      const { subjectId, subjectNs: bodySubjectNs } = request.body;
      const memberNs: string = bodySubjectNs ?? KetoNamespace.Agent;

      // Validate subject is a team member with matching namespace
      const teamMembers = await fastify.relationshipReader.listTeamMembers(
        group.teamId,
      );
      const isMember = teamMembers.some(
        (m) => m.subjectId === subjectId && m.subjectNs === memberNs,
      );
      if (!isMember) {
        throw createProblem('not-found', 'Subject is not a member of the team');
      }

      const memberKetoNs =
        memberNs === 'Human' ? KetoNamespace.Human : KetoNamespace.Agent;

      await fastify.relationshipWriter.grantGroupMember(
        groupId,
        subjectId,
        memberKetoNs,
      );

      return reply.status(201).send({
        subjectId,
        subjectNs: memberNs,
      });
    },
  );

  // ── List Members ─────────────────────────────────────────────
  server.get(
    '/groups/:groupId/members',
    {
      schema: {
        operationId: 'listGroupMembers',
        tags: ['groups'],
        description: 'List group members. Requires team access.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: GroupParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Object({ items: Type.Array(GroupMemberResponseSchema) }),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { groupId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const group = await fastify.groupRepository.findById(groupId);
      if (!group) throw createProblem('not-found');

      const canAccess = await fastify.permissionChecker.canAccessTeam(
        group.teamId,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');

      const members =
        await fastify.relationshipReader.listGroupMembers(groupId);

      return {
        items: members.map((m) => ({
          subjectId: m.subjectId,
          subjectNs: m.subjectNs,
        })),
      };
    },
  );

  // ── Remove Member ────────────────────────────────────────────
  server.delete(
    '/groups/:groupId/members/:subjectId',
    {
      schema: {
        operationId: 'removeGroupMember',
        tags: ['groups'],
        description:
          'Remove a member from a group. Requires manage_members permission.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: GroupMemberParamsSchema,
        response: {
          200: RemovedResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { groupId, subjectId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const group = await fastify.groupRepository.findById(groupId);
      if (!group) throw createProblem('not-found');

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(
          group.teamId,
          identityId,
          subjectNs,
        );
      if (!canManageMembers) throw createProblem('forbidden');

      // Remove from both Agent and Human namespaces (same pattern as team member removal)
      await fastify.relationshipWriter.removeGroupMember(
        groupId,
        subjectId,
        KetoNamespace.Agent,
      );
      await fastify.relationshipWriter.removeGroupMember(
        groupId,
        subjectId,
        KetoNamespace.Human,
      );

      return reply.status(200).send({ removed: true });
    },
  );
}
