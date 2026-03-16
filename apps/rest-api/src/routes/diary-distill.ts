/**
 * Diary distill routes — reflect, consolidate, compile
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import { DiaryParamsSchema, ProblemDetailsSchema } from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  CompileResultSchema,
  ConsolidateResultSchema,
  DigestSchema,
} from '../schemas.js';
import { contextDistillWorkflows } from '../workflows/context-distill-workflows.js';
import { runWorkflow } from '../workflows/run-workflow.js';

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

export async function diaryDistillRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

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

  // ── Consolidate ────────────────────────────────────────────────
  server.post(
    '/diaries/:id/consolidate',
    {
      schema: {
        operationId: 'consolidateDiary',
        tags: ['diary'],
        description:
          'Cluster semantically similar entries and return consolidation suggestions.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: Type.Object({
          entryIds: Type.Optional(
            Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 }),
          ),
          tags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          excludeTags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          threshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          strategy: Type.Optional(
            Type.Union([
              Type.Literal('score'),
              Type.Literal('centroid'),
              Type.Literal('hybrid'),
            ]),
          ),
        }),
        response: {
          200: Type.Ref(ConsolidateResultSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id: diaryId } = request.params;
      const identityId = request.authContext!.identityId;
      const { entryIds, tags, excludeTags, threshold, strategy } = request.body;

      try {
        await fastify.diaryService.findDiary(diaryId, identityId);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
      // TODO: create custom permission to distill const allowed = await permissionChecker.canDistillDiary(diaryId, agentId);

      return runWorkflow(
        contextDistillWorkflows.consolidate,
        {
          queueName: 'context.consolidate',
          enqueueOptions: { queuePartitionKey: identityId },
          logger: request.log,
        },
        {
          diaryId,
          identityId,
          entryIds,
          tags,
          excludeTags,
          threshold,
          strategy,
        },
      );
    },
  );

  // ── Compile ────────────────────────────────────────────────────
  server.post(
    '/diaries/:id/compile',
    {
      schema: {
        operationId: 'compileDiary',
        tags: ['diary'],
        description:
          'Compile a token-budget-fitted context pack from diary entries.',
        security: [{ bearerAuth: [] }],
        params: DiaryParamsSchema,
        body: Type.Object({
          tokenBudget: Type.Integer({ minimum: 1, maximum: 100000 }),
          taskPrompt: Type.Optional(
            Type.String({ minLength: 1, maxLength: 2000 }),
          ),
          lambda: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          includeTags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          excludeTags: Type.Optional(
            Type.Array(Type.String({ maxLength: 50 }), { maxItems: 20 }),
          ),
          wRecency: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          wImportance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        }),
        response: {
          200: Type.Ref(CompileResultSchema),
          400: Type.Ref(ProblemDetailsSchema),
          401: Type.Ref(ProblemDetailsSchema),
          403: Type.Ref(ProblemDetailsSchema),
          404: Type.Ref(ProblemDetailsSchema),
          500: Type.Ref(ProblemDetailsSchema),
        },
      },
    },
    async (request) => {
      const { id: diaryId } = request.params;
      const identityId = request.authContext!.identityId;
      const {
        tokenBudget,
        taskPrompt,
        lambda,
        includeTags,
        excludeTags,
        wRecency,
        wImportance,
      } = request.body;

      try {
        await fastify.diaryService.findDiary(diaryId, identityId);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
      // TODO: create custom permission to distill; const allowed = await permissionChecker.canDistillDiary(diaryId, agentId);

      const result = await runWorkflow(
        contextDistillWorkflows.compile,
        {
          queueName: 'context.compile',
          enqueueOptions: { queuePartitionKey: identityId },
          logger: request.log,
        },
        {
          diaryId,
          identityId,
          taskPrompt,
          tokenBudget,
          lambda,
          includeTags,
          excludeTags,
          wRecency,
          wImportance,
        },
      );

      return {
        ...result.pack,
        entries: result.packEntries,
        compileStats: result.compileResult.stats,
        compileTrace: result.compileResult.trace,
      };
    },
  );
}
