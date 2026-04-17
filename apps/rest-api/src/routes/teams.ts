/**
 * Team Management Routes
 *
 * CRUD for teams, invite codes, and join flow.
 * Membership is stored in Keto — routes write Keto tuples on member changes.
 * Mutating operations use transaction + compensation for DB/Keto consistency.
 */

import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, TeamRelation } from '@moltnet/auth';
import { DBOS } from '@moltnet/database';
import {
  AcceptFoundingResponseSchema,
  AcceptFoundingSchema,
  CreateTeamInviteSchema,
  CreateTeamWithFoundingSchema,
  DeletedResponseSchema,
  JoinTeamResponseSchema,
  JoinTeamSchema,
  ProblemDetailsSchema,
  RemovedResponseSchema,
  TeamDetailSchema,
  TeamFoundingResponseSchema,
  TeamInviteParamsSchema,
  TeamInviteResponseSchema,
  TeamListItemSchema,
  TeamMemberParamsSchema,
  TeamMemberSchema,
  TeamParamsSchema,
  TeamResponseSchema,
} from '@moltnet/models';
import type { IdentityApi } from '@ory/client-fetch';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  FOUNDING_ACCEPT_EVENT,
  teamFoundingWorkflow,
} from '../workflows/team-founding-workflow.js';

// ── Member enrichment ───────────────────────────────────────────

interface KetoMember {
  subjectId: string;
  subjectNs: string;
  relation: string;
}

interface EnrichedMember {
  subjectId: string;
  subjectType: 'agent' | 'human';
  role: string;
  displayName: string;
  fingerprint?: string;
  email?: string;
}

async function resolveMembers(
  identityApi: IdentityApi,
  members: KetoMember[],
  log: FastifyInstance['log'],
): Promise<EnrichedMember[]> {
  if (members.length === 0) return [];

  const subjectIds = members.map((m) => m.subjectId);

  const identityMap = new Map<
    string,
    {
      schemaId: string;
      traits: Record<string, unknown>;
      metadataPublic: Record<string, unknown> | null;
    }
  >();

  try {
    const identities = await identityApi.listIdentities({ ids: subjectIds });
    for (const identity of identities) {
      identityMap.set(identity.id, {
        schemaId: identity.schema_id,
        traits: (identity.traits as Record<string, unknown>) ?? {},
        metadataPublic:
          (identity.metadata_public as Record<string, unknown>) ?? null,
      });
    }
  } catch (err) {
    log.warn({ err, subjectIds }, 'team.resolve_members_kratos_failed');
  }

  return members.map((m) => {
    const identity = identityMap.get(m.subjectId);
    const subjectType = m.subjectNs === 'Human' ? 'human' : 'agent';

    if (!identity) {
      return {
        subjectId: m.subjectId,
        subjectType,
        role: m.relation,
        displayName: m.subjectId.slice(0, 8),
      };
    }

    if (subjectType === 'human') {
      const username = identity.traits.username as string | undefined;
      const email = identity.traits.email as string | undefined;
      return {
        subjectId: m.subjectId,
        subjectType,
        role: m.relation,
        displayName: username ?? m.subjectId.slice(0, 8),
        email,
      };
    }

    const fingerprint =
      (identity.metadataPublic?.fingerprint as string | undefined) ?? undefined;
    return {
      subjectId: m.subjectId,
      subjectType,
      role: m.relation,
      displayName: fingerprint ?? m.subjectId.slice(0, 8),
      fingerprint,
    };
  });
}

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
        description:
          'Create a new project team. Caller becomes owner. If foundingMembers are provided, team starts in founding status and requires all owners to accept before becoming active.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: CreateTeamWithFoundingSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          201: TeamResponseSchema,
          202: TeamFoundingResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const { name, foundingMembers } = request.body;

      if (!foundingMembers || foundingMembers.length === 0) {
        // Instant active team — original behavior
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
      }

      // Founding flow — team starts in 'founding' status
      const team = await fastify.transactionRunner.runInTransaction(
        async () => {
          return fastify.teamRepository.create({
            name,
            personal: false,
            createdBy: identityId,
            status: 'founding',
          });
        },
      );

      // Creator is always an owner and must also accept — prepend them so the
      // workflow seeds their acceptance row and grants their Keto tuple.
      const creatorNs = subjectNs === KetoNamespace.Human ? 'Human' : 'Agent';
      const allFoundingMembers: typeof foundingMembers = [
        { subjectId: identityId, subjectNs: creatorNs, role: 'owner' },
        ...foundingMembers.filter((m) => m.subjectId !== identityId),
      ];

      // Start workflow non-blocking — it grants Keto roles + seeds acceptance rows.
      // On startup failure, delete the orphaned team row so the caller can retry.
      let workflowId: string;
      try {
        const workflowHandle = await DBOS.startWorkflow(
          teamFoundingWorkflow.foundTeam,
          { workflowID: `founding-${team.id}` },
        )(team.id, identityId, creatorNs, allFoundingMembers);
        workflowId = workflowHandle.workflowID;
      } catch (err) {
        request.log.error(
          { teamId: team.id, err },
          'team.founding.workflow_start_failed — deleting orphaned team',
        );
        try {
          await fastify.teamRepository.delete(team.id);
        } catch (deleteErr) {
          request.log.error(
            { teamId: team.id, deleteErr },
            'team.founding.compensation_delete_failed',
          );
        }
        throw err;
      }

      return reply
        .status(202)
        .send({ id: team.id, name: team.name, status: 'founding', workflowId });
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        response: {
          400: Type.Ref(ProblemDetailsSchema),
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
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
      const enrichedMembers = await resolveMembers(
        fastify.identityApi,
        members,
        request.log,
      );

      return {
        ...team,
        members: enrichedMembers,
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
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
      const enrichedMembers = await resolveMembers(
        fastify.identityApi,
        members,
        request.log,
      );

      return { items: enrichedMembers };
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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

      return reply.status(201).send({
        id: invite.id,
        code: invite.code,
        role: invite.role ?? 'member',
        maxUses: invite.maxUses,
        useCount: invite.useCount ?? 0,
        expiresAt: invite.expiresAt,
        createdAt: invite.createdAt,
      });
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
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
      return {
        items: invites.map((inv) => ({
          id: inv.id,
          code: inv.code,
          role: inv.role,
          maxUses: inv.maxUses,
          useCount: inv.useCount,
          expiresAt: inv.expiresAt,
          createdAt: inv.createdAt,
        })),
      };
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamInviteParamsSchema,
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
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

  // ── Accept Team Founding ─────────────────────────────────────
  server.post(
    '/teams/:id/accept',
    {
      schema: {
        operationId: 'acceptTeamFounding',
        tags: ['teams'],
        description:
          'Accept a founding role in a team. Only valid while team is in founding status.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        body: AcceptFoundingSchema,
        response: {
          200: AcceptFoundingResponseSchema,
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
      const { identityId } = request.authContext!;

      const team = await fastify.teamRepository.findById(id);
      if (!team) throw createProblem('not-found');

      // Always check membership first — prevents existence oracle for non-members
      const acceptances =
        await fastify.teamRepository.listFoundingAcceptances(id);
      const myAcceptance = acceptances.find((a) => a.subjectId === identityId);
      if (!myAcceptance) throw createProblem('not-found');

      // Already accepted (regardless of team status)
      if (myAcceptance.status === 'accepted')
        throw createProblem('founding-already-accepted');

      // Team must still be in founding status
      if (team.status !== 'founding') throw createProblem('team-not-founding');

      // Record acceptance
      await fastify.teamRepository.acceptFoundingMember(id, identityId);

      // Check if all owners have accepted — send event if so
      const updated = await fastify.teamRepository.listFoundingAcceptances(id);
      const owners = updated.filter((a) => a.role === 'owner');
      const allOwnersAccepted =
        owners.length > 0 && owners.every((a) => a.status === 'accepted');

      if (allOwnersAccepted) {
        // Send signal to workflow — it will activate the team.
        // Race note: two concurrent "last acceptance" requests can both reach
        // this point (only one DB row is updated due to WHERE status='pending',
        // but both see all owners accepted on the subsequent list). DBOS handles
        // duplicate sends idempotently — the workflow's recv() consumes the first
        // event and ignores subsequent ones for the same workflowId.
        // Guard against DBOS send failure: acceptFoundingMember is already
        // committed, so log the error but still return 200 — the workflow
        // will re-check on its next retry cycle.
        try {
          await DBOS.send(`founding-${id}`, true, FOUNDING_ACCEPT_EVENT);
        } catch (err) {
          request.log.error(
            { teamId: id, err },
            'team.founding.send_accept_event_failed — team may not activate until timeout',
          );
        }
      }

      // Return the requested state — team activation is async (workflow-driven)
      // so callers should poll GET /teams/:id until teamStatus === 'active'.
      return reply.status(200).send({
        accepted: true,
        teamStatus: allOwnersAccepted ? 'active' : 'founding',
      });
    },
  );
}
