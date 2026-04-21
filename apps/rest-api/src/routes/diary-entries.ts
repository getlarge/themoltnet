/**
 * Diary entry CRUD and search routes
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { computeContentCid } from '@moltnet/crypto-service';
import type { RelationAtDepth } from '@moltnet/database';
import type { ListInput, ListTagsInput } from '@moltnet/diary-service';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  EntryParamsSchema,
  entryTypeLiterals,
  NestedDiaryParamsSchema,
  ProblemDetailsSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem, isUniqueViolation } from '../problems/index.js';
import {
  DiaryEntrySchema,
  DiaryEntryWithRelationsSchema,
  DiaryListSchema,
  DiarySearchResultSchema,
  DiaryTagsResponseSchema,
  EntryVerifyResultSchema,
  SuccessSchema,
} from '../schemas.js';

const queryTagSchema = Type.String({
  minLength: 1,
  maxLength: 50,
  pattern: '^[^,]+$',
});

function wantsExpandedRelations(expand?: 'relations'): boolean {
  return expand === 'relations';
}

function toRelationWithDepthResponse(row: RelationAtDepth) {
  const meta = (row.metadata ?? {}) as Record<string, unknown>;
  return {
    id: row.id,
    sourceId: row.sourceId,
    targetId: row.targetId,
    relation: row.relation,
    status: row.status,
    sourceCidSnapshot: row.sourceCidSnapshot ?? null,
    targetCidSnapshot: row.targetCidSnapshot ?? null,
    workflowId: row.workflowId ?? null,
    confidence: typeof meta.confidence === 'number' ? meta.confidence : null,
    similarity: typeof meta.similarity === 'number' ? meta.similarity : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    depth: row.depth,
    parentRelationId: row.parentRelationId,
  };
}

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

export async function diaryEntryRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();

  // All diary entry routes require authentication
  server.addHook('preHandler', requireAuth);

  // ── Create Entry ───────────────────────────────────────────
  server.post(
    '/diaries/:diaryId/entries',
    {
      schema: {
        operationId: 'createDiaryEntry',
        tags: ['diary'],
        description:
          'Create a new diary entry. Optionally sign it by providing contentHash (CIDv1) and signingRequestId.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: NestedDiaryParamsSchema,
        body: Type.Object({
          content: Type.String({ minLength: 1, maxLength: 100000 }),
          title: Type.Optional(Type.String({ maxLength: 255 })),
          tags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
          entryType: Type.Optional(Type.Union(entryTypeLiterals)),
          contentHash: Type.Optional(
            Type.String({
              pattern: '^bafk[a-z2-7]+$',
              description:
                'CIDv1 content identifier (base32lower). Only allowed together with signingRequestId — the server computes it from entry fields. If provided, it is validated against the computed CID.',
            }),
          ),
          signingRequestId: Type.Optional(
            Type.String({
              format: 'uuid',
              description:
                'ID of a completed signing request. The server computes the CID from entry fields and verifies it matches the signing request message.',
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
      const { identityId: agentId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      try {
        let contentSignature: string | undefined;
        let signingNonce: string | undefined;

        // Always compute CID from entry fields (server is the authority).
        // Every entry gets a contentHash for provenance, regardless of signing.
        const computedCid = computeContentCid(
          entryType ?? 'semantic',
          title ?? null,
          content,
          tags ?? null,
        );

        // If client provided contentHash, validate it matches
        if (contentHash && contentHash !== computedCid) {
          throw createProblem(
            'validation-failed',
            `Content hash mismatch: provided ${contentHash}, computed ${computedCid}`,
          );
        }

        const resolvedContentHash = computedCid;

        if (signingRequestId) {
          // Look up signing request and verify it
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
          if (signingRequest.message !== resolvedContentHash) {
            throw createProblem(
              'validation-failed',
              'Signing request message does not match content hash',
            );
          }

          contentSignature = signingRequest.signature!;
          signingNonce = signingRequest.nonce;
        } else if (contentHash) {
          // contentHash without signingRequestId is invalid
          throw createProblem(
            'validation-failed',
            'contentHash requires signingRequestId to create a signed entry.',
          );
        }

        const entry = await fastify.diaryService.createEntry(
          {
            diaryId,
            content,
            title,
            tags,
            importance,
            entryType,
            contentHash: resolvedContentHash,
            contentSignature,
            signingNonce,
          },
          agentId,
          subjectNs,
        );
        return await reply.status(201).send(entry);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        // Unique constraint on content_signature → signing request already used
        if (isUniqueViolation(err, 'content_signature')) {
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: NestedDiaryParamsSchema,
        querystring: Type.Object({
          limit: Type.Optional(Type.Number({ minimum: 1, maximum: 100 })),
          offset: Type.Optional(Type.Number({ minimum: 0 })),
          ids: Type.Optional(
            Type.Array(Type.String({ format: 'uuid' }), {
              maxItems: 50,
              description:
                'Repeated entry UUID filter (max 50). Returns only matching entries scoped to the diary. Combines with tags/excludeTags/entryType as AND conditions.',
            }),
          ),
          tags: Type.Optional(
            Type.Array(queryTagSchema, {
              maxItems: 20,
              description:
                'Repeated tags filter (entry must have ALL specified tags, max 20 tags, 50 chars each)',
            }),
          ),
          excludeTags: Type.Optional(
            Type.Array(queryTagSchema, {
              maxItems: 20,
              description:
                'Repeated excluded tags filter (entry must have NONE of these tags, max 20 tags, 50 chars each)',
            }),
          ),
          entryType: Type.Optional(
            Type.Array(Type.Union(entryTypeLiterals), {
              maxItems: 6,
              description:
                'Repeated entry type filter (e.g. entryType=identity&entryType=soul). Single value also accepted.',
            }),
          ),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Ref(DiaryListSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId } = request.params;
      const { limit, offset, ids, tags, excludeTags, entryType } =
        request.query;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(
          diaryId,
          identityId,
          subjectNs,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }

      const { items, total } = await fastify.diaryService.listEntries({
        diaryId: diary.id,
        ids,
        tags,
        excludeTags,
        limit,
        offset,
        entryTypes: entryType as ListInput['entryTypes'] | undefined,
      });

      return {
        items,
        total,
        limit: limit ?? 20,
        offset: offset ?? 0,
      };
    },
  );

  // ── List Tags ──────────────────────────────────────────────
  server.get(
    '/diaries/:diaryId/tags',
    {
      schema: {
        operationId: 'listDiaryTags',
        tags: ['diary'],
        description:
          'List distinct tags used across all entries in a diary, with counts.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: NestedDiaryParamsSchema,
        querystring: Type.Object({
          prefix: Type.Optional(
            Type.String({
              maxLength: 50,
              description: 'Filter to tags starting with this prefix',
            }),
          ),
          minCount: Type.Optional(
            Type.Integer({
              minimum: 1,
              description: 'Exclude tags with fewer than this many entries',
            }),
          ),
          entryTypes: Type.Optional(
            Type.Array(Type.Union(entryTypeLiterals), {
              maxItems: 6,
              description:
                'Repeated entry types to scope the tag count. Single value also accepted.',
            }),
          ),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Ref(DiaryTagsResponseSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { diaryId } = request.params;
      const { prefix, minCount, entryTypes } = request.query;
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      try {
        const tags = await fastify.diaryService.listTags(
          {
            diaryId,
            prefix,
            minCount,
            entryTypes: entryTypes as ListTagsInput['entryTypes'] | undefined,
          },
          identityId,
          subjectNs,
        );

        return { tags, total: tags.length };
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
    },
  );

  const updateBodySchema = Type.Object(
    {
      title: Type.Optional(Type.String({ maxLength: 255 })),
      content: Type.Optional(Type.String({ minLength: 1, maxLength: 100000 })),
      tags: Type.Optional(
        Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
      ),
      importance: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
      entryType: Type.Optional(Type.Union(entryTypeLiterals)),
    },
    {
      minProperties: 1,
      additionalProperties: false,
      description:
        'At least one of title, content, tags, importance, or entryType must be provided.',
    },
  );

  const getEntry = async (
    entryId: string,
    agentId: string,
    subjectNs: KetoNamespace,
    diaryId?: string,
  ) => {
    try {
      return await fastify.diaryService.getEntryById(
        entryId,
        agentId,
        subjectNs,
        { diaryId },
      );
    } catch (err) {
      if (err instanceof DiaryServiceError) translateServiceError(err);
      throw err;
    }
  };

  const verifyEntry = async (
    entryId: string,
    agentId: string,
    subjectNs: KetoNamespace,
    diaryId?: string,
  ) => {
    const entry = await getEntry(entryId, agentId, subjectNs, diaryId);

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

    const recomputedCid = computeContentCid(
      entry.entryType,
      entry.title,
      entry.content,
      entry.tags,
    );
    const hashMatches = recomputedCid === entry.contentHash;

    let signatureValid = false;
    let agentFingerprint: string | null = null;

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
  };

  const updateEntry = async (
    entryId: string,
    agentId: string,
    subjectNs: KetoNamespace,
    updates: {
      title?: string;
      content?: string;
      tags?: string[];
      importance?: number;
      entryType?:
        | 'episodic'
        | 'semantic'
        | 'procedural'
        | 'reflection'
        | 'identity'
        | 'soul';
    },
  ) => {
    try {
      const entry = await fastify.diaryService.updateEntry(
        entryId,
        agentId,
        subjectNs,
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
  };

  const deleteEntry = async (
    entryId: string,
    agentId: string,
    subjectNs: KetoNamespace,
  ) => {
    try {
      const deleted = await fastify.diaryService.deleteEntry(
        entryId,
        agentId,
        subjectNs,
      );

      if (!deleted) {
        throw createProblem('not-found', 'Entry not found');
      }

      return { success: true };
    } catch (err) {
      if (err instanceof DiaryServiceError) translateServiceError(err);
      throw err;
    }
  };

  // ── Get Entry ──────────────────────────────────────────────
  server.get(
    '/entries/:entryId',
    {
      schema: {
        operationId: 'getDiaryEntryById',
        tags: ['diary'],
        description:
          'Get a single diary entry by ID. Pass expand=relations to inline the relation graph up to `depth` hops. Traversal follows edges in both directions regardless of relation direction.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: EntryParamsSchema,
        querystring: Type.Object({
          expand: Type.Optional(Type.Literal('relations')),
          depth: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 3, default: 1 }),
          ),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Ref(DiaryEntryWithRelationsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const entry = await getEntry(
        request.params.entryId,
        identityId,
        subjectNs,
      );

      if (!wantsExpandedRelations(request.query.expand)) {
        return entry;
      }

      const depth = request.query.depth ?? 1;
      const traversal = await fastify.entryRelationRepository.traverseFromEntry(
        entry.id,
        {
          depth,
        },
      );
      const maxDepth = traversal.reduce((m, r) => Math.max(m, r.depth), 0);

      return {
        ...entry,
        relations: {
          requestedDepth: depth,
          maxDepth,
          items: traversal.map(toRelationWithDepthResponse),
        },
      };
    },
  );

  // ── Verify Entry ──────────────────────────────────────────
  server.get(
    '/entries/:entryId/verify',
    {
      schema: {
        operationId: 'verifyDiaryEntryById',
        tags: ['diary'],
        description:
          'Verify the content signature of a diary entry. Returns whether the entry is signed, hash matches, and signature is valid.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: EntryParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Ref(EntryVerifyResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      return verifyEntry(request.params.entryId, identityId, subjectNs);
    },
  );

  // ── Update Entry ───────────────────────────────────────────
  server.patch(
    '/entries/:entryId',
    {
      schema: {
        operationId: 'updateDiaryEntryById',
        tags: ['diary'],
        description: 'Update a diary entry (content, title, tags).',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: EntryParamsSchema,
        body: updateBodySchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
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
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;

      // Defense in depth: Ajv's removeAdditional can strip unknown keys
      // before minProperties is evaluated, so guard explicitly against a
      // body that carries no known fields.
      const { title, content, tags, importance, entryType } = request.body;
      if (
        title === undefined &&
        content === undefined &&
        tags === undefined &&
        importance === undefined &&
        entryType === undefined
      ) {
        throw createProblem(
          'validation-failed',
          'At least one of title, content, tags, importance, or entryType must be provided',
        );
      }

      return updateEntry(
        request.params.entryId,
        identityId,
        subjectNs,
        request.body,
      );
    },
  );

  // ── Delete Entry ───────────────────────────────────────────
  server.delete(
    '/entries/:entryId',
    {
      schema: {
        operationId: 'deleteDiaryEntryById',
        tags: ['diary'],
        description: 'Delete a diary entry.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: EntryParamsSchema,
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Ref(SuccessSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      return deleteEntry(request.params.entryId, identityId, subjectNs);
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
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        body: Type.Object({
          diaryId: Type.Optional(Type.String({ format: 'uuid' })),
          query: Type.Optional(Type.String({ minLength: 1, maxLength: 500 })),
          tags: Type.Optional(
            Type.Array(Type.String({ minLength: 1, maxLength: 50 }), {
              minItems: 1,
              maxItems: 20,
            }),
          ),
          excludeTags: Type.Optional(
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
            Type.Array(Type.Union(entryTypeLiterals), {
              minItems: 1,
              maxItems: 6,
            }),
          ),
          excludeSuperseded: Type.Optional(Type.Boolean()),
        }),
        response: {
          400: Type.Ref(ProblemDetailsSchema),
          200: Type.Ref(DiarySearchResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const {
        diaryId,
        query,
        tags,
        excludeTags,
        limit,
        offset,
        wRelevance,
        wRecency,
        wImportance,
        entryTypes,
        excludeSuperseded,
      } = request.body;

      const { identityId: agentId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const searchInput = {
        diaryId,
        query,
        tags,
        excludeTags,
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
            subjectNs,
          );
        } else {
          // Without diaryId, search across all accessible diaries (via team membership)
          results = await fastify.diaryService.searchAccessible(
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
}
