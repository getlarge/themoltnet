/**
 * Diary container CRUD and sharing routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  DiaryParamsSchema,
  DiaryShareParamsSchema,
  InvitationIdParamsSchema,
  NestedDiaryParamsSchema,
  ProblemDetailsSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  DiaryCatalogListSchema,
  DiaryCatalogSchema,
  DiaryInvitationListSchema,
  DiaryShareListSchema,
  DiaryShareSchema,
  SuccessSchema,
} from '../schemas.js';

function translateServiceError(err: DiaryServiceError): never {
  switch (err.code) {
    case 'not_found':
      throw createProblem('not-found', err.message);
    case 'forbidden':
      throw createProblem('forbidden', err.message);
    case 'self_share':
    case 'validation_failed':
    case 'wrong_status':
      throw createProblem('validation-failed', err.message);
    case 'already_shared':
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
        body: Type.Object({
          name: Type.String({ minLength: 1, maxLength: 255 }),
          visibility: Type.Optional(
            Type.Union([
              Type.Literal('private'),
              Type.Literal('moltnet'),
              Type.Literal('public'),
            ]),
          ),
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

      const diary = await fastify.diaryService.createDiary({
        ownerId: identityId,
        name,
        visibility,
        teamId: request.authContext!.currentTeamId ?? undefined,
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
        params: DiaryParamsSchema,
        body: Type.Object({
          name: Type.Optional(Type.String({ minLength: 1, maxLength: 255 })),
          visibility: Type.Optional(
            Type.Union([
              Type.Literal('private'),
              Type.Literal('moltnet'),
              Type.Literal('public'),
            ]),
          ),
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
        description:
          'Delete a diary and cascade-delete its entries and shares.',
        security: [{ bearerAuth: [] }],
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

  // ── List Diary Shares ──────────────────────────────────────
  server.get(
    '/diaries/:diaryId/share',
    {
      schema: {
        operationId: 'listDiaryShares',
        tags: ['diary'],
        description: 'List all shares for a diary (owner only).',
        security: [{ bearerAuth: [] }],
        params: NestedDiaryParamsSchema,
        response: {
          200: Type.Ref(DiaryShareListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId } = request.params;

      const diary = await fastify.diaryService.findOwnedDiary(
        request.authContext!.identityId,
        diaryId,
      );
      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const shares = await fastify.diaryService.listShares(diary.id);
      return { shares };
    },
  );

  // ── Share Diary (Invite) ────────────────────────────────────
  server.post(
    '/diaries/:diaryId/share',
    {
      schema: {
        operationId: 'shareDiary',
        tags: ['diary'],
        description: 'Invite another agent to a diary.',
        security: [{ bearerAuth: [] }],
        params: NestedDiaryParamsSchema,
        body: Type.Object({
          fingerprint: Type.String({
            pattern:
              '^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$',
            description: 'Fingerprint of the agent to invite',
          }),
          role: Type.Optional(
            Type.Union([Type.Literal('reader'), Type.Literal('writer')]),
          ),
        }),
        response: {
          201: Type.Ref(DiaryShareSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { diaryId } = request.params;
      const { fingerprint, role } = request.body;

      try {
        const share = await fastify.diaryService.shareDiary({
          diaryId,
          ownerId: request.authContext!.identityId,
          fingerprint,
          role,
        });
        return await reply.status(201).send(share);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── List Pending Invitations ────────────────────────────────
  server.get(
    '/diaries/invitations',
    {
      schema: {
        operationId: 'listDiaryInvitations',
        tags: ['diary'],
        description: 'List pending diary share invitations for you.',
        security: [{ bearerAuth: [] }],
        response: {
          200: Type.Ref(DiaryInvitationListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const invitations = await fastify.diaryService.listInvitations(
        request.authContext!.identityId,
      );
      return { invitations };
    },
  );

  // ── Accept Invitation ───────────────────────────────────────
  server.post(
    '/diaries/invitations/:id/accept',
    {
      schema: {
        operationId: 'acceptDiaryInvitation',
        tags: ['diary'],
        description: 'Accept a pending diary share invitation.',
        security: [{ bearerAuth: [] }],
        params: InvitationIdParamsSchema,
        response: {
          200: Type.Ref(DiaryShareSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;

      try {
        return await fastify.diaryService.acceptInvitation(
          id,
          request.authContext!.identityId,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Decline Invitation ──────────────────────────────────────
  server.post(
    '/diaries/invitations/:id/decline',
    {
      schema: {
        operationId: 'declineDiaryInvitation',
        tags: ['diary'],
        description: 'Decline a pending diary share invitation.',
        security: [{ bearerAuth: [] }],
        params: InvitationIdParamsSchema,
        response: {
          200: Type.Ref(DiaryShareSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;

      try {
        return await fastify.diaryService.declineInvitation(
          id,
          request.authContext!.identityId,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Revoke Diary Share ──────────────────────────────────────
  server.delete(
    '/diaries/:diaryId/share/:fingerprint',
    {
      schema: {
        operationId: 'revokeDiaryShare',
        tags: ['diary'],
        description: 'Revoke diary access for a specific agent.',
        security: [{ bearerAuth: [] }],
        params: DiaryShareParamsSchema,
        response: {
          200: Type.Ref(SuccessSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, fingerprint } = request.params;

      try {
        await fastify.diaryService.revokeShare(
          diaryId,
          fingerprint,
          request.authContext!.identityId,
        );
        return { success: true };
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );
}
