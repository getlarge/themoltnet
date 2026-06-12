import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import type { DaemonProfile } from '@moltnet/database';
import { ProblemDetailsSchema } from '@moltnet/models';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import { createProblem, isUniqueViolation } from '../problems/index.js';
import {
  CreateDaemonProfileBodySchema,
  DaemonProfileListResponseSchema,
  DaemonProfileSchema,
  UpdateDaemonProfileBodySchema,
} from '../schemas.js';
import { authContextToCreator } from '../utils/auth-principal.js';

type CreateDaemonProfileBody = Static<typeof CreateDaemonProfileBodySchema>;
type UpdateDaemonProfileBody = Static<typeof UpdateDaemonProfileBodySchema>;

const ProfileParamsSchema = Type.Object(
  { profileId: Type.String({ format: 'uuid' }) },
  { $id: 'DaemonProfileParams' },
);

const TeamParamsSchema = Type.Object(
  { id: Type.String({ format: 'uuid' }) },
  { $id: 'DaemonProfileTeamParams' },
);

function authSubject(request: {
  authContext: { identityId: string; subjectType: 'agent' | 'human' } | null;
}) {
  const auth = request.authContext;
  if (!auth)
    throw createProblem('unauthorized', 'Authentication context missing');
  return {
    identityId: auth.identityId,
    subjectNs:
      auth.subjectType === 'human' ? KetoNamespace.Human : KetoNamespace.Agent,
  };
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

function serializeProfile(row: DaemonProfile) {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description ?? null,
    provider: row.provider,
    model: row.model,
    runtimeKind: row.runtimeKind,
    sandbox: row.sandbox as Record<string, unknown>,
    sessionStorageMode: row.sessionStorageMode,
    workspaceStorageMode: row.workspaceStorageMode,
    sessionTtlSec: row.sessionTtlSec,
    workspaceTtlSec: row.workspaceTtlSec,
    requiredEnv: row.requiredEnv,
    requiredTools: row.requiredTools,
    context: row.context as unknown[],
    revision: row.revision,
    definitionCid: row.definitionCid,
    createdByAgentId: row.createdByAgentId ?? null,
    createdByHumanId: row.createdByHumanId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ProfileDefinitionInput = {
  name: string;
  description?: string | null;
  provider: string;
  model: string;
  runtimeKind?: 'gondolin_pi';
  sandbox: unknown;
  sessionStorageMode?: 'local';
  workspaceStorageMode?: 'local';
  sessionTtlSec?: number;
  workspaceTtlSec?: number;
  requiredEnv?: string[];
  requiredTools?: string[];
  context?: unknown[];
};

async function computeProfileDefinitionCid(
  input: ProfileDefinitionInput,
): Promise<string> {
  return computeJsonCid({
    v: 'moltnet:daemon-profile:v1',
    name: input.name,
    description: input.description ?? null,
    provider: input.provider.toLowerCase(),
    model: input.model.toLowerCase(),
    runtimeKind: input.runtimeKind ?? 'gondolin_pi',
    sandbox: input.sandbox,
    sessionStorageMode: input.sessionStorageMode ?? 'local',
    workspaceStorageMode: input.workspaceStorageMode ?? 'local',
    sessionTtlSec: input.sessionTtlSec ?? 1800,
    workspaceTtlSec: input.workspaceTtlSec ?? 1800,
    requiredEnv: normalizeList(input.requiredEnv).sort(),
    requiredTools: normalizeList(input.requiredTools).sort(),
    context: input.context ?? [],
  });
}

export async function daemonProfileRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.get(
    '/teams/:id/daemon-profiles',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listDaemonProfiles',
        tags: ['daemon-profiles'],
        description: 'List daemon runtime profiles for a team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        response: {
          200: Type.Ref(DaemonProfileListResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const { identityId, subjectNs } = authSubject(request);
      const canAccess = await fastify.permissionChecker.canAccessTeam(
        request.params.id,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');
      const rows = await fastify.daemonProfileRepository.listByTeamId(
        request.params.id,
      );
      return { items: rows.map(serializeProfile) };
    },
  );

  server.post(
    '/teams/:id/daemon-profiles',
    {
      schema: {
        operationId: 'createDaemonProfile',
        tags: ['daemon-profiles'],
        description: 'Create a daemon runtime profile for a team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: TeamParamsSchema,
        body: Type.Ref(CreateDaemonProfileBodySchema.$id),
        response: {
          201: Type.Ref(DaemonProfileSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeam(
        request.params.id,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      const team = await fastify.teamRepository.findById(request.params.id);
      if (!team) throw createProblem('not-found');
      const creator = authContextToCreator(request);
      const body = request.body as CreateDaemonProfileBody;
      const definitionCid = await computeProfileDefinitionCid(body);
      try {
        const row = await fastify.daemonProfileRepository.create({
          teamId: request.params.id,
          name: body.name,
          description: body.description ?? null,
          provider: body.provider.toLowerCase(),
          model: body.model.toLowerCase(),
          runtimeKind: body.runtimeKind ?? 'gondolin_pi',
          sandbox: body.sandbox,
          sessionStorageMode: body.sessionStorageMode ?? 'local',
          workspaceStorageMode: body.workspaceStorageMode ?? 'local',
          sessionTtlSec: body.sessionTtlSec ?? 1800,
          workspaceTtlSec: body.workspaceTtlSec ?? 1800,
          requiredEnv: normalizeList(body.requiredEnv),
          requiredTools: normalizeList(body.requiredTools),
          context: body.context ?? [],
          definitionCid,
          createdByAgentId: creator.kind === 'agent' ? creator.id : null,
          createdByHumanId: creator.kind === 'human' ? creator.id : null,
        });
        return await reply.status(201).send(serializeProfile(row));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw createProblem(
            'conflict',
            'A daemon profile with this name already exists in this team',
          );
        }
        throw err;
      }
    },
  );

  server.get(
    '/daemon-profiles/:profileId',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'getDaemonProfile',
        tags: ['daemon-profiles'],
        description: 'Get one daemon runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        response: {
          200: Type.Ref(DaemonProfileSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const row = await fastify.daemonProfileRepository.findById(
        request.params.profileId,
      );
      if (!row) throw createProblem('not-found');
      const { identityId, subjectNs } = authSubject(request);
      const canAccess = await fastify.permissionChecker.canAccessTeam(
        row.teamId,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');
      return serializeProfile(row);
    },
  );

  server.patch(
    '/daemon-profiles/:profileId',
    {
      schema: {
        operationId: 'updateDaemonProfile',
        tags: ['daemon-profiles'],
        description: 'Update one daemon runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        body: Type.Ref(UpdateDaemonProfileBodySchema.$id),
        response: {
          200: Type.Ref(DaemonProfileSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const existing = await fastify.daemonProfileRepository.findById(
        request.params.profileId,
      );
      if (!existing) throw createProblem('not-found');
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeam(
        existing.teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      const body = request.body as UpdateDaemonProfileBody;
      const next: ProfileDefinitionInput = {
        name: body.name ?? existing.name,
        description:
          'description' in body
            ? (body.description ?? null)
            : existing.description,
        provider: (body.provider ?? existing.provider).toLowerCase(),
        model: (body.model ?? existing.model).toLowerCase(),
        runtimeKind: body.runtimeKind ?? existing.runtimeKind,
        sandbox: body.sandbox ?? existing.sandbox,
        sessionStorageMode:
          body.sessionStorageMode ?? existing.sessionStorageMode,
        workspaceStorageMode:
          body.workspaceStorageMode ?? existing.workspaceStorageMode,
        sessionTtlSec: body.sessionTtlSec ?? existing.sessionTtlSec,
        workspaceTtlSec: body.workspaceTtlSec ?? existing.workspaceTtlSec,
        requiredEnv: normalizeList(body.requiredEnv ?? existing.requiredEnv),
        requiredTools: normalizeList(
          body.requiredTools ?? existing.requiredTools,
        ),
        context: body.context ?? (existing.context as unknown[]),
      };
      const definitionCid = await computeProfileDefinitionCid(next);
      try {
        const row = await fastify.daemonProfileRepository.update(existing.id, {
          ...next,
          definitionCid,
        });
        if (!row) throw createProblem('not-found');
        return serializeProfile(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw createProblem(
            'conflict',
            'A daemon profile with this name already exists in this team',
          );
        }
        throw err;
      }
    },
  );

  server.delete(
    '/daemon-profiles/:profileId',
    {
      schema: {
        operationId: 'deleteDaemonProfile',
        tags: ['daemon-profiles'],
        description: 'Delete one daemon runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        response: {
          204: { type: 'null' },
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const row = await fastify.daemonProfileRepository.findById(
        request.params.profileId,
      );
      if (!row) throw createProblem('not-found');
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeam(
        row.teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      await fastify.daemonProfileRepository.delete(row.id);
      return reply.status(204).send(null);
    },
  );
}
