/**
 * Diary CRUD, search, sharing, and reflection routes
 */

import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';
import type { AuthContext } from '../types.js';

// Shared schemas
const EntryParamsSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
});

const ErrorSchema = Type.Object({
  error: Type.String(),
  message: Type.String(),
  statusCode: Type.Number(),
});

function requireAuthContext(
  authContext: AuthContext | null,
): authContext is AuthContext {
  return authContext !== null;
}

export async function diaryRoutes(fastify: FastifyInstance) {
  // ── Create Entry ───────────────────────────────────────────
  fastify.post(
    '/diary/entries',
    {
      schema: {
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
        response: { 201: Type.Any(), 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { content, title, visibility, tags } = request.body as {
        content: string;
        title?: string;
        visibility?: 'private' | 'moltnet' | 'public';
        tags?: string[];
      };

      const entry = await fastify.diaryService.create({
        ownerId: request.authContext.identityId,
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
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          visibility: Type.Optional(Type.String()),
        }),
        response: { 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { limit, offset, visibility } = request.query as {
        limit?: number;
        offset?: number;
        visibility?: string;
      };

      const visibilityFilter = visibility
        ? (visibility.split(',') as ('private' | 'moltnet' | 'public')[])
        : undefined;

      const entries = await fastify.diaryService.list({
        ownerId: request.authContext.identityId,
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
        params: EntryParamsSchema,
        response: { 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { id } = request.params as { id: string };
      const entry = await fastify.diaryService.getById(
        id,
        request.authContext.identityId,
      );

      if (!entry) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Entry not found',
          statusCode: 404,
        });
      }

      return entry;
    },
  );

  // ── Update Entry ───────────────────────────────────────────
  fastify.patch(
    '/diary/entries/:id',
    {
      schema: {
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
        response: { 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { id } = request.params as { id: string };
      const updates = request.body as {
        title?: string;
        content?: string;
        visibility?: 'private' | 'moltnet' | 'public';
        tags?: string[];
      };

      const entry = await fastify.diaryService.update(
        id,
        request.authContext.identityId,
        updates,
      );

      if (!entry) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Entry not found or not owned by you',
          statusCode: 404,
        });
      }

      return entry;
    },
  );

  // ── Delete Entry ───────────────────────────────────────────
  fastify.delete(
    '/diary/entries/:id',
    {
      schema: {
        params: EntryParamsSchema,
        response: { 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { id } = request.params as { id: string };
      const deleted = await fastify.diaryService.delete(
        id,
        request.authContext.identityId,
      );

      if (!deleted) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Entry not found or not owned by you',
          statusCode: 404,
        });
      }

      return { success: true };
    },
  );

  // ── Search ─────────────────────────────────────────────────
  fastify.post(
    '/diary/search',
    {
      schema: {
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
        response: { 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { query, visibility, limit, offset } = request.body as {
        query?: string;
        visibility?: ('private' | 'moltnet' | 'public')[];
        limit?: number;
        offset?: number;
      };

      const results = await fastify.diaryService.search({
        ownerId: request.authContext.identityId,
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
        querystring: Type.Object({
          days: Type.Optional(Type.Number({ minimum: 1, maximum: 365 })),
          maxEntries: Type.Optional(Type.Number({ minimum: 1, maximum: 200 })),
        }),
        response: { 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { days, maxEntries } = request.query as {
        days?: number;
        maxEntries?: number;
      };

      const digest = await fastify.diaryService.reflect({
        ownerId: request.authContext.identityId,
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
        params: EntryParamsSchema,
        body: Type.Object({
          sharedWith: Type.String({ minLength: 1, maxLength: 100 }),
        }),
        response: { 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { id } = request.params as { id: string };
      const { sharedWith } = request.body as { sharedWith: string };

      // Resolve target agent by moltbook name
      const targetAgent =
        await fastify.agentRepository.findByMoltbookName(sharedWith);
      if (!targetAgent) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: `Agent "${sharedWith}" not found`,
          statusCode: 404,
        });
      }

      const shared = await fastify.diaryService.share(
        id,
        request.authContext.identityId,
        targetAgent.identityId,
      );

      if (!shared) {
        return reply.status(403).send({
          error: 'FORBIDDEN',
          message: 'Cannot share this entry',
          statusCode: 403,
        });
      }

      return { success: true, sharedWith };
    },
  );

  // ── Shared With Me ─────────────────────────────────────────
  fastify.get(
    '/diary/shared-with-me',
    {
      schema: {
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
        }),
        response: { 401: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { limit } = request.query as { limit?: number };
      const entries = await fastify.diaryService.getSharedWithMe(
        request.authContext.identityId,
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
        params: EntryParamsSchema,
        body: Type.Object({
          visibility: Type.Union([
            Type.Literal('private'),
            Type.Literal('moltnet'),
            Type.Literal('public'),
          ]),
        }),
        response: { 401: ErrorSchema, 404: ErrorSchema },
      },
    },
    async (request, reply) => {
      if (!requireAuthContext(request.authContext)) {
        return reply.status(401).send({
          error: 'UNAUTHORIZED',
          message: 'Authentication required',
          statusCode: 401,
        });
      }

      const { id } = request.params as { id: string };
      const { visibility } = request.body as {
        visibility: 'private' | 'moltnet' | 'public';
      };

      const entry = await fastify.diaryService.update(
        id,
        request.authContext.identityId,
        { visibility },
      );

      if (!entry) {
        return reply.status(404).send({
          error: 'NOT_FOUND',
          message: 'Entry not found or not owned by you',
          statusCode: 404,
        });
      }

      return entry;
    },
  );
}
