/**
 * Diary CRUD, search, sharing, and reflection routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { computeContentCid } from '@moltnet/crypto-service';
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
  EntryVerifyResultSchema,
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
      try {
        const diary = await fastify.diaryService.findDiary(
          id,
          request.authContext!.identityId,
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

      try {
        const diary = await fastify.diaryService.updateDiary(
          id,
          request.authContext!.identityId,
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

      try {
        const deleted = await fastify.diaryService.deleteDiary(
          id,
          request.authContext!.identityId,
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

  // ── Create Entry ───────────────────────────────────────────
  server.post(
    '/diaries/:diaryId/entries',
    {
      schema: {
        operationId: 'createDiaryEntry',
        tags: ['diary'],
        description:
          'Create a new diary entry. Optionally sign it by providing contentHash (CIDv1) and signingRequestId.',
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
          contentHash: Type.Optional(
            Type.String({
              pattern: '^bafk[a-z2-7]+$',
              description:
                'CIDv1 content identifier (base32lower). Required together with signingRequestId to create a signed entry.',
            }),
          ),
          signingRequestId: Type.Optional(
            Type.String({
              format: 'uuid',
              description:
                'ID of a completed signing request whose message matches contentHash.',
            }),
          ),
        }),
        response: {
          201: Type.Ref(DiaryEntrySchema),
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
      const {
        content,
        title,
        tags,
        importance,
        entryType,
        contentHash,
        signingRequestId,
      } = request.body;
      const agentId = request.authContext!.identityId;

      try {
        // Validate signing fields: both or neither
        if (
          (contentHash && !signingRequestId) ||
          (!contentHash && signingRequestId)
        ) {
          throw createProblem(
            'validation-failed',
            'Both contentHash and signingRequestId are required together for signed entries.',
          );
        }

        let contentSignature: string | undefined;
        let signingNonce: string | undefined;

        if (contentHash && signingRequestId) {
          // 1. Recompute CID from entry fields and verify match
          const recomputedCid = computeContentCid(
            entryType ?? 'semantic',
            title ?? null,
            content,
            tags ?? null,
          );
          if (recomputedCid !== contentHash) {
            throw createProblem(
              'validation-failed',
              `Content hash mismatch: provided ${contentHash}, computed ${recomputedCid}`,
            );
          }

          // 2. Look up signing request and verify it
          const signingRequest =
            await fastify.signingRequestRepository.findById(signingRequestId);

          if (!signingRequest) {
            throw createProblem('not-found', 'Signing request not found');
          }
          if (signingRequest.agentId !== agentId) {
            throw createProblem(
              'forbidden',
              'Signing request belongs to a different agent',
            );
          }
          if (signingRequest.status !== 'completed') {
            throw createProblem(
              'validation-failed',
              `Signing request is ${signingRequest.status}, expected completed`,
            );
          }
          if (!signingRequest.valid) {
            throw createProblem(
              'validation-failed',
              'Signing request signature was not verified as valid',
            );
          }
          if (signingRequest.message !== contentHash) {
            throw createProblem(
              'validation-failed',
              'Signing request message does not match content hash',
            );
          }

          contentSignature = signingRequest.signature!;
          signingNonce = signingRequest.nonce;
          // Note: the unique index on content_signature prevents reuse —
          // if this signature was already used for another entry, the
          // INSERT will fail with a unique constraint violation.
        }

        const entry = await fastify.diaryService.createEntry(
          {
            diaryId,
            content,
            title,
            tags,
            importance,
            entryType,
            contentHash,
            contentSignature,
            signingNonce,
          },
          agentId,
        );
        return await reply.status(201).send(entry);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        // Unique constraint on content_signature → signing request already used
        if (
          err instanceof Error &&
          'code' in err &&
          (err as { code: string }).code === '23505' &&
          'constraint' in err &&
          String((err as { constraint: string }).constraint).includes(
            'content_signature',
          )
        ) {
          throw createProblem(
            'conflict',
            'This signing request has already been used to create an entry',
          );
        }
        throw err;
      }
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

      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(
          diaryId,
          request.authContext!.identityId,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }

      const tagsFilter = tags
        ? tags.split(',').map((t) => t.trim())
        : undefined;

      const entries = await fastify.diaryService.listEntries({
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
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;

      try {
        const entry = await fastify.diaryService.getEntryById(
          entryId,
          diaryId,
          request.authContext!.identityId,
        );

        return entry;
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Verify Entry ──────────────────────────────────────────
  server.get(
    '/diaries/:diaryId/entries/:entryId/verify',
    {
      schema: {
        operationId: 'verifyDiaryEntry',
        tags: ['diary'],
        description:
          'Verify the content signature of a diary entry. Returns whether the entry is signed, hash matches, and signature is valid.',
        security: [{ bearerAuth: [] }],
        params: DiaryEntryParamsSchema,
        response: {
          200: Type.Ref(EntryVerifyResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;

      try {
        // Fetch entry (also checks access)
        const entry = await fastify.diaryService.getEntryById(
          entryId,
          diaryId,
          request.authContext!.identityId,
        );

        if (!entry.contentSignature || !entry.contentHash) {
          return {
            signed: false,
            hashMatches: false,
            signatureValid: false,
            valid: false,
            contentHash: null,
            agentFingerprint: null,
          };
        }

        // Recompute CID from stored fields
        const recomputedCid = computeContentCid(
          entry.entryType,
          entry.title,
          entry.content,
          entry.tags,
        );
        const hashMatches = recomputedCid === entry.contentHash;

        let signatureValid = false;
        let agentFingerprint: string | null = null;

        // Look up signing request once — needed for signer identity
        // and (for pre-signingNonce entries) the nonce itself.
        const signingRequest =
          await fastify.signingRequestRepository.findBySignature(
            entry.contentSignature,
          );
        const nonce = entry.signingNonce ?? signingRequest?.nonce ?? null;
        const signerIdentityId = signingRequest?.agentId ?? null;

        if (nonce && signerIdentityId) {
          const signerKey =
            await fastify.agentRepository.findByIdentityId(signerIdentityId);
          if (signerKey) {
            agentFingerprint = signerKey.fingerprint;
            signatureValid = await fastify.cryptoService.verifyWithNonce(
              entry.contentHash,
              nonce,
              entry.contentSignature,
              signerKey.publicKey,
            );
          }
        }

        return {
          signed: true,
          hashMatches,
          signatureValid,
          valid: hashMatches && signatureValid,
          contentHash: entry.contentHash,
          agentFingerprint,
        };
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  // ── Update Entry ───────────────────────────────────────────
  server.patch(
    '/diaries/:diaryId/entries/:entryId',
    {
      schema: {
        operationId: 'updateDiaryEntry',
        tags: ['diary'],
        description: 'Update a diary entry (content, title, tags).',
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
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          409: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;
      const updates = request.body;

      try {
        const entry = await fastify.diaryService.updateEntry(
          entryId,
          diaryId,
          request.authContext!.identityId,
          updates,
        );

        if (!entry) {
          throw createProblem('not-found', 'Entry not found');
        }

        return entry;
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
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
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId, entryId } = request.params;

      try {
        const deleted = await fastify.diaryService.deleteEntry(
          entryId,
          diaryId,
          request.authContext!.identityId,
        );

        if (!deleted) {
          throw createProblem('not-found', 'Entry not found');
        }

        return { success: true };
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
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
          diaryId: Type.Optional(Type.String({ format: 'uuid' })),
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
          includeShared: Type.Optional(Type.Boolean()),
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
        diaryId,
        includeShared,
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

      const agentId = request.authContext!.identityId;
      const searchInput = {
        diaryId,
        query,
        tags,
        limit,
        offset,
        wRelevance,
        wRecency,
        wImportance,
        entryTypes,
        excludeSuperseded,
      };

      try {
        let results;
        if (diaryId) {
          results = await fastify.diaryService.searchEntries(
            searchInput,
            agentId,
          );
        } else if (includeShared) {
          results = await fastify.diaryService.searchAccessible(
            searchInput,
            agentId,
          );
        } else {
          results = await fastify.diaryService.searchOwned(
            searchInput,
            agentId,
          );
        }
        return { results, total: results.length };
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
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

      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(
          diaryId,
          request.authContext!.identityId,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
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
