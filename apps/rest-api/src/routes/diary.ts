/**
 * Diary CRUD, search, sharing, and reflection routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  DiaryEntryParamsSchema,
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
  DiaryEntrySchema,
  DiaryInvitationListSchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  DiaryShareListSchema,
  DiaryShareSchema,
  DigestSchema,
  MAX_PUBLIC_CONTENT_LENGTH,
  SuccessSchema,
} from '../schemas.js';

function translateServiceError(err: DiaryServiceError): never {
  if (err.code === 'not_found') throw createProblem('not-found', err.message);
  if (err.code === 'self_share' || err.code === 'wrong_status')
    throw createProblem('validation-failed', err.message);
  if (err.code === 'already_shared')
    throw createProblem('conflict', err.message);
  throw createProblem('internal', err.message);
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
      const { name, visibility } = request.body;

      const diary = await fastify.diaryService.createDiary({
        ownerId: request.authContext!.identityId,
        name,
        visibility,
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
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;

      const diary = await fastify.diaryService.updateDiary(
        id,
        request.authContext!.identityId,
        request.body,
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      return diary;
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
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params;

      const deleted = await fastify.diaryService.deleteDiary(
        id,
        request.authContext!.identityId,
      );

      if (!deleted) {
        throw createProblem('not-found', 'Diary not found');
      }

      return { success: true };
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

  // ── Create Entry ───────────────────────────────────────────
  server.post(
    '/diaries/:diaryId/entries',
    {
      schema: {
        operationId: 'createDiaryEntry',
        tags: ['diary'],
        description: 'Create a new diary entry in a specific diary.',
        security: [{ bearerAuth: [] }],
        params: NestedDiaryParamsSchema,
        body: Type.Object({
          content: Type.String({ minLength: 1, maxLength: 100000 }),
          title: Type.Optional(Type.String({ maxLength: 255 })),
          tags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
          entryType: Type.Optional(
            Type.Union([
              Type.Literal('episodic'),
              Type.Literal('semantic'),
              Type.Literal('procedural'),
              Type.Literal('reflection'),
              Type.Literal('identity'),
              Type.Literal('soul'),
            ]),
          ),
        }),
        response: {
          201: Type.Ref(DiaryEntrySchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { diaryId } = request.params;
      const { content, title, tags, importance, entryType } = request.body;

      const diary = await fastify.diaryService.findDiary(
        diaryId,
        request.authContext!.identityId,
        'write',
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      if (
        diary.visibility === 'public' &&
        content.length > MAX_PUBLIC_CONTENT_LENGTH
      ) {
        throw createProblem(
          'validation-failed',
          'Public diary entries are limited to 10,000 characters',
        );
      }

      const entry = await fastify.diaryService.create({
        requesterId: request.authContext!.identityId,
        diaryId: diary.id,
        content,
        title,
        tags,
        importance,
        entryType,
      });

      return reply.status(201).send(entry);
    },
  );

  // ── List Entries ───────────────────────────────────────────
  server.get(
    '/diaries/:diaryId/entries',
    {
      schema: {
        operationId: 'listDiaryEntries',
        tags: ['diary'],
        description: 'List diary entries for a specific diary.',
        security: [{ bearerAuth: [] }],
        params: NestedDiaryParamsSchema,
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          tags: Type.Optional(
            Type.String({
              pattern: '^[^,]{1,50}(,[^,]{1,50}){0,19}$',
              maxLength: 1070,
              description:
                'Comma-separated tags filter (entry must have ALL specified tags, max 20 tags, 50 chars each)',
            }),
          ),
          entryType: Type.Optional(
            Type.Union([
              Type.Literal('episodic'),
              Type.Literal('semantic'),
              Type.Literal('procedural'),
              Type.Literal('reflection'),
              Type.Literal('identity'),
              Type.Literal('soul'),
            ]),
          ),
        }),
        response: {
          200: Type.Ref(DiaryListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId } = request.params;
      const { limit, offset, tags, entryType } = request.query;

      const diary = await fastify.diaryService.findDiary(
        diaryId,
        request.authContext!.identityId,
        'read',
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const tagsFilter = tags
        ? tags.split(',').map((t) => t.trim())
        : undefined;

      const entries = await fastify.diaryService.list({
        diaryId: diary.id,
        tags: tagsFilter,
        limit,
        offset,
        entryType,
      });

      return {
        items: entries,
        total: entries.length,
        limit: limit ?? 20,
        offset: offset ?? 0,
      };
    },
  );

  // ── Get Entry ──────────────────────────────────────────────
  server.get(
    '/diaries/:diaryId/entries/:entryId',
    {
      schema: {
        operationId: 'getDiaryEntry',
        tags: ['diary'],
        description: 'Get a single diary entry by ID.',
        security: [{ bearerAuth: [] }],
        params: DiaryEntryParamsSchema,
        response: {
          200: Type.Ref(DiaryEntrySchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;

      const diary = await fastify.diaryService.findDiary(
        diaryId,
        request.authContext!.identityId,
        'read',
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const entry = await fastify.diaryService.getById(
        entryId,
        request.authContext!.identityId,
      );

      if (!entry || entry.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      return entry;
    },
  );

  // ── Update Entry ───────────────────────────────────────────
  server.patch(
    '/diaries/:diaryId/entries/:entryId',
    {
      schema: {
        operationId: 'updateDiaryEntry',
        tags: ['diary'],
        description: 'Update a diary entry (content, title, visibility, tags).',
        security: [{ bearerAuth: [] }],
        params: DiaryEntryParamsSchema,
        body: Type.Object({
          title: Type.Optional(Type.String({ maxLength: 255 })),
          content: Type.Optional(
            Type.String({ minLength: 1, maxLength: 100000 }),
          ),
          tags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
          entryType: Type.Optional(
            Type.Union([
              Type.Literal('episodic'),
              Type.Literal('semantic'),
              Type.Literal('procedural'),
              Type.Literal('reflection'),
              Type.Literal('identity'),
              Type.Literal('soul'),
            ]),
          ),
          supersededBy: Type.Optional(Type.String({ format: 'uuid' })),
        }),
        response: {
          200: Type.Ref(DiaryEntrySchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;
      const updates = request.body;

      const diary = await fastify.diaryService.findDiary(
        diaryId,
        request.authContext!.identityId,
        'write',
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      if (
        updates.content &&
        updates.content.length > MAX_PUBLIC_CONTENT_LENGTH &&
        diary.visibility === 'public'
      ) {
        throw createProblem(
          'validation-failed',
          'Public diary entries are limited to 10,000 characters',
        );
      }

      const existing = await fastify.diaryService.getById(
        entryId,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const entry = await fastify.diaryService.update(
        entryId,
        request.authContext!.identityId,
        updates,
      );

      if (!entry) {
        throw createProblem('not-found', 'Entry not found');
      }

      return entry;
    },
  );

  // ── Delete Entry ───────────────────────────────────────────
  server.delete(
    '/diaries/:diaryId/entries/:entryId',
    {
      schema: {
        operationId: 'deleteDiaryEntry',
        tags: ['diary'],
        description: 'Delete a diary entry.',
        security: [{ bearerAuth: [] }],
        params: DiaryEntryParamsSchema,
        response: {
          200: Type.Ref(SuccessSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;

      const diary = await fastify.diaryService.findDiary(
        diaryId,
        request.authContext!.identityId,
        'write',
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const existing = await fastify.diaryService.getById(
        entryId,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const deleted = await fastify.diaryService.delete(
        entryId,
        request.authContext!.identityId,
      );

      if (!deleted) {
        throw createProblem('not-found', 'Entry not found');
      }

      return { success: true };
    },
  );

  // ── Search ─────────────────────────────────────────────────
  server.post(
    '/diaries/search',
    {
      config: { rateLimit: fastify.rateLimitConfig?.embedding },
      schema: {
        operationId: 'searchDiary',
        tags: ['diary'],
        description: 'Search diary entries using hybrid search.',
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          diaryId: Type.String({ format: 'uuid' }),
          query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          tags: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 50 }), {
              minItems: 1,
              maxItems: 20,
            }),
          ),
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          wRelevance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          wRecency: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          wImportance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          entryTypes: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal('episodic'),
                Type.Literal('semantic'),
                Type.Literal('procedural'),
                Type.Literal('reflection'),
                Type.Literal('identity'),
                Type.Literal('soul'),
              ]),
              { minItems: 1, maxItems: 6 },
            ),
          ),
          excludeSuperseded: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Ref(DiarySearchResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const {
        diaryId: searchDiaryId,
        query,
        tags,
        limit,
        offset,
        wRelevance,
        wRecency,
        wImportance,
        entryTypes,
        excludeSuperseded,
      } = request.body;

      const searchDiary = await fastify.diaryService.findDiary(
        searchDiaryId,
        request.authContext!.identityId,
        'read',
      );

      if (!searchDiary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const results = await fastify.diaryService.search({
        diaryId: searchDiary.id,
        query,
        tags,
        limit,
        offset,
        wRelevance,
        wRecency,
        wImportance,
        entryTypes,
        excludeSuperseded,
      });

      return {
        results,
        total: results.length,
      };
    },
  );

  // ── Reflect ────────────────────────────────────────────────
  server.get(
    '/diaries/reflect',
    {
      schema: {
        operationId: 'reflectDiary',
        tags: ['diary'],
        description: 'Get a digest of recent diary entries.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          diaryId: Type.String({ format: 'uuid' }),
          days: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
          maxEntries: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
          entryTypes: Type.Optional(
            Type.String({
              pattern:
                '^(episodic|semantic|procedural|reflection|identity|soul)(,(episodic|semantic|procedural|reflection|identity|soul))*$',
              description: 'Comma-separated entry type filter',
            }),
          ),
        }),
        response: {
          200: Type.Ref(DigestSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, days, maxEntries, entryTypes } = request.query;

      const diary = await fastify.diaryService.findDiary(
        diaryId,
        request.authContext!.identityId,
        'read',
      );

      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const entryTypesFilter = entryTypes
        ? (entryTypes.split(',') as (
            | 'episodic'
            | 'semantic'
            | 'procedural'
            | 'reflection'
            | 'identity'
            | 'soul'
          )[])
        : undefined;

      return fastify.diaryService.reflect({
        diaryId: diary.id,
        days,
        maxEntries,
        entryTypes: entryTypesFilter,
      });
    },
  );
}
