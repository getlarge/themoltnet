/**
 * Diary distill routes — consolidate, compile
 */

import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  DIARY_TAG_MAX_LENGTH,
  DiaryParamsSchema,
  entryTypeLiterals,
  ProblemDetailsSchema,
} from '@moltnet/models';
import { Type } from '@sinclair/typebox';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import { CompileResultSchema, ConsolidateResultSchema } from '../schemas.js';
import {
  authContextToCreator,
  rowToResponseWithCreator,
} from '../utils/auth-principal.js';
import {
  CompileWorkflowError,
  contextDistillWorkflows,
} from '../workflows/context-distill-workflows.js';
import { runWorkflow } from '../workflows/run-workflow.js';

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
      throw createProblem('internal-server-error', err.message);
  }
}

export async function diaryDistillRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  // ── Consolidate ────────────────────────────────────────────────
  server.post(
    '/diaries/:id/consolidate',
    {
      schema: {
        operationId: 'consolidateDiary',
        tags: ['diary'],
        deprecated: true,
        description:
          '[DEPRECATED] Server-side consolidation is obsolete. Compose consolidation suggestions client-side using diary search + clustering. Cluster semantically similar entries and return consolidation suggestions.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: DiaryParamsSchema,
        body: Type.Object({
          entryIds: Type.Optional(
            Type.Array(Type.String({ format: 'uuid' }), { maxItems: 500 }),
          ),
          tags: Type.Optional(
            Type.Array(Type.String({ maxLength: DIARY_TAG_MAX_LENGTH }), {
              maxItems: 20,
            }),
          ),
          excludeTags: Type.Optional(
            Type.Array(Type.String({ maxLength: DIARY_TAG_MAX_LENGTH }), {
              maxItems: 20,
            }),
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
          400: Type.Ref(ProblemDetailsSchema),
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
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const { entryIds, tags, excludeTags, threshold, strategy } = request.body;

      try {
        await fastify.diaryService.findDiary(diaryId, identityId, subjectNs);
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
        deprecated: true,
        description:
          '[DEPRECATED] Server-side compilation is obsolete. Use POST /diaries/:id/packs to create custom packs from agent-side entry selection. Compile a token-budget-fitted context pack from diary entries.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: DiaryParamsSchema,
        body: Type.Object({
          tokenBudget: Type.Integer({ minimum: 1, maximum: 100000 }),
          taskPrompt: Type.Optional(
            Type.String({ minLength: 1, maxLength: 2000 }),
          ),
          lambda: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          includeTags: Type.Optional(
            Type.Array(Type.String({ maxLength: DIARY_TAG_MAX_LENGTH }), {
              maxItems: 20,
            }),
          ),
          excludeTags: Type.Optional(
            Type.Array(Type.String({ maxLength: DIARY_TAG_MAX_LENGTH }), {
              maxItems: 20,
            }),
          ),
          wRecency: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          wImportance: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
          createdBefore: Type.Optional(Type.String({ format: 'date-time' })),
          createdAfter: Type.Optional(Type.String({ format: 'date-time' })),
          entryTypes: Type.Optional(
            Type.Array(Type.Union(entryTypeLiterals), { maxItems: 6 }),
          ),
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
      const { identityId, subjectType } = request.authContext!;
      const subjectNs =
        subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent;
      const {
        tokenBudget,
        taskPrompt,
        lambda,
        includeTags,
        excludeTags,
        wRecency,
        wImportance,
        createdBefore,
        createdAfter,
        entryTypes,
      } = request.body;

      try {
        await fastify.diaryService.findDiary(diaryId, identityId, subjectNs);
      } catch (err) {
        if (err instanceof DiaryServiceError) translateServiceError(err);
        throw err;
      }
      // TODO: create custom permission to distill; const allowed = await permissionChecker.canDistillDiary(diaryId, agentId);

      const compileCreator = authContextToCreator(request);
      let result;
      try {
        result = await runWorkflow(
          contextDistillWorkflows.compile,
          {
            queueName: 'context.compile',
            enqueueOptions: { queuePartitionKey: identityId },
            logger: request.log,
          },
          {
            diaryId,
            identityId,
            creator: compileCreator,
            taskPrompt,
            tokenBudget,
            lambda,
            includeTags,
            excludeTags,
            wRecency,
            wImportance,
            createdBefore,
            createdAfter,
            entryTypes,
          },
        );
      } catch (err) {
        if (err instanceof CompileWorkflowError) {
          throw createProblem('validation-failed', err.message);
        }
        throw err;
      }

      return {
        ...(await rowToResponseWithCreator(result.pack, fastify)),
        entries: result.packEntries,
        compileStats: result.compileResult.stats,
        compileTrace: result.compileResult.trace,
      };
    },
  );
}
