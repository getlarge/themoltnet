import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth, type ShellCommandRule } from '@moltnet/auth';
import { UniqueViolationError } from '@moltnet/database';
import {
  ConflictProblemDetailsSchema,
  ProblemDetailsSchema,
  TeamHeaderRequiredSchema,
  ValidationProblemDetailsSchema,
} from '@moltnet/models';
import {
  createRuntimePolicyService,
  type RuntimePolicySubject,
} from '@moltnet/runtime-policy-service';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { type Static, Type } from 'typebox';

import { createConflictProblem } from '../problems/index.js';
import {
  AllowedToolsResponseSchema,
  CreateRuntimePolicyBodySchema,
  RuntimePolicyListSchema,
  RuntimePolicyWithToolsSchema,
  RuntimeProfilePoliciesResponseSchema,
  SetProfilePoliciesBodySchema,
  UpdateRuntimePolicyBodySchema,
} from '../schemas.js';
import { authContextToCreator } from '../utils/auth-principal.js';
import { requireCurrentTeamId } from '../utils/require-current-team-id.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

const PolicyParamsSchema = Type.Object(
  { policyId: Type.String({ format: 'uuid' }) },
  { $id: 'RuntimePolicyParams' },
);

const ProfileParamsSchema = Type.Object(
  { profileId: Type.String({ format: 'uuid' }) },
  { $id: 'RuntimePolicyProfileParams' },
);

const SECURITY: Array<Record<string, string[]>> = [
  { bearerAuth: [] },
  { sessionAuth: [] },
  { cookieAuth: [] },
];

function runtimePolicySubject(request: FastifyRequest): RuntimePolicySubject {
  const subject = requireKetoSubject(request);
  const creator = authContextToCreator(request);
  return {
    ...subject,
    creatorId: creator.id,
  };
}

export async function runtimePolicyRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  const policies = createRuntimePolicyService({
    runtimePolicyRepository: fastify.runtimePolicyRepository,
    runtimePolicySnapshotRepository: fastify.runtimePolicySnapshotRepository,
    relationshipReader: fastify.relationshipReader,
    relationshipWriter: fastify.relationshipWriter,
    permissionChecker: fastify.permissionChecker,
    transactionRunner: fastify.transactionRunner,
  });
  server.addHook('preHandler', requireAuth);

  server.post(
    '/runtime-policies',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'createRuntimePolicy',
        tags: ['runtime-policies'],
        description:
          'Create a team-scoped tool policy granting a set of tools.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        body: Type.Ref(CreateRuntimePolicyBodySchema.$id),
        response: {
          201: Type.Ref(RuntimePolicyWithToolsSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      const body = request.body as Static<typeof CreateRuntimePolicyBodySchema>;
      try {
        const policy = await policies.create({
          teamId,
          name: body.name,
          description: body.description,
          tools: body.tools ?? [],
          shellCommands: (body.shellCommands ?? []) as ShellCommandRule[],
          subject: runtimePolicySubject(request),
        });
        return await reply.status(201).send(policy);
      } catch (err) {
        if (err instanceof UniqueViolationError) {
          throw createConflictProblem(
            'A runtime policy with this name already exists in this team',
            { constraint: err.constraint, target: err.target },
          );
        }
        throw err;
      }
    },
  );

  server.get(
    '/runtime-policies',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listRuntimePolicies',
        tags: ['runtime-policies'],
        description: 'List tool policies for the active team.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        response: {
          200: Type.Ref(RuntimePolicyListSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      const items = await policies.list({
        teamId,
        subject: runtimePolicySubject(request),
      });
      return { items };
    },
  );

  server.get(
    '/runtime-policies/:policyId',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getRuntimePolicy',
        tags: ['runtime-policies'],
        description: 'Get one tool policy with its granted tools.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: PolicyParamsSchema,
        response: {
          200: Type.Ref(RuntimePolicyWithToolsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      return policies.get(request.params.policyId, {
        teamId,
        subject: runtimePolicySubject(request),
      });
    },
  );

  server.patch(
    '/runtime-policies/:policyId',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'updateRuntimePolicy',
        tags: ['runtime-policies'],
        description: 'Rename a policy and/or add/remove granted tools.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: PolicyParamsSchema,
        body: Type.Ref(UpdateRuntimePolicyBodySchema.$id),
        response: {
          200: Type.Ref(RuntimePolicyWithToolsSchema.$id),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ConflictProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      const body = request.body as Static<typeof UpdateRuntimePolicyBodySchema>;
      try {
        return await policies.update(
          request.params.policyId,
          {
            ...body,
            addShellCommands: body.addShellCommands as
              | ShellCommandRule[]
              | undefined,
            removeShellCommands: body.removeShellCommands as
              | ShellCommandRule[]
              | undefined,
          },
          {
            teamId,
            subject: runtimePolicySubject(request),
          },
        );
      } catch (err) {
        if (err instanceof UniqueViolationError) {
          throw createConflictProblem(
            'A runtime policy with this name already exists in this team',
            { constraint: err.constraint, target: err.target },
          );
        }
        throw err;
      }
    },
  );

  server.delete(
    '/runtime-policies/:policyId',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'deleteRuntimePolicy',
        tags: ['runtime-policies'],
        description: 'Delete a tool policy and its tool grants.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: PolicyParamsSchema,
        response: {
          204: Type.Null(),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      await policies.delete(request.params.policyId, {
        teamId,
        subject: runtimePolicySubject(request),
      });
      return reply.status(204).send(null);
    },
  );

  server.get(
    '/runtime-profiles/:profileId/policies',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getRuntimeProfilePolicies',
        tags: ['runtime-policies'],
        description: 'List the tool-policy IDs bound to a runtime profile.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: ProfileParamsSchema,
        response: {
          200: Type.Ref(RuntimeProfilePoliciesResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      return policies.getProfilePolicies(request.params.profileId, {
        teamId,
        subject: runtimePolicySubject(request),
      });
    },
  );

  server.put(
    '/runtime-profiles/:profileId/policies',
    {
      config: { auth: { credentialBindingScope: 'team' } },
      schema: {
        operationId: 'setRuntimeProfilePolicies',
        tags: ['runtime-policies'],
        description:
          'Replace the set of tool policies bound to a runtime profile.',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: ProfileParamsSchema,
        body: Type.Ref(SetProfilePoliciesBodySchema.$id),
        response: {
          204: Type.Null(),
          400: Type.Ref(ValidationProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      const body = request.body as Static<typeof SetProfilePoliciesBodySchema>;
      await policies.setProfilePolicies(
        request.params.profileId,
        body.policyIds,
        { teamId, subject: runtimePolicySubject(request) },
      );
      return reply.status(204).send(null);
    },
  );

  server.get(
    '/runtime-profiles/:profileId/allowed-tools',
    {
      config: {
        auth: { credentialBindingScope: 'team' },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getRuntimeProfileAllowedTools',
        tags: ['runtime-policies'],
        description:
          'Resolve a runtime profile enforcement mode and its allowed-tool set (union of bound policies).',
        security: SECURITY,
        headers: TeamHeaderRequiredSchema,
        params: ProfileParamsSchema,
        response: {
          200: Type.Ref(AllowedToolsResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request, 'runtime policies');
      return policies.resolveAllowedTools({
        profileId: request.params.profileId,
        teamId,
      });
    },
  );
}
