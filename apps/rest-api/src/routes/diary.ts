/**
 * Diary container CRUD and sharing routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, TEAM_HEADER } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  CreateDiaryGrantSchema,
  DiaryGrantListResponseSchema,
  DiaryGrantResponseSchema,
  DiaryParamsSchema,
  ProblemDetailsSchema,
  RevokeDiaryGrantSchema,
  RevokedResponseSchema,
  TeamHeaderOptionalSchema,
  TeamHeaderRequiredSchema,
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
