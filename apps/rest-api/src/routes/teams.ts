/**
 * Team Management Routes
 *
 * CRUD for teams, invite codes, and join flow.
 * Membership is stored in Keto — routes write Keto tuples on member changes.
 */

import { Type, type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';

// ── Schemas ────────────────────────────────────────────────────

const TeamParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const CreateTeamSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 255 }),
});

const CreateInviteSchema = Type.Object({
  role: Type.Optional(
    Type.Union([Type.Literal('manager'), Type.Literal('member')]),
  ),
  maxUses: Type.Optional(Type.Integer({ minimum: 1, default: 1 })),
  expiresInHours: Type.Optional(
    Type.Integer({ minimum: 1, maximum: 720, default: 168 }),
  ),
});

const JoinTeamSchema = Type.Object({
  code: Type.String({ minLength: 1 }),
});

const AddMemberSchema = Type.Object({
  subjectId: Type.String({ format: 'uuid' }),
  subjectNs: Type.Union([Type.Literal('Agent'), Type.Literal('Human')]),
  role: Type.Union([Type.Literal('manager'), Type.Literal('member')]),
});

const MemberParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  subjectId: Type.String({ format: 'uuid' }),
});

const InviteParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  inviteId: Type.String({ format: 'uuid' }),
});

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
          201: Type.Object({ id: Type.String(), name: Type.String() }),
        },
      },
    },
    async (request, reply) => {
      const { identityId } = request.authContext!;
      const { name } = request.body;

      const team = await fastify.teamRepository.create({
        name,
        personal: false,
        createdBy: identityId,
        status: 'active',
      });

      await fastify.relationshipWriter.grantTeamOwner(
        team.id,
        identityId,
        KetoNamespace.Agent,
      );

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
            items: Type.Array(
              Type.Object({
                id: Type.String(),
                name: Type.String(),
                personal: Type.Boolean(),
                status: Type.String(),
                role: Type.String(),
              }),
            ),
          }),
        },
      },
    },
    async (request) => {
      const { identityId } = request.authContext!;
      const teamIds =
        await fastify.relationshipReader.listTeamIdsBySubject(identityId);

      const items = await Promise.all(
        teamIds.map(async (teamId) => {
          const team = await fastify.teamRepository.findById(teamId);
          if (!team) return null;
          // Determine caller's role from Keto
          const members =
            await fastify.relationshipReader.listTeamMembers(teamId);
          const self = members.find((m) => m.subjectId === identityId);
          return {
            id: team.id,
            name: team.name,
            personal: team.personal,
            status: team.status,
            role: self?.relation ?? 'member',
          };
        }),
      );

      return {
        items: items.filter(
          (item): item is NonNullable<typeof item> => item !== null,
        ),
      };
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
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId } = request.authContext!;

      const canAccess = await fastify.permissionChecker.canAccessTeam(
        id,
        identityId,
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
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { identityId } = request.authContext!;

      const canManage = await fastify.permissionChecker.canManageTeam(
        id,
        identityId,
      );
      if (!canManage) throw createProblem('forbidden');

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      if (team.personal) {
        throw createProblem(
          'validation-failed',
          'Cannot delete a personal team',
        );
      }

      await fastify.teamRepository.delete(id);
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
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId } = request.authContext!;

      const canAccess = await fastify.permissionChecker.canAccessTeam(
        id,
        identityId,
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

  // ── Add Member (direct) ──────────────────────────────────────
  server.post(
    '/teams/:id/members',
    {
      schema: {
        operationId: 'addTeamMember',
        tags: ['teams'],
        description:
          'Add a member directly. Requires manage_members permission.',
        security: [{ bearerAuth: [] }],
        params: TeamParamsSchema,
        body: AddMemberSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { identityId } = request.authContext!;
      const { subjectId, subjectNs, role } = request.body;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(id, identityId);
      if (!canManageMembers) throw createProblem('forbidden');

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      if (team.personal) {
        throw createProblem(
          'validation-failed',
          'Cannot add members to a personal team',
        );
      }

      const ns =
        subjectNs === 'Agent' ? KetoNamespace.Agent : KetoNamespace.Human;
      if (role === 'manager') {
        await fastify.relationshipWriter.grantTeamManager(id, subjectId, ns);
      } else {
        await fastify.relationshipWriter.grantTeamMember(id, subjectId, ns);
      }

      return reply.status(201).send({ teamId: id, subjectId, role });
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
        params: MemberParamsSchema,
      },
    },
    async (request, reply) => {
      const { id, subjectId } = request.params;
      const { identityId } = request.authContext!;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(id, identityId);
      if (!canManageMembers) throw createProblem('forbidden');

      // Prevent removing the last owner
      const members = await fastify.relationshipReader.listTeamMembers(id);
      const owners = members.filter((m) => m.relation === 'owner');
      const isRemovingOwner = owners.some((o) => o.subjectId === subjectId);
      if (isRemovingOwner && owners.length <= 1) {
        throw createProblem(
          'validation-failed',
          'Cannot remove the last owner',
        );
      }

      // Remove all role tuples for this subject (we don't know their namespace)
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
        body: CreateInviteSchema,
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { identityId } = request.authContext!;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(id, identityId);
      if (!canManageMembers) throw createProblem('forbidden');

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      if (team.personal) {
        throw createProblem(
          'validation-failed',
          'Cannot create invites for a personal team',
        );
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
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId } = request.authContext!;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(id, identityId);
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
        params: InviteParamsSchema,
      },
    },
    async (request, reply) => {
      const { id, inviteId } = request.params;
      const { identityId } = request.authContext!;

      const canManageMembers =
        await fastify.permissionChecker.canManageTeamMembers(id, identityId);
      if (!canManageMembers) throw createProblem('forbidden');

      await fastify.teamRepository.deleteInvite(inviteId);
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
        throw createProblem('validation-failed', 'Invite code has expired');
      }

      if (invite.useCount >= invite.maxUses) {
        throw createProblem(
          'validation-failed',
          'Invite code has been fully used',
        );
      }

      const team = await fastify.teamRepository.findById(invite.teamId);
      if (!team || team.personal) {
        throw createProblem('not-found', 'Invalid invite code');
      }

      if (team.status !== 'active') {
        throw createProblem('validation-failed', 'Team is not active');
      }

      // Check if already a member
      const existingMembers = await fastify.relationshipReader.listTeamMembers(
        invite.teamId,
      );
      if (existingMembers.some((m) => m.subjectId === identityId)) {
        throw createProblem('conflict', 'Already a member of this team');
      }

      // Grant membership in Keto
      const ns = KetoNamespace.Agent; // TODO: detect from auth context subject_type
      if (invite.role === 'manager') {
        await fastify.relationshipWriter.grantTeamManager(
          invite.teamId,
          identityId,
          ns,
        );
      } else {
        await fastify.relationshipWriter.grantTeamMember(
          invite.teamId,
          identityId,
          ns,
        );
      }

      await fastify.teamRepository.incrementInviteUseCount(invite.id);

      return reply.status(200).send({
        teamId: invite.teamId,
        role: invite.role,
      });
    },
  );
}
