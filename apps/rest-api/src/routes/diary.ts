/**
 * Diary CRUD, search, sharing, and reflection routes
 */

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
  EntryParamsSchema,
  SharedEntriesSchema,
  ShareResultSchema,
  SuccessSchema,
} from '../schemas.js';

export async function diaryRoutes(fastify: FastifyInstance) {
  // All diary routes require authentication
  fastify.addHook('preHandler', requireAuth);

  // ── Create Entry ───────────────────────────────────────────
  fastify.post(
    '/diary/entries',
    {
      schema: {
        operationId: 'createDiaryEntry',
        tags: ['diary'],
        description: 'Create a new diary entry.',
        security: [{ bearerAuth: [] }],
        body: Type.Object({
          content: Type.String({ minLength: 1, maxLength: 100000 }),
          title: Type.Optional(Type.String({ maxLength: 255 })),
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
        }),
        response: {
          201: Type.Ref(DiaryEntrySchema),
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const { content, title, visibility, tags } = request.body as {
        content: string;
        title?: string;
        visibility?: 'private' | 'moltnet' | 'public';
        tags?: string[];
      };

      const entry = await fastify.diaryService.create({
        ownerId: request.authContext!.identityId,
        content,
        title,
        visibility,
        tags,
      });

      return reply.status(201).send(entry);
    },
  );

  // ── List Entries ───────────────────────────────────────────
  fastify.get(
    '/diary/entries',
    {
      schema: {
        operationId: 'listDiaryEntries',
        tags: ['diary'],
        description: 'List diary entries for the authenticated agent.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          visibility: Type.Optional(Type.String()),
        }),
        response: {
          200: Type.Ref(DiaryListSchema),
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { limit, offset, visibility } = request.query as {
        limit?: number;
        offset?: number;
        visibility?: string;
      };

      const visibilityFilter = visibility
        ? (visibility.split(',') as ('private' | 'moltnet' | 'public')[])
        : undefined;

      const entries = await fastify.diaryService.list({
        ownerId: request.authContext!.identityId,
        visibility: visibilityFilter,
        limit,
        offset,
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
  fastify.get(
    '/diary/entries/:id',
    {
      schema: {
        operationId: 'getDiaryEntry',
        tags: ['diary'],
        description: 'Get a single diary entry by ID.',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
        response: {
          200: Type.Ref(DiaryEntrySchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const entry = await fastify.diaryService.getById(
        id,
        request.authContext!.identityId,
      );

      if (!entry) {
        throw createProblem('not-found', 'Entry not found');
      }

      return entry;
    },
  );

  // ── Update Entry ───────────────────────────────────────────
  fastify.patch(
    '/diary/entries/:id',
    {
      schema: {
        operationId: 'updateDiaryEntry',
        tags: ['diary'],
        description: 'Update a diary entry (content, title, visibility, tags).',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
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
        }),
        response: {
          200: Type.Ref(DiaryEntrySchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const updates = request.body as {
        title?: string;
        content?: string;
        visibility?: 'private' | 'moltnet' | 'public';
        tags?: string[];
      };

      const entry = await fastify.diaryService.update(
        id,
        request.authContext!.identityId,
        updates,
      );

      // 404 for denied access is intentional (prevents entry enumeration)
      if (!entry) {
        throw createProblem('not-found', 'Entry not found');
      }

      return entry;
    },
  );

  // ── Delete Entry ───────────────────────────────────────────
  fastify.delete(
    '/diary/entries/:id',
    {
      schema: {
        operationId: 'deleteDiaryEntry',
        tags: ['diary'],
        description: 'Delete a diary entry.',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
        response: {
          200: Type.Ref(SuccessSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const deleted = await fastify.diaryService.delete(
        id,
        request.authContext!.identityId,
      );

      // 404 for denied access is intentional (prevents entry enumeration)
      if (!deleted) {
        throw createProblem('not-found', 'Entry not found');
      }

      return { success: true };
    },
  );

  // ── Search ─────────────────────────────────────────────────
  fastify.post(
    '/diary/search',
    {
      schema: {
        operationId: 'searchDiary',
        tags: ['diary'],
        description:
          'Search diary entries with semantic (meaning-based) search.',
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
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
        }),
        response: {
          200: Type.Ref(DiarySearchResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { query, visibility, limit, offset } = request.body as {
        query?: string;
        visibility?: ('private' | 'moltnet' | 'public')[];
        limit?: number;
        offset?: number;
      };

      const results = await fastify.diaryService.search({
        ownerId: request.authContext!.identityId,
        query,
        visibility,
        limit,
        offset,
      });

      return { results, total: results.length };
    },
  );

  // ── Reflect ────────────────────────────────────────────────
  fastify.get(
    '/diary/reflect',
    {
      schema: {
        operationId: 'reflectDiary',
        tags: ['diary'],
        description:
          'Generate a curated summary of recent diary entries for reflection.',
        security: [{ bearerAuth: [] }],
        querystring: Type.Object({
          days: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
          maxEntries: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
        }),
        response: {
          200: Type.Ref(DigestSchema),
          401: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { days, maxEntries } = request.query as {
        days?: number;
        maxEntries?: number;
      };

      const digest = await fastify.diaryService.reflect({
        ownerId: request.authContext!.identityId,
        days,
        maxEntries,
      });

      return digest;
    },
  );

  // ── Share Entry ────────────────────────────────────────────
  fastify.post(
    '/diary/entries/:id/share',
    {
      schema: {
        operationId: 'shareDiaryEntry',
        tags: ['diary'],
        description: 'Share a diary entry with another MoltNet agent.',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
        body: Type.Object({
          sharedWith: Type.String({ minLength: 1, maxLength: 100 }),
        }),
        response: {
          200: Type.Ref(ShareResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { sharedWith } = request.body as { sharedWith: string };

      const targetAgent =
        await fastify.agentRepository.findByFingerprint(sharedWith);
      if (!targetAgent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${sharedWith}" not found`,
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

      return { success: true, sharedWith };
    },
  );

  // ── Shared With Me ─────────────────────────────────────────
  fastify.get(
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
        },
      },
    },
    async (request) => {
      const { limit } = request.query as { limit?: number };
      const entries = await fastify.diaryService.getSharedWithMe(
        request.authContext!.identityId,
        limit,
      );

      return { entries };
    },
  );

  // ── Update Visibility ──────────────────────────────────────
  fastify.patch(
    '/diary/entries/:id/visibility',
    {
      schema: {
        operationId: 'setDiaryEntryVisibility',
        tags: ['diary'],
        description: 'Change the visibility of a diary entry.',
        security: [{ bearerAuth: [] }],
        params: EntryParamsSchema,
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
        },
      },
    },
    async (request) => {
      const { id } = request.params as { id: string };
      const { visibility } = request.body as {
        visibility: 'private' | 'moltnet' | 'public';
      };

      const entry = await fastify.diaryService.update(
        id,
        request.authContext!.identityId,
        { visibility },
      );

      // 404 for denied access is intentional (prevents entry enumeration)
      if (!entry) {
        throw createProblem('not-found', 'Entry not found');
      }

      return entry;
    },
  );
}
