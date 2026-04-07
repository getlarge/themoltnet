/**
 * Diary container CRUD and sharing routes
 */

import { randomUUID } from 'node:crypto';

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, TEAM_HEADER } from '@moltnet/auth';
import { DBOS } from '@moltnet/database';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  CreateDiaryGrantSchema,
  DiaryGrantListResponseSchema,
  DiaryGrantResponseSchema,
  DiaryParamsSchema,
  InitiateTransferSchema,
  ProblemDetailsSchema,
  RevokeDiaryGrantSchema,
  RevokedResponseSchema,
  TeamHeaderOptionalSchema,
  TeamHeaderRequiredSchema,
  TransferListResponseSchema,
  TransferParamsSchema,
  TransferResponseSchema,
  visibilityLiterals,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  DiaryCatalogListSchema,
  DiaryCatalogSchema,
  SuccessSchema,
} from '../schemas.js';
import {
  diaryTransferWorkflow,
  TRANSFER_DECISION_EVENT,
} from '../workflows/diary-transfer-workflow.js';

function translateServiceError(err: DiaryServiceError): never {
  switch (err.code) {
    case 'not_found':
      throw createProblem('not-found', err.message);
    case 'forbidden':
      throw createProblem('forbidden', err.message);
    case 'validation_failed':
    case 'wrong_status':
      throw createProblem('validation-failed', err.message);
    case 'immutable':
      throw createProblem('conflict', err.message);
    default:
      throw createProblem('internal', err.message);
  }
}

export async function diaryRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // All diary routes require authentication
  server.addHook('preHandler', requireAuth);

  // ── Create Diary ────────────────────────────────────────────
  server.post(
    '/diaries',
    {
      schema: {
        operationId: 'createDiary',
        tags: ['diary'],
        description: 'Create a new diary.',
        security: [{ bearerAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 255 }),
          visibility: Type.Optional(Type.Union(visibilityLiterals)),
        }),
        response: {
          201: Type.Ref(DiaryCatalogSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const { name, visibility } = request.body;

      const teamId = request.authContext!.currentTeamId;
      if (!teamId) {
        throw createProblem(
          'validation-failed',
          `${TEAM_HEADER} header is required — all diaries must be team-scoped`,
        );
      }

      // Diary creation requires Team.write (owners/managers), not just Team.access
      const canWrite = await fastify.permissionChecker.canWriteTeam(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canWrite) {
        throw createProblem(
          'forbidden',
          'Only team owners and managers can create diaries',
        );
      }

      const diary = await fastify.diaryService.createDiary({
        createdBy: identityId,
        name,
        visibility,
        teamId,
        subjectNs,
      });

      return reply.status(201).send(diary);
    },
  );

  // ── List Diaries ────────────────────────────────────────────
  server.get(
    '/diaries',
    {
      schema: {
        operationId: 'listDiaries',
        tags: ['diary'],
        description: "List the authenticated agent's diaries.",
        security: [{ bearerAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        response: {
          200: Type.Ref(DiaryCatalogListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const items = await fastify.diaryService.listDiaries(
        request.authContext!.identityId,
      );
      return { items };
    },
  );

  // ── Get Diary ───────────────────────────────────────────────
  server.get(
    '/diaries/:id',
    {
      schema: {
        operationId: 'getDiary',
        tags: ['diary'],
        description: 'Get a diary by ID.',
        security: [{ bearerAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        params: DiaryParamsSchema,
        response: {
          200: Type.Ref(DiaryCatalogSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      try {
        const diary = await fastify.diaryService.findDiary(
          id,
          identityId,
          subjectNs,
        );
        return diary;
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Update Diary ────────────────────────────────────────────
  server.patch(
    '/diaries/:id',
    {
      schema: {
        operationId: 'updateDiary',
        tags: ['diary'],
        description: 'Update diary name or visibility.',
        security: [{ bearerAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        params: DiaryParamsSchema,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
          visibility: Type.Optional(Type.Union(visibilityLiterals)),
        }),
        response: {
          200: Type.Ref(DiaryCatalogSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      try {
        const diary = await fastify.diaryService.updateDiary(
          id,
          identityId,
          subjectNs,
          request.body,
        );

        if (!diary) {
          throw createProblem('not-found', 'Diary not found');
        }

        return diary;
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Delete Diary ────────────────────────────────────────────
  server.delete(
    '/diaries/:id',
    {
      schema: {
        operationId: 'deleteDiary',
        tags: ['diary'],
        description: 'Delete a diary and cascade-delete its entries.',
        security: [{ bearerAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        params: DiaryParamsSchema,
        response: {
          200: Type.Ref(SuccessSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      try {
        const deleted = await fastify.diaryService.deleteDiary(
          id,
          identityId,
          subjectNs,
        );

        if (!deleted) {
          throw createProblem('not-found', 'Diary not found');
        }

        return { success: true };
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Grant Writer/Manager ─────────────────────────────────────
  server.post(
    '/diaries/:id/grants',
    {
      schema: {
        operationId: 'createDiaryGrant',
        tags: ['diary'],
        description:
          'Grant writer or manager access to a diary for an agent, human, or group.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: CreateDiaryGrantSchema,
        response: {
          201: DiaryGrantResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManage = await fastify.permissionChecker.canManageDiary(
        id,
        identityId,
        callerNs,
      );
      if (!canManage) {
        throw createProblem(
          'forbidden',
          'Only diary managers can grant access',
        );
      }

      const { subjectId, subjectNs, role } = request.body;
      const ketoNs = mapSubjectNs(subjectNs);

      if (role === 'writer') {
        await fastify.relationshipWriter.grantDiaryWriters(
          id,
          subjectId,
          ketoNs,
        );
      } else {
        await fastify.relationshipWriter.grantDiaryManagers(
          id,
          subjectId,
          ketoNs,
        );
      }

      return reply.status(201).send({ subjectId, subjectNs, role });
    },
  );

  // ── List Grants ────────────────────────────────────────────────
  server.get(
    '/diaries/:id/grants',
    {
      schema: {
        operationId: 'listDiaryGrants',
        tags: ['diary'],
        description: 'List all per-diary grants (writers and managers).',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        response: {
          200: DiaryGrantListResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canRead = await fastify.permissionChecker.canReadDiary(
        id,
        identityId,
        callerNs,
      );
      if (!canRead) {
        throw createProblem('forbidden', 'No read access to this diary');
      }

      const tuples = await fastify.relationshipReader.listDiaryGrants(id);
      return {
        grants: tuples.map((t) => ({
          subjectId: t.subjectId,
          subjectNs: t.subjectNs as 'Agent' | 'Human' | 'Group',
          role: t.role,
        })),
      };
    },
  );

  // ── Revoke Grant ───────────────────────────────────────────────
  server.delete(
    '/diaries/:id/grants',
    {
      schema: {
        operationId: 'revokeDiaryGrant',
        tags: ['diary'],
        description: 'Revoke a writer or manager grant from a diary.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: RevokeDiaryGrantSchema,
        response: {
          200: RevokedResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const callerNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const canManage = await fastify.permissionChecker.canManageDiary(
        id,
        identityId,
        callerNs,
      );
      if (!canManage) {
        throw createProblem(
          'forbidden',
          'Only diary managers can revoke access',
        );
      }

      const { subjectId, subjectNs, role } = request.body;
      const ketoNs = mapSubjectNs(subjectNs);

      if (role === 'writer') {
        await fastify.relationshipWriter.revokeDiaryWriter(
          id,
          subjectId,
          ketoNs,
        );
      } else {
        await fastify.relationshipWriter.revokeDiaryManager(
          id,
          subjectId,
          ketoNs,
        );
      }

      return { revoked: true };
    },
  );

  // ── Initiate Diary Transfer ─────────────────────────────────
  server.post(
    '/diaries/:id/transfer',
    {
      schema: {
        operationId: 'initiateTransfer',
        tags: ['diary'],
        description:
          'Initiate a diary transfer to another team. Requires diary manage permission.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: InitiateTransferSchema,
        response: {
          202: TransferResponseSchema,
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

      // Must have diary manage permission
      const canManage = await fastify.permissionChecker.canManageDiary(
        id,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');

      // Load diary to get teamId
      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(id, identityId, subjectNs);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }

      // Also require manage permission on the source team
      const canManageSourceTeam = await fastify.permissionChecker.canManageTeam(
        diary.teamId,
        identityId,
        subjectNs,
      );
      if (!canManageSourceTeam) throw createProblem('forbidden');

      const { destinationTeamId } = request.body;

      // Check no pending transfer exists
      const existing =
        await fastify.diaryTransferRepository.findPendingByDiary(id);
      if (existing) throw createProblem('diary-transfer-pending');

      // Destination team must be active and not personal
      const destTeam = await fastify.teamRepository.findById(destinationTeamId);
      if (!destTeam || destTeam.status !== 'active')
        throw createProblem('not-found');
      if (destTeam.personal) throw createProblem('team-personal-immutable');

      const expiresAt = new Date(Date.now() + 7 * 24 * 3600 * 1000);
      const workflowId = `transfer-${randomUUID()}`;

      // Create transfer record
      const transfer = await fastify.diaryTransferRepository.create({
        diaryId: id,
        sourceTeamId: diary.teamId,
        destinationTeamId,
        workflowId,
        initiatedBy: identityId,
        expiresAt,
      });

      // Start workflow (non-blocking).
      // On startup failure, expire the transfer so the caller can retry.
      try {
        await DBOS.startWorkflow(diaryTransferWorkflow.transferDiary, {
          workflowID: workflowId,
        })(transfer.id, id, diary.teamId, destinationTeamId);
      } catch (err) {
        request.log.error(
          { transferId: transfer.id, diaryId: id, err },
          'diary.transfer.workflow_start_failed — expiring transfer',
        );
        try {
          await fastify.diaryTransferRepository.updateStatus(
            transfer.id,
            'expired',
          );
        } catch (updateErr) {
          request.log.error(
            { transferId: transfer.id, updateErr },
            'diary.transfer.compensation_expire_failed',
          );
        }
        throw err;
      }

      return reply.status(202).send(transfer);
    },
  );

  // ── List Pending Transfers ──────────────────────────────────
  server.get(
    '/transfers',
    {
      schema: {
        operationId: 'listPendingTransfers',
        tags: ['diary'],
        description:
          'List pending transfers where the caller is destination team owner.',
        security: [{ bearerAuth: [] }],
        response: {
          200: TransferListResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { identityId } = request.authContext!;

      // Find teams where caller is owner
      const teamRoles =
        await fastify.relationshipReader.listTeamIdsAndRolesBySubject(
          identityId,
        );
      const ownedTeamIds = teamRoles
        .filter((r) => r.relation === 'owners')
        .map((r) => r.teamId);

      if (ownedTeamIds.length === 0) return { items: [] };

      // Fetch pending transfers for each owned team (parallel)
      const results = await Promise.all(
        ownedTeamIds.map((teamId) =>
          fastify.diaryTransferRepository.listPendingByDestinationTeam(teamId),
        ),
      );

      return { items: results.flat() };
    },
  );

  // ── Accept Transfer ─────────────────────────────────────────
  server.post(
    '/transfers/:transferId/accept',
    {
      schema: {
        operationId: 'acceptTransfer',
        tags: ['diary'],
        description:
          'Accept a pending diary transfer. Caller must be destination team owner.',
        security: [{ bearerAuth: [] }],
        params: TransferParamsSchema,
        response: {
          200: TransferResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { transferId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const transfer =
        await fastify.diaryTransferRepository.findById(transferId);
      if (!transfer) throw createProblem('diary-transfer-not-found');
      if (transfer.status !== 'pending')
        throw createProblem('diary-transfer-already-resolved');

      // Must be owner of destination team
      const canManage = await fastify.permissionChecker.canManageTeam(
        transfer.destinationTeamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');

      // Send decision to workflow — the workflow is the sole owner of status
      // transitions, so we do NOT call updateStatus here (avoids double-write race).
      try {
        await DBOS.send(
          transfer.workflowId,
          'accepted',
          TRANSFER_DECISION_EVENT,
        );
      } catch (err) {
        request.log.error(
          { transferId, workflowId: transfer.workflowId, err },
          'diary.transfer.send_accept_event_failed',
        );
        throw err;
      }
      // Return synthetic status — the workflow owns the actual DB transition
      // asynchronously. Callers should poll GET /diaries/:id to confirm teamId swap.
      return reply
        .status(200)
        .send({ ...transfer, status: 'accepted' as const });
    },
  );

  // ── Reject Transfer ─────────────────────────────────────────
  server.post(
    '/transfers/:transferId/reject',
    {
      schema: {
        operationId: 'rejectTransfer',
        tags: ['diary'],
        description: 'Reject a pending diary transfer.',
        security: [{ bearerAuth: [] }],
        params: TransferParamsSchema,
        response: {
          200: TransferResponseSchema,
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { transferId } = request.params;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      const transfer =
        await fastify.diaryTransferRepository.findById(transferId);
      if (!transfer) throw createProblem('diary-transfer-not-found');
      if (transfer.status !== 'pending')
        throw createProblem('diary-transfer-already-resolved');

      const canManage = await fastify.permissionChecker.canManageTeam(
        transfer.destinationTeamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');

      try {
        await DBOS.send(
          transfer.workflowId,
          'rejected',
          TRANSFER_DECISION_EVENT,
        );
      } catch (err) {
        request.log.error(
          { transferId, workflowId: transfer.workflowId, err },
          'diary.transfer.send_reject_event_failed',
        );
        throw err;
      }
      // Return synthetic status — the workflow owns the actual DB transition
      // asynchronously. Diary stays on source team until workflow confirms.
      return reply
        .status(200)
        .send({ ...transfer, status: 'rejected' as const });
    },
  );
}

function mapSubjectNs(ns: 'Agent' | 'Human' | 'Group'): KetoNamespace {
  switch (ns) {
    case 'Agent':
      return KetoNamespace.Agent;
    case 'Human':
      return KetoNamespace.Human;
    case 'Group':
      return KetoNamespace.Group;
  }
}
