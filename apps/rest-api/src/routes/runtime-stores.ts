import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
} from '@moltnet/models';
import {
  AppendRuntimeStoreCommit,
  RuntimeStoreAttemptQuery,
  RuntimeStoreAttemptResponse,
  RuntimeStoreAuthority,
  RuntimeStoreCommitPage,
  RuntimeStoreCommitReceipt,
  RuntimeStoreHandle,
  RuntimeStoreIdAllocation,
  RuntimeStoreParams,
  RuntimeStoreReadQuery,
  RuntimeStoreWriter,
} from '@moltnet/runtime-profiles';
import { createRuntimeStoreService } from '@moltnet/runtime-session-service';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { PRINCIPAL_AUTH_SECURITY } from '../openapi-security.js';
import { createProblem } from '../problems/index.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

export async function runtimeStoreRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const service = createRuntimeStoreService({
    repository: fastify.runtimeSessionRepository.durable,
    taskRepository: fastify.taskRepository,
    transactionRunner: fastify.transactionRunner,
    storage: fastify.runtimeSessionStorage,
    permissionChecker: fastify.permissionChecker,
    maxBytes: Math.min(fastify.runtimeSessionMaxBytes, 1024 * 1024),
  });
  const config = {
    rateLimitBucket: 'runtime-store',
    rateLimit: fastify.rateLimitConfig.runtimeStore,
    auth: {
      credentialBindingScope: 'team' as const,
      requiredScopes: ['task:execute'] as const,
    },
  };
  const common = {
    tags: ['runtime-sessions'],
    security: PRINCIPAL_AUTH_SECURITY,
    headers: TeamHeaderRequiredSchema,
  };
  const errors = {
    400: Type.Ref(ProblemDetailsSchema.$id),
    401: Type.Ref(ProblemDetailsSchema.$id),
    403: Type.Ref(ProblemDetailsSchema.$id),
    404: Type.Ref(ProblemDetailsSchema.$id),
    409: Type.Ref(ProblemDetailsSchema.$id),
    503: Type.Ref(ProblemDetailsSchema.$id),
  };
  const subject = (request: FastifyRequest) => ({
    ...requireKetoSubject(request),
    teamId: requireCurrentTeamId(request, 'runtime stores'),
  });
  const agent = (request: FastifyRequest) => {
    const value = subject(request);
    if (value.subjectType !== 'agent')
      throw createProblem('forbidden', 'Only agents may write runtime stores');
    return value;
  };
  server.get(
    '/runtime-stores/attempt',
    {
      config,
      schema: {
        ...common,
        operationId: 'getRuntimeStoreForAttempt',
        querystring: RuntimeStoreAttemptQuery,
        response: { ...errors, 200: RuntimeStoreAttemptResponse },
      },
    },
    (request) => service.findAttempt({ ...request.query, ...subject(request) }),
  );
  server.post(
    '/runtime-stores/open',
    {
      config,
      schema: {
        ...common,
        operationId: 'openRuntimeStore',
        body: RuntimeStoreAuthority,
        response: { ...errors, 200: RuntimeStoreHandle },
      },
    },
    (request) => service.open({ ...request.body, ...agent(request) }),
  );
  server.post(
    '/runtime-stores/:storeId/renew',
    {
      config,
      schema: {
        ...common,
        operationId: 'renewRuntimeStore',
        params: RuntimeStoreParams,
        body: RuntimeStoreWriter,
        response: { ...errors, 200: RuntimeStoreHandle },
      },
    },
    (request) =>
      service.renew({ ...request.body, ...request.params, ...agent(request) }),
  );
  server.post(
    '/runtime-stores/:storeId/release',
    {
      config,
      schema: {
        ...common,
        operationId: 'releaseRuntimeStore',
        params: RuntimeStoreParams,
        body: RuntimeStoreWriter,
        response: { ...errors, 204: { type: 'null' } },
      },
    },
    async (request, reply) => {
      await service.release({
        ...request.body,
        ...request.params,
        ...agent(request),
      });
      return reply.code(204).send();
    },
  );
  server.post(
    '/runtime-stores/:storeId/ids',
    {
      config,
      schema: {
        ...common,
        operationId: 'mintRuntimeStoreId',
        params: RuntimeStoreParams,
        body: RuntimeStoreWriter,
        response: { ...errors, 200: RuntimeStoreIdAllocation },
      },
    },
    async (request) => ({
      id: await service.mintId({
        ...request.body,
        ...request.params,
        ...agent(request),
      }),
    }),
  );
  server.post(
    '/runtime-stores/:storeId/commits',
    {
      config,
      schema: {
        ...common,
        operationId: 'appendRuntimeStoreCommit',
        params: RuntimeStoreParams,
        body: AppendRuntimeStoreCommit,
        response: { ...errors, 200: RuntimeStoreCommitReceipt },
      },
    },
    (request) =>
      service.append({ ...request.body, ...request.params, ...agent(request) }),
  );
  server.get(
    '/runtime-stores/:storeId/commits',
    {
      config,
      schema: {
        ...common,
        operationId: 'listRuntimeStoreCommits',
        params: RuntimeStoreParams,
        querystring: RuntimeStoreReadQuery,
        response: { ...errors, 200: RuntimeStoreCommitPage },
      },
    },
    (request) =>
      service.read({
        ...request.query,
        ...request.params,
        ...subject(request),
      }),
  );
}
