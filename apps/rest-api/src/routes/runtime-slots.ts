import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  BeginRuntimeSlotBody as BeginRuntimeSlotBodySchema,
  FindLatestRuntimeSlotForAttemptQuery as FindLatestRuntimeSlotForAttemptQuerySchema,
  FinishRuntimeSlotBody as FinishRuntimeSlotBodySchema,
  ListRuntimeSlotsQuery as ListRuntimeSlotsQuerySchema,
  ResolvedRuntimeSlot as ResolvedRuntimeSlotSchema,
  RuntimeSlot as RuntimeSlotSchema,
  RuntimeSlotListResponse as RuntimeSlotListResponseSchema,
} from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';

import { createProblem } from '../problems/index.js';
import {
  createRuntimeSlotService,
  serializeResolvedRuntimeSlot,
  serializeRuntimeSlot,
} from '../services/runtime-slots.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';

function authSubject(request: {
  authContext: {
    identityId: string;
    subjectType: 'agent' | 'human';
    currentTeamId: string | null;
  } | null;
}) {
  const auth = request.authContext;
  if (!auth) {
    throw createProblem('unauthorized', 'Authentication context missing');
  }
  return {
    identityId: auth.identityId,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
    subjectType: auth.subjectType,
  };
}

export async function runtimeSlotRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const runtimeSlots = createRuntimeSlotService({
    permissionChecker: fastify.permissionChecker,
    runtimeProfileRepository: fastify.runtimeProfileRepository,
    runtimeSlotRepository: fastify.runtimeSlotRepository,
    taskRepository: fastify.taskRepository,
  });

  server.addHook('preHandler', requireAuth);

  server.post(
    '/runtime-slots/begin',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'beginRuntimeSlot',
        tags: ['runtime-slots'],
        description:
          'Upsert a team-scoped runtime slot for audit and continuation affinity lookup.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: BeginRuntimeSlotBodySchema,
        response: {
          200: RuntimeSlotSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ConflictProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Runtime slots can only be written by agents',
        );
      }
      const body = request.body;
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      const slot = await runtimeSlots.begin({
        body,
        identityId,
        subjectNs,
        teamId,
      });
      return serializeRuntimeSlot(slot);
    },
  );

  server.post(
    '/runtime-slots/finish',
    {
      config: { auth: { talosCredentialScope: 'team' } },
      schema: {
        operationId: 'finishRuntimeSlot',
        tags: ['runtime-slots'],
        description:
          'Mark a team-scoped runtime slot idle without deleting it.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        body: FinishRuntimeSlotBodySchema,
        response: {
          200: RuntimeSlotSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
          409: ConflictProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs, subjectType } = authSubject(request);
      if (subjectType !== 'agent') {
        throw createProblem(
          'forbidden',
          'Runtime slots can only be written by agents',
        );
      }
      const body = request.body;
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      const slot = await runtimeSlots.finish({
        body,
        identityId,
        subjectNs,
        teamId,
      });
      return serializeRuntimeSlot(slot);
    },
  );

  server.get(
    '/runtime-slots',
    {
      config: {
        auth: { talosCredentialScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listRuntimeSlots',
        tags: ['runtime-slots'],
        description: 'List recent team-scoped runtime slots for repair/sync.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: ListRuntimeSlotsQuerySchema,
        response: {
          200: RuntimeSlotListResponseSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      const items = await runtimeSlots.list({
        identityId,
        query: request.query,
        subjectNs,
        teamId,
      });
      return { items: items.map(serializeResolvedRuntimeSlot) };
    },
  );

  server.get(
    '/runtime-slots/latest',
    {
      config: {
        auth: { talosCredentialScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'findLatestRuntimeSlotForAttempt',
        tags: ['runtime-slots'],
        description:
          'Find the latest team-scoped runtime slot for a task attempt.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderRequiredSchema,
        querystring: FindLatestRuntimeSlotForAttemptQuerySchema,
        response: {
          200: ResolvedRuntimeSlotSchema,
          400: ValidationProblemDetailsSchema,
          401: ProblemDetailsSchema,
          403: ProblemDetailsSchema,
          404: ProblemDetailsSchema,
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      const teamId = requireCurrentTeamId(request, 'runtime slots');
      const resolved = await runtimeSlots.findLatest({
        identityId,
        query: request.query,
        subjectNs,
        teamId,
      });
      return serializeResolvedRuntimeSlot(resolved);
    },
  );
}
