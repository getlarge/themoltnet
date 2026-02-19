/**
 * Diary CRUD, search, sharing, and reflection routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  DiaryEntrySchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  DigestSchema,
  MAX_PUBLIC_CONTENT_LENGTH,
  SharedEntriesSchema,
  ShareResultSchema,
  SuccessSchema,
} from '../schemas.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DiaryRefParamsSchema = Type.Object({
  diaryRef: Type.String({ minLength: 1, maxLength: 100 }),
});

const DiaryEntryParamsSchema = Type.Object({
  diaryRef: Type.String({ minLength: 1, maxLength: 100 }),
  id: Type.String({ format: 'uuid' }),
});

export async function diaryRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  async function resolveDiary(diaryRef: string, ownerId: string) {
    if (UUID_RE.test(diaryRef)) {
      const byId = await fastify.diaryCatalogRepository.findOwnedById(
        ownerId,
        diaryRef,
      );
      if (byId) return byId;
    }

    const byKey = await fastify.diaryCatalogRepository.findOwnedByKey(
      ownerId,
      diaryRef,
    );

    if (!byKey) {
      throw createProblem('not-found', 'Diary not found');
    }

    return byKey;
  }

  // All diary routes require authentication
  server.addHook('preHandler', requireAuth);

  // ── Create Entry ───────────────────────────────────────────
  server.post(
    '/diaries/:diaryRef/entries',
    {
      schema: {
        operationId: 'createDiaryEntry',
        tags: ['diary'],
        description: 'Create a new diary entry in a specific diary.',
        security: [{ bearerAuth: [] }],
        params: DiaryRefParamsSchema,
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
      const { diaryRef } = request.params;
      const { content, title, tags, importance, entryType } = request.body;

      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );

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
        ownerId: request.authContext!.identityId,
        diaryId: diary.id,
        diaryVisibility: diary.visibility,
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
    '/diaries/:diaryRef/entries',
    {
      schema: {
        operationId: 'listDiaryEntries',
        tags: ['diary'],
        description: 'List diary entries for a specific diary.',
        security: [{ bearerAuth: [] }],
        params: DiaryRefParamsSchema,
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          visibility: Type.Optional(
            Type.String({
              pattern: '^(private|moltnet|public)(,(private|moltnet|public))*$',
              description: 'Comma-separated visibility filter',
            }),
          ),
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
      const { diaryRef } = request.params;
      const { limit, offset, visibility, tags, entryType } = request.query;
      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );

      const visibilityFilter = visibility
        ? (visibility.split(',') as ('private' | 'moltnet' | 'public')[])
        : undefined;
      const tagsFilter = tags
        ? tags.split(',').map((t) => t.trim())
        : undefined;

      const entries = await fastify.diaryService.list({
        ownerId: request.authContext!.identityId,
        diaryId: diary.id,
        visibility: visibilityFilter,
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
    '/diaries/:diaryRef/entries/:id',
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
      const { diaryRef, id } = request.params;
      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );

      const entry = await fastify.diaryService.getById(
        id,
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
    '/diaries/:diaryRef/entries/:id',
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
          visibility: Type.Optional(
            Type.Union([
              Type.Literal('private'),
              Type.Literal('moltnet'),
              Type.Literal('public'),
            ]),
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
      const { diaryRef, id } = request.params;
      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );
      const updates = request.body;

      if (
        updates.content &&
        updates.content.length > MAX_PUBLIC_CONTENT_LENGTH
      ) {
        const willBePublic =
          updates.visibility === 'public' ||
          (updates.visibility === undefined && diary.visibility === 'public');

        if (willBePublic) {
          throw createProblem(
            'validation-failed',
            'Public diary entries are limited to 10,000 characters',
          );
        }
      }

      const existing = await fastify.diaryService.getById(
        id,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const entry = await fastify.diaryService.update(
        id,
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
    '/diaries/:diaryRef/entries/:id',
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
      const { diaryRef, id } = request.params;
      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );
      const existing = await fastify.diaryService.getById(
        id,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const deleted = await fastify.diaryService.delete(
        id,
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
    '/diary/search',
    {
      config: { rateLimit: fastify.rateLimitConfig?.embedding },
      schema: {
        operationId: 'searchDiary',
        tags: ['diary'],
        description: 'Search diary entries using hybrid search.',
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          visibility: Type.Optional(
            Type.Array(
              Type.Union([
                Type.Literal('private'),
                Type.Literal('moltnet'),
                Type.Literal('public'),
              ]),
            ),
          ),
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
        query,
        visibility,
        tags,
        limit,
        offset,
        wRelevance,
        wRecency,
        wImportance,
        entryTypes,
        excludeSuperseded,
      } = request.body;

      const results = await fastify.diaryService.search({
        ownerId: request.authContext!.identityId,
        query,
        visibility,
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
    '/diary/reflect',
    {
      schema: {
        operationId: 'reflectDiary',
        tags: ['diary'],
        description: 'Get a digest of recent diary entries.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
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
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { days, maxEntries, entryTypes } = request.query;

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
        ownerId: request.authContext!.identityId,
        days,
        maxEntries,
        entryTypes: entryTypesFilter,
      });
    },
  );

  // ── Share Entry ────────────────────────────────────────────
  server.post(
    '/diaries/:diaryRef/entries/:id/share',
    {
      schema: {
        operationId: 'shareDiaryEntry',
        tags: ['diary'],
        description: 'Share a diary entry with another MoltNet agent.',
        security: [{ bearerAuth: [] }],
        params: DiaryEntryParamsSchema,
        body: Type.Object({
          sharedWith: Type.String({
            pattern:
              '^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$',
            description: 'Fingerprint of recipient agent',
          }),
        }),
        response: {
          200: Type.Ref(ShareResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryRef, id } = request.params;
      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );
      const existing = await fastify.diaryService.getById(
        id,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const normalizedFingerprint = request.body.sharedWith.toUpperCase();
      const targetAgent = await fastify.agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!targetAgent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      const shared = await fastify.diaryService.share(
        id,
        request.authContext!.identityId,
        targetAgent.identityId,
      );

      if (!shared) {
        throw createProblem('forbidden', 'Cannot share this entry');
      }

      return { success: true, sharedWith: normalizedFingerprint };
    },
  );

  // ── Shared With Me ─────────────────────────────────────────
  server.get(
    '/diary/shared-with-me',
    {
      schema: {
        operationId: 'getSharedWithMe',
        tags: ['diary'],
        description:
          'List diary entries that other agents have shared with you.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        }),
        response: {
          200: Type.Ref(SharedEntriesSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { limit } = request.query;
      const entries = await fastify.diaryService.getSharedWithMe(
        request.authContext!.identityId,
        limit,
      );

      return { entries };
    },
  );

  // ── Update Visibility ──────────────────────────────────────
  server.patch(
    '/diaries/:diaryRef/entries/:id/visibility',
    {
      schema: {
        operationId: 'setDiaryEntryVisibility',
        tags: ['diary'],
        description: 'Change the visibility of a diary entry.',
        security: [{ bearerAuth: [] }],
        params: DiaryEntryParamsSchema,
        body: Type.Object({
          visibility: Type.Union([
            Type.Literal('private'),
            Type.Literal('moltnet'),
            Type.Literal('public'),
          ]),
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
      const { diaryRef, id } = request.params;
      const diary = await resolveDiary(
        diaryRef,
        request.authContext!.identityId,
      );
      const existing = await fastify.diaryService.getById(
        id,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const { visibility } = request.body;

      const entry = await fastify.diaryService.update(
        id,
        request.authContext!.identityId,
        { visibility },
      );

      if (!entry) {
        throw createProblem('not-found', 'Entry not found');
      }

      return entry;
    },
  );
}
