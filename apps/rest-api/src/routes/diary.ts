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

const NestedDiaryParamsSchema = Type.Object({
  diaryId: Type.String({ format: 'uuid' }),
});

const DiaryEntryParamsSchema = Type.Object({
  diaryId: Type.String({ format: 'uuid' }),
  entryId: Type.String({ format: 'uuid' }),
});

export async function diaryRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  async function canAccessDiary(
    diaryId: string,
    requesterId: string,
    mode: 'read' | 'write' | 'manage',
  ): Promise<boolean> {
    if (mode === 'read') {
      return fastify.permissionChecker.canReadDiary(diaryId, requesterId);
    }
    if (mode === 'write') {
      return fastify.permissionChecker.canWriteDiary(diaryId, requesterId);
    }
    return fastify.permissionChecker.canManageDiary(diaryId, requesterId);
  }

  async function resolveDiary(
    diaryId: string,
    requesterId: string,
    accessMode: 'read' | 'write' | 'manage',
  ) {
    const diary = await fastify.diaryCatalogRepository.findById(diaryId);

    if (!diary) {
      throw createProblem('not-found', 'Diary not found');
    }

    // if (diary.ownerId === requesterId) {
    //   return diary;
    // }

    const allowed = await canAccessDiary(diary.id, requesterId, accessMode);
    if (!allowed) {
      throw createProblem('not-found', 'Diary not found');
    }

    return diary;
  }

  const DiaryParamsSchema = Type.Object({
    id: Type.String({ format: 'uuid' }),
  });

  const DiaryShareParamsSchema = Type.Object({
    diaryId: Type.String({ format: 'uuid' }),
    fingerprint: Type.String({
      pattern: '^[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}-[A-Fa-f0-9]{4}$',
    }),
  });

  const InvitationIdParamsSchema = Type.Object({
    id: Type.String({ format: 'uuid' }),
  });

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

      const diary = await fastify.diaryCatalogRepository.create({
        ownerId: request.authContext!.identityId,
        name,
        visibility: visibility ?? 'private',
      });

      await fastify.relationshipWriter.grantDiaryOwner(
        diary.id,
        request.authContext!.identityId,
      );

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
      const items = await fastify.diaryCatalogRepository.listByOwner(
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
      const updates = request.body;

      const diary = await fastify.diaryCatalogRepository.update(
        id,
        request.authContext!.identityId,
        updates,
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

      const diary = await fastify.diaryCatalogRepository.findOwnedById(
        request.authContext!.identityId,
        id,
      );
      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      await fastify.transactionRunner.runInTransaction(
        async () => {
          const deleted = await fastify.diaryCatalogRepository.delete(
            diary.id,
            request.authContext!.identityId,
          );
          if (!deleted) {
            throw createProblem('not-found', 'Diary not found');
          }

          await fastify.relationshipWriter.removeDiaryRelations(diary.id);
        },
        { name: 'diary.delete' },
      );

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

      const diary = await fastify.diaryCatalogRepository.findOwnedById(
        request.authContext!.identityId,
        diaryId,
      );
      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const shares = await fastify.diaryShareRepository.listByDiary(diary.id);
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

      const diary = await fastify.diaryCatalogRepository.findOwnedById(
        request.authContext!.identityId,
        diaryId,
      );
      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const normalizedFingerprint = fingerprint.toUpperCase();
      const targetAgent = await fastify.agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!targetAgent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      if (targetAgent.identityId === request.authContext!.identityId) {
        throw createProblem(
          'validation-failed',
          'Cannot share a diary with yourself',
        );
      }

      const existingShare =
        await fastify.diaryShareRepository.findByDiaryAndAgent(
          diary.id,
          targetAgent.identityId,
        );

      if (existingShare) {
        if (
          existingShare.status === 'revoked' ||
          existingShare.status === 'declined'
        ) {
          const updated = await fastify.diaryShareRepository.updateStatus(
            existingShare.id,
            'pending',
            { respondedAt: null, role: role ?? 'reader' },
          );
          if (!updated) {
            throw createProblem('not-found', 'Share not found');
          }
          return reply.status(201).send(updated);
        }
        throw createProblem(
          'validation-failed',
          `Share already exists with status "${existingShare.status}"`,
        );
      }

      const share = await fastify.diaryShareRepository.create({
        diaryId: diary.id,
        sharedWith: targetAgent.identityId,
        role: role ?? 'reader',
      });

      if (!share) {
        throw createProblem(
          'validation-failed',
          'Share already exists for this diary and agent',
        );
      }

      return reply.status(201).send(share);
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
      const invitations =
        await fastify.diaryShareRepository.listPendingForAgent(
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

      const share = await fastify.diaryShareRepository.findById(id);
      if (!share || share.sharedWith !== request.authContext!.identityId) {
        throw createProblem('not-found', 'Invitation not found');
      }

      if (share.status !== 'pending') {
        throw createProblem(
          'validation-failed',
          `Invitation has already been ${share.status}`,
        );
      }

      const updated = await fastify.transactionRunner.runInTransaction(
        async () => {
          const accepted = await fastify.diaryShareRepository.updateStatus(
            id,
            'accepted',
          );
          if (!accepted) {
            throw createProblem('not-found', 'Invitation not found');
          }

          if (accepted.role === 'writer') {
            await fastify.relationshipWriter.grantDiaryWriter(
              accepted.diaryId,
              request.authContext!.identityId,
            );
          } else {
            await fastify.relationshipWriter.grantDiaryReader(
              accepted.diaryId,
              request.authContext!.identityId,
            );
          }

          return accepted;
        },
        { name: 'diary.accept-invitation' },
      );

      return updated;
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

      const share = await fastify.diaryShareRepository.findById(id);
      if (!share || share.sharedWith !== request.authContext!.identityId) {
        throw createProblem('not-found', 'Invitation not found');
      }

      if (share.status !== 'pending') {
        throw createProblem(
          'validation-failed',
          `Invitation has already been ${share.status}`,
        );
      }

      const updated = await fastify.diaryShareRepository.updateStatus(
        id,
        'declined',
      );
      if (!updated) {
        throw createProblem('not-found', 'Invitation not found');
      }

      return updated;
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

      const diary = await fastify.diaryCatalogRepository.findOwnedById(
        request.authContext!.identityId,
        diaryId,
      );
      if (!diary) {
        throw createProblem('not-found', 'Diary not found');
      }

      const normalizedFingerprint = fingerprint.toUpperCase();
      const targetAgent = await fastify.agentRepository.findByFingerprint(
        normalizedFingerprint,
      );
      if (!targetAgent) {
        throw createProblem(
          'not-found',
          `Agent with fingerprint "${normalizedFingerprint}" not found`,
        );
      }

      const share = await fastify.diaryShareRepository.findByDiaryAndAgent(
        diary.id,
        targetAgent.identityId,
      );
      if (!share) {
        throw createProblem('not-found', 'Share not found');
      }

      await fastify.transactionRunner.runInTransaction(
        async () => {
          await fastify.diaryShareRepository.updateStatus(share.id, 'revoked');
          await fastify.relationshipWriter.removeDiaryRelationForAgent(
            diary.id,
            targetAgent.identityId,
          );
        },
        { name: 'diary.revoke-share' },
      );

      return { success: true };
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

      const diary = await resolveDiary(
        diaryId,
        request.authContext!.identityId,
        'write',
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
      const { diaryId } = request.params;
      const { limit, offset, visibility, tags, entryType } = request.query;
      const diary = await resolveDiary(
        diaryId,
        request.authContext!.identityId,
        'read',
      );

      const visibilityFilter = visibility
        ? (visibility.split(',') as ('private' | 'moltnet' | 'public')[])
        : undefined;
      const tagsFilter = tags
        ? tags.split(',').map((t) => t.trim())
        : undefined;

      const entries = await fastify.diaryService.list({
        ownerId: diary.ownerId,
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
      const diary = await resolveDiary(
        diaryId,
        request.authContext!.identityId,
        'read',
      );

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
      const { diaryId, entryId } = request.params;
      const diary = await resolveDiary(
        diaryId,
        request.authContext!.identityId,
        'write',
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
      const diary = await resolveDiary(
        diaryId,
        request.authContext!.identityId,
        'write',
      );
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
    '/diaries/reflect',
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

  // ── Update Visibility ──────────────────────────────────────
  server.patch(
    '/diaries/:diaryId/entries/:entryId/visibility',
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
      const { diaryId, entryId } = request.params;
      const diary = await resolveDiary(
        diaryId,
        request.authContext!.identityId,
        'manage',
      );
      const existing = await fastify.diaryService.getById(
        entryId,
        request.authContext!.identityId,
      );
      if (!existing || existing.diaryId !== diary.id) {
        throw createProblem('not-found', 'Entry not found');
      }

      const { visibility } = request.body;

      const entry = await fastify.diaryService.update(
        entryId,
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
