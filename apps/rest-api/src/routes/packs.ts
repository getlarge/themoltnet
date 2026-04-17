import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  compress,
  type CompressionLevel,
  type DistillEntry,
  estimateTokens,
} from '@moltnet/context-distill';
import { PackServiceError } from '@moltnet/context-pack-service';
import { computePackCid } from '@moltnet/crypto-service';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  DiaryParamsSchema,
  ProblemDetailsSchema,
  ProvenanceGraphSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  ContextPackResponseListSchema,
  ContextPackResponseListWithRenderedSchema,
  ContextPackResponseSchema,
  CustomPackBodySchema,
  CustomPackResultSchema,
  PackCidParamsSchema,
  PackCollectionQuerySchema,
  PackListQuerySchema,
  PackParamsSchema,
  PackProvenanceQuerySchema,
  PackQuerySchema,
  PackUpdateBodySchema,
} from '../schemas.js';
import { buildPackProvenanceGraph } from './pack-provenance.js';

interface SelectedEntry {
  entryId: string;
  rank: number;
}

interface ResolvedSelection {
  rank: number;
  row: {
    id: string;
    content: string;
    contentHash: string | null;
    importance: number;
    createdAt: Date;
  };
}

interface CustomPackEntryResult {
  entryId: string;
  entryCidSnapshot: string;
  rank: number;
  compressionLevel: CompressionLevel;
  originalTokens: number;
  packedTokens: number;
}

interface CustomPackCompileStats {
  totalTokens: number;
  entriesIncluded: number;
  entriesCompressed: number;
  compressionRatio: number;
  budgetUtilization: number;
  elapsedMs: number;
}

function wantsExpandedEntries(expand?: 'entries'): boolean {
  return expand === 'entries';
}

function toListResponse<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
) {
  return { items, total, limit, offset };
}

function translateFindDiaryError(err: DiaryServiceError): never {
  switch (err.code) {
    case 'not_found':
      throw createProblem('not-found', err.message);
    case 'forbidden':
      throw createProblem('forbidden', err.message);
    default:
      throw createProblem('internal', err.message);
  }
}

function normalizeSelection(entries: SelectedEntry[]): SelectedEntry[] {
  const seenEntryIds = new Set<string>();
  const seenRanks = new Set<number>();

  for (const entry of entries) {
    if (seenEntryIds.has(entry.entryId)) {
      throw createProblem(
        'validation-failed',
        `Duplicate entryId "${entry.entryId}" in pack selection`,
      );
    }
    if (seenRanks.has(entry.rank)) {
      throw createProblem(
        'validation-failed',
        `Duplicate rank "${entry.rank}" in pack selection`,
      );
    }
    seenEntryIds.add(entry.entryId);
    seenRanks.add(entry.rank);
  }

  return [...entries].sort((a, b) => a.rank - b.rank);
}

async function loadSelectedEntries(
  fastify: FastifyInstance,
  diaryId: string,
  requestedEntries: SelectedEntry[],
): Promise<ResolvedSelection[]> {
  const selectedEntries = normalizeSelection(requestedEntries);
  const { items: rows } = await fastify.diaryEntryRepository.list({
    diaryId,
    ids: selectedEntries.map((entry) => entry.entryId),
    limit: selectedEntries.length,
  });

  if (rows.length !== selectedEntries.length) {
    const foundIds = new Set(rows.map((row) => row.id));
    const missingIds = selectedEntries
      .map((entry) => entry.entryId)
      .filter((entryId) => !foundIds.has(entryId));

    throw createProblem(
      'validation-failed',
      `Entries not found in diary ${diaryId}: ${missingIds.join(', ')}`,
    );
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  return selectedEntries.map((entry) => {
    const row = rowById.get(entry.entryId);
    if (!row) {
      throw createProblem(
        'validation-failed',
        `Entry ${entry.entryId} was not found in diary ${diaryId}`,
      );
    }
    if (!row.contentHash) {
      throw createProblem(
        'validation-failed',
        `Entry ${entry.entryId} has no contentHash and cannot be packed`,
      );
    }
    return {
      rank: entry.rank,
      row,
    };
  });
}

function fitCustomPackEntries(
  selectedEntries: ResolvedSelection[],
  tokenBudget?: number,
): {
  entries: CustomPackEntryResult[];
  stats: CustomPackCompileStats;
} {
  const start = performance.now();
  const distillEntries = selectedEntries.map(
    ({ row }): DistillEntry => ({
      id: row.id,
      embedding: [],
      content: row.content,
      tokens: estimateTokens(row.content),
      importance: row.importance,
      createdAt: row.createdAt.toISOString(),
    }),
  );
  const distillById = new Map(distillEntries.map((entry) => [entry.id, entry]));
  const compiledById = new Map(
    distillEntries.map((entry) => [entry.id, compress(entry, 'full')]),
  );

  let totalTokens = Array.from(compiledById.values()).reduce(
    (sum, entry) => sum + entry.compressedTokens,
    0,
  );

  if (tokenBudget !== undefined && totalTokens > tokenBudget) {
    for (
      let index = selectedEntries.length - 1;
      index >= 0 && totalTokens > tokenBudget;
      index -= 1
    ) {
      const source = distillById.get(selectedEntries[index].row.id);
      const current = compiledById.get(selectedEntries[index].row.id);
      if (!source || !current || current.compressionLevel !== 'full') {
        continue;
      }

      const summary = compress(source, 'summary');
      totalTokens += summary.compressedTokens - current.compressedTokens;
      compiledById.set(selectedEntries[index].row.id, summary);
    }

    for (
      let index = selectedEntries.length - 1;
      index >= 0 && totalTokens > tokenBudget;
      index -= 1
    ) {
      const source = distillById.get(selectedEntries[index].row.id);
      const current = compiledById.get(selectedEntries[index].row.id);
      if (!source || !current || current.compressionLevel !== 'summary') {
        continue;
      }

      const keywords = compress(source, 'keywords');
      totalTokens += keywords.compressedTokens - current.compressedTokens;
      compiledById.set(selectedEntries[index].row.id, keywords);
    }

    for (
      let index = selectedEntries.length - 1;
      index >= 0 && totalTokens > tokenBudget;
      index -= 1
    ) {
      const current = compiledById.get(selectedEntries[index].row.id);
      if (!current) {
        continue;
      }

      totalTokens -= current.compressedTokens;
      compiledById.delete(selectedEntries[index].row.id);
    }
  }

  const resultEntries = selectedEntries
    .map(({ rank, row }) => {
      const compiled = compiledById.get(row.id);
      if (!compiled || !row.contentHash) {
        return null;
      }
      return {
        entryId: row.id,
        entryCidSnapshot: row.contentHash,
        rank,
        compressionLevel: compiled.compressionLevel,
        originalTokens: compiled.originalTokens,
        packedTokens: compiled.compressedTokens,
      } satisfies CustomPackEntryResult;
    })
    .filter((entry): entry is CustomPackEntryResult => entry !== null);

  const originalTotal = resultEntries.reduce(
    (sum, entry) => sum + entry.originalTokens,
    0,
  );
  const packedTotal = resultEntries.reduce(
    (sum, entry) => sum + entry.packedTokens,
    0,
  );

  return {
    entries: resultEntries,
    stats: {
      totalTokens: packedTotal,
      entriesIncluded: resultEntries.length,
      entriesCompressed: resultEntries.filter(
        (entry) => entry.compressionLevel !== 'full',
      ).length,
      compressionRatio: originalTotal === 0 ? 1 : packedTotal / originalTotal,
      budgetUtilization:
        tokenBudget === undefined
          ? packedTotal === 0
            ? 0
            : 1
          : packedTotal / tokenBudget,
      elapsedMs: performance.now() - start,
    },
  };
}

export async function packRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  const materializeCustomPack = async (
    request: {
      params: { id: string };
      body: {
        packType: 'custom';
        params: Record<string, unknown>;
        entries: SelectedEntry[];
        tokenBudget?: number;
        pinned?: boolean;
      };
      authContext: {
        identityId: string;
        subjectType: 'agent' | 'human';
      };
    },
    persist: boolean,
  ) => {
    const subjectNs =
      request.authContext.subjectType === 'human'
        ? KetoNamespace.Human
        : KetoNamespace.Agent;

    let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
    try {
      diary = await fastify.diaryService.findDiary(
        request.params.id,
        request.authContext.identityId,
        subjectNs,
      );
    } catch (err) {
      if (err instanceof DiaryServiceError) translateFindDiaryError(err);
      throw err;
    }

    const selectedEntries = await loadSelectedEntries(
      fastify,
      diary.id,
      request.body.entries,
    );
    const { entries, stats } = fitCustomPackEntries(
      selectedEntries,
      request.body.tokenBudget,
    );

    const createdAt = new Date().toISOString();
    const payload = {
      v: 'moltnet:pack:v1',
      diaryId: diary.id,
      createdBy: request.authContext.identityId,
      createdAt,
      packType: 'custom' as const,
      params: request.body.params,
      entries: entries.map((entry) => ({
        cid: entry.entryCidSnapshot,
        compressionLevel: entry.compressionLevel,
        rank: entry.rank,
      })),
    };
    const packCid = computePackCid({
      diaryId: diary.id,
      packType: 'custom',
      params: request.body.params,
      entries: payload.entries,
    });

    if (persist) {
      const createdAtDate = new Date(createdAt);
      const pinned = request.body.pinned ?? false;
      const compileTtlDays =
        fastify.packGcConfig?.PACK_GC_COMPILE_TTL_DAYS ?? 7;
      const expiresAt = pinned
        ? null
        : new Date(
            createdAtDate.getTime() + compileTtlDays * 24 * 60 * 60 * 1000,
          );

      // Idempotent: return existing pack if CID already exists (retry/double-submit)
      const existing = await fastify.contextPackRepository.findByCid(packCid);
      if (existing) {
        return {
          packCid: existing.packCid,
          packType: 'custom' as const,
          params: request.body.params,
          entries,
          compileStats: stats,
        };
      }

      // TODO(issue-456): Move custom pack persistence + Keto parent grant into
      // a DBOS workflow with retry/compensation semantics, matching the compile
      // flow. Keto is an external side effect and cannot be made atomic with
      // the Postgres transaction in this route handler.
      const pack = await fastify.dataSource.runTransaction(async () => {
        const createdPack = await fastify.contextPackRepository.createPack({
          diaryId: diary.id,
          packCid,
          packType: 'custom',
          params: request.body.params,
          payload,
          createdBy: request.authContext.identityId,
          pinned,
          expiresAt,
          createdAt: createdAtDate,
        });

        await fastify.contextPackRepository.addEntries(
          entries.map((entry) => ({
            packId: createdPack.id,
            entryId: entry.entryId,
            entryCidSnapshot: entry.entryCidSnapshot,
            compressionLevel: entry.compressionLevel,
            originalTokens: entry.originalTokens,
            packedTokens: entry.packedTokens,
            rank: entry.rank,
          })),
        );

        return createdPack;
      });

      try {
        await fastify.relationshipWriter.grantPackParent(pack.id, diary.id);
      } catch (error) {
        fastify.log.error(
          { err: error, packId: pack.id, diaryId: diary.id },
          'Failed to grant ContextPack#parent relation for custom pack',
        );

        try {
          await fastify.relationshipWriter.removePackRelations(pack.id);
          await fastify.contextPackRepository.deleteMany([pack.id]);
        } catch (cleanupError) {
          fastify.log.error(
            {
              err: cleanupError,
              packId: pack.id,
              diaryId: diary.id,
            },
            'Failed to clean up custom pack after authorization grant failure',
          );
        }

        throw createProblem(
          'internal',
          'Failed to finalize custom pack authorization',
        );
      }
    }

    return {
      packCid,
      packType: 'custom' as const,
      params: request.body.params,
      entries,
      compileStats: stats,
    };
  };

  server.get(
    '/packs/:id/provenance',
    {
      schema: {
        operationId: 'getContextPackProvenanceById',
        tags: ['diary'],
        description:
          'Export the provenance graph for a persisted context pack by ID.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: PackParamsSchema,
        querystring: PackProvenanceQuerySchema,
        response: {
          200: Type.Ref(ProvenanceGraphSchema),
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

      const pack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canReadPack(
        pack.id,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      try {
        return await buildPackProvenanceGraph({
          fastify,
          rootPack: pack,
          depth: request.query.depth ?? 2,
          identityId,
          subjectNs,
        });
      } catch (error) {
        request.log.error(
          { err: error, packId: pack.id },
          'Failed to build pack provenance graph',
        );
        throw createProblem('internal', 'Failed to build pack provenance');
      }
    },
  );

  server.get(
    '/packs/by-cid/:cid/provenance',
    {
      schema: {
        operationId: 'getContextPackProvenanceByCid',
        tags: ['diary'],
        description:
          'Export the provenance graph for a persisted context pack by CID.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: PackCidParamsSchema,
        querystring: PackProvenanceQuerySchema,
        response: {
          200: ProvenanceGraphSchema,
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

      const pack = await fastify.contextPackRepository.findByCid(
        request.params.cid,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canReadPack(
        pack.id,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      try {
        return await buildPackProvenanceGraph({
          fastify,
          rootPack: pack,
          depth: request.query.depth ?? 2,
          identityId,
          subjectNs,
        });
      } catch (error) {
        request.log.error(
          { err: error, packCid: request.params.cid, packId: pack.id },
          'Failed to build pack provenance graph',
        );
        throw createProblem('internal', 'Failed to build pack provenance');
      }
    },
  );

  server.get(
    '/packs',
    {
      schema: {
        operationId: 'listContextPacks',
        tags: ['diary'],
        description:
          'List persisted context packs across readable diaries, filtered by entry membership. Use `includeRendered=true` to include rendered descendants.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        querystring: PackCollectionQuerySchema,
        response: {
          200: Type.Ref(ContextPackResponseListWithRenderedSchema),
          400: Type.Ref(ProblemDetailsSchema),
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

      if (request.query.diaryId && request.query.containsEntry) {
        throw createProblem(
          'validation-failed',
          'diaryId and containsEntry cannot be combined',
        );
      }
      if (request.query.diaryId) {
        throw createProblem(
          'validation-failed',
          'Use GET /diaries/:id/packs for diary-scoped listing',
        );
      }
      if (!request.query.containsEntry) {
        throw createProblem('validation-failed', 'containsEntry is required');
      }

      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;

      let packs: Awaited<
        ReturnType<typeof fastify.contextPackService.listPacksByEntry>
      >;
      try {
        packs = await fastify.contextPackService.listPacksByEntry({
          entryId: request.query.containsEntry,
          actor: { identityId, subjectNs },
          limit,
          offset,
          includeRendered: request.query.includeRendered,
        });
      } catch (err) {
        if (err instanceof PackServiceError) {
          switch (err.code) {
            case 'not_found':
              throw createProblem('not-found', err.message);
            case 'forbidden':
              throw createProblem('forbidden', err.message);
            case 'validation':
              throw createProblem('validation-failed', err.message);
            default:
              throw createProblem('internal', err.message);
          }
        }
        throw err;
      }

      let items: Array<
        Awaited<
          ReturnType<typeof fastify.contextPackRepository.findById>
        > extends infer T
          ? NonNullable<T>
          : never
      > = packs.items;

      if (wantsExpandedEntries(request.query.expand) && items.length > 0) {
        const entriesByPack =
          await fastify.contextPackRepository.listEntriesExpandedByPackIds(
            items.map((pack) => pack.id),
          );

        items = items.map((pack) => ({
          ...pack,
          entries: entriesByPack.get(pack.id) ?? [],
        }));
      }

      const response: {
        items: typeof items;
        total: number;
        limit: number;
        offset: number;
        renderedPacks?: Awaited<
          ReturnType<typeof fastify.renderedPackRepository.listBySourcePackIds>
        >;
      } = {
        items,
        total: packs.total,
        limit,
        offset,
      };

      if (packs.renderedPacks) {
        response.renderedPacks = packs.renderedPacks;
      }

      return response;
    },
  );

  server.get(
    '/packs/:id',
    {
      schema: {
        operationId: 'getContextPackById',
        tags: ['diary'],
        description:
          'Get a persisted context pack by ID. Use `expand=entries` to include entry content.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: PackParamsSchema,
        querystring: PackQuerySchema,
        response: {
          200: Type.Ref(ContextPackResponseSchema),
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

      const pack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canReadPack(
        pack.id,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to read this pack');
      }

      if (!wantsExpandedEntries(request.query.expand)) {
        return pack;
      }

      return {
        ...pack,
        entries: await fastify.contextPackRepository.listEntriesExpanded(
          pack.id,
        ),
      };
    },
  );

  server.post(
    '/diaries/:id/packs/preview',
    {
      schema: {
        operationId: 'previewDiaryCustomPack',
        tags: ['diary'],
        description:
          'Preview a custom context pack from an explicit entry selection without persisting it.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: DiaryParamsSchema,
        body: CustomPackBodySchema,
        response: {
          200: Type.Ref(CustomPackResultSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) =>
      materializeCustomPack(
        {
          params: request.params,
          body: request.body,
          authContext: request.authContext!,
        },
        false,
      ),
  );

  server.post(
    '/diaries/:id/packs',
    {
      schema: {
        operationId: 'createDiaryCustomPack',
        tags: ['diary'],
        description:
          'Create and persist a custom context pack from an explicit entry selection.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: DiaryParamsSchema,
        body: CustomPackBodySchema,
        response: {
          201: Type.Ref(CustomPackResultSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request, reply) => {
      const pack = await materializeCustomPack(
        {
          params: request.params,
          body: request.body,
          authContext: request.authContext!,
        },
        true,
      );

      return reply.code(201).send(pack);
    },
  );

  server.get(
    '/diaries/:id/packs',
    {
      schema: {
        operationId: 'listDiaryPacks',
        tags: ['diary'],
        description:
          'List persisted context packs for a diary. Use `expand=entries` to include entry content.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: DiaryParamsSchema,
        querystring: PackListQuerySchema,
        response: {
          200: Type.Ref(ContextPackResponseListSchema),
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

      let diary: Awaited<ReturnType<typeof fastify.diaryService.findDiary>>;
      try {
        diary = await fastify.diaryService.findDiary(
          request.params.id,
          identityId,
          subjectNs,
        );
      } catch (err) {
        if (err instanceof DiaryServiceError) translateFindDiaryError(err);
        throw err;
      }
      const limit = request.query.limit ?? 20;
      const offset = request.query.offset ?? 0;
      const { items: packs, total } =
        await fastify.contextPackRepository.listByDiary(
          diary.id,
          limit,
          offset,
        );
      let allowedPackIds: Map<string, boolean>;
      try {
        allowedPackIds = await fastify.permissionChecker.canReadPacks(
          packs.map((pack) => pack.id),
          identityId,
          subjectNs,
        );
      } catch (error) {
        request.log.error(
          { err: error, diaryId: diary.id },
          'Failed to batch-check pack permissions',
        );
        throw createProblem('internal', 'Failed to verify pack permissions');
      }
      const visiblePacks = packs.filter(
        (pack) => allowedPackIds.get(pack.id) ?? false,
      );
      // Adjust total to account for permission-filtered packs on this page.
      // Packs on other pages may also be denied, so this is a best-effort
      // lower bound — but far more useful than the raw DB count.
      const deniedOnPage = packs.length - visiblePacks.length;
      const adjustedTotal = total - deniedOnPage;

      if (!wantsExpandedEntries(request.query.expand)) {
        return toListResponse(visiblePacks, adjustedTotal, limit, offset);
      }

      const entriesByPack =
        await fastify.contextPackRepository.listEntriesExpandedByPackIds(
          visiblePacks.map((pack) => pack.id),
        );

      const items = visiblePacks.map((pack) => ({
        ...pack,
        entries: entriesByPack.get(pack.id) ?? [],
      }));

      return toListResponse(items, adjustedTotal, limit, offset);
    },
  );

  // ── PATCH /packs/:id ──────────────────────────────────────────

  server.patch(
    '/packs/:id',
    {
      schema: {
        operationId: 'updateContextPack',
        tags: ['diary'],
        description:
          'Update a context pack — pin/unpin or change expiration. Only the diary owner can manage packs.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: PackParamsSchema,
        body: PackUpdateBodySchema,
        response: {
          200: Type.Ref(ContextPackResponseSchema),
          400: Type.Ref(ProblemDetailsSchema),
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

      const pack = await fastify.contextPackRepository.findById(
        request.params.id,
      );
      if (!pack) {
        throw createProblem('not-found', 'Context pack not found');
      }

      const allowed = await fastify.permissionChecker.canManagePack(
        pack.id,
        identityId,
        subjectNs,
      );
      if (!allowed) {
        throw createProblem('forbidden', 'Not authorized to manage this pack');
      }

      const { pinned, expiresAt } = request.body;
      const now = new Date();

      // Defense in depth: schema-level `minProperties: 1` +
      // `additionalProperties: false` should reject empty or unknown-only
      // bodies, but Ajv's removeAdditional strips unknown keys before
      // minProperties is evaluated against the original data, so an
      // explicit guard here is the only reliable way to block silent no-ops.
      if (pinned === undefined && expiresAt === undefined) {
        throw createProblem(
          'validation-failed',
          'At least one of pinned or expiresAt must be provided',
        );
      }

      // Validate upfront before entering the transaction
      if (pinned === false && !expiresAt) {
        throw createProblem(
          'validation-failed',
          'expiresAt is required when setting pinned to false',
        );
      }
      if (
        expiresAt !== undefined &&
        pinned !== true &&
        new Date(expiresAt) <= now
      ) {
        throw createProblem(
          'validation-failed',
          'expiresAt must be in the future',
        );
      }
      if (pinned === undefined && expiresAt !== undefined && pack.pinned) {
        throw createProblem(
          'validation-failed',
          'Cannot set expiresAt on a pinned pack — unpin it first or send pinned: false together',
        );
      }

      // Mutate + re-fetch atomically to avoid race with GC
      const updated = await fastify.dataSource.runTransaction(async () => {
        if (pinned === true) {
          await fastify.contextPackRepository.pin(pack.id);
        } else if (pinned === false) {
          await fastify.contextPackRepository.unpin(
            pack.id,
            new Date(expiresAt!),
          );
        } else if (expiresAt !== undefined) {
          // updateExpiry filters on `pinned = false`. A concurrent pin between
          // the pre-check and this write produces a silent no-op — surface it
          // as a conflict rather than returning stale state.
          const result = await fastify.contextPackRepository.updateExpiry(
            pack.id,
            new Date(expiresAt),
          );
          if (!result) {
            throw createProblem(
              'conflict',
              'Pack state changed concurrently — retry the request',
            );
          }
        }

        return fastify.contextPackRepository.findById(pack.id);
      });

      if (!updated) {
        throw createProblem('not-found', 'Context pack not found');
      }
      return updated;
    },
  );
}
