import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, TEAM_HEADER } from '@moltnet/auth';
import { computeJsonCid } from '@moltnet/crypto-service';
import type { DaemonProfile as RuntimeProfile } from '@moltnet/database';
import {
  ProblemDetailsSchema,
  TeamHeaderOptionalSchema,
} from '@moltnet/models';
import { RuntimeProfile as RuntimeProfileSchema } from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import { createProblem, isUniqueViolation } from '../problems/index.js';
import {
  CreateRuntimeProfileBodySchema,
  RuntimeProfileListResponseSchema,
  UpdateRuntimeProfileBodySchema,
} from '../schemas.js';
import { authContextToCreator } from '../utils/auth-principal.js';


const ProfileParamsSchema = Type.Object(
  { profileId: Type.String({ format: 'uuid' }) },
  { $id: 'RuntimeProfileParams' },
);

function authSubject(request: {
  authContext: {
    identityId: string;
    subjectType: 'agent' | 'human';
    currentTeamId: string | null;
  } | null;
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

function requireCurrentTeamId(request: {
  authContext: { currentTeamId: string | null } | null;
}): string {
  const teamId = request.authContext?.currentTeamId;
  if (!teamId) {
    throw createProblem(
      'validation-failed',
      `${TEAM_HEADER} header is required: runtime profiles are team-scoped`,
    );
  }
  return teamId;
}

function normalizeList(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((v) => v.trim()).filter(Boolean))];
}

function serializeProfile(
  row: RuntimeProfile,
): Static<typeof RuntimeProfileSchema> {
  return {
    id: row.id,
    teamId: row.teamId,
    name: row.name,
    description: row.description ?? null,
    provider: row.provider,
    model: row.model,
    runtimeKind: 'gondolin_pi',
    sandbox: row.sandbox as Record<string, unknown>,
    sessionStorageMode: 'local',
    workspaceStorageMode: 'local',
    sessionTtlSec: row.sessionTtlSec,
    workspaceTtlSec: row.workspaceTtlSec,
    leaseTtlSec: row.leaseTtlSec,
    heartbeatIntervalMs: row.heartbeatIntervalMs,
    maxBatchSize: row.maxBatchSize,
    requiredEnv: row.requiredEnv,
    requiredTools: row.requiredTools,
    context: row.context as Static<typeof RuntimeProfileSchema>['context'],
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
  leaseTtlSec?: number;
  heartbeatIntervalMs?: number;
  maxBatchSize?: number;
  requiredEnv?: string[];
  requiredTools?: string[];
  context?: unknown[];
};

async function computeProfileDefinitionCid(
  input: ProfileDefinitionInput,
): Promise<string> {
  return computeJsonCid({
    v: 'moltnet:runtime-profile:v1',
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
    leaseTtlSec: input.leaseTtlSec ?? 300,
    heartbeatIntervalMs: input.heartbeatIntervalMs ?? 60_000,
    maxBatchSize: input.maxBatchSize ?? 50,
    requiredEnv: normalizeList(input.requiredEnv).sort(),
    requiredTools: normalizeList(input.requiredTools).sort(),
    context: input.context ?? [],
  });
}

export async function runtimeProfileRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.get(
    '/runtime-profiles',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listRuntimeProfiles',
        tags: ['runtime-profiles'],
        description: 'List runtime profiles for the active team context.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        response: {
          200: Type.Ref(RuntimeProfileListResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = requireCurrentTeamId(request);
      const { identityId, subjectNs } = authSubject(request);
      const canAccess = await fastify.permissionChecker.canAccessTeam(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canAccess) throw createProblem('not-found');
      const rows = await fastify.daemonProfileRepository.listByTeamId(teamId);
      return { items: rows.map(serializeProfile) };
    },
  );

  server.post(
    '/runtime-profiles',
    {
      schema: {
        operationId: 'createRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Create a runtime profile for the active team context.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        body: Type.Ref(CreateRuntimeProfileBodySchema.$id),
        response: {
          201: Type.Ref(RuntimeProfileSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = requireCurrentTeamId(request);
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeam(
        teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      const team = await fastify.teamRepository.findById(teamId);
      if (!team) throw createProblem('not-found');
      const creator = authContextToCreator(request);
      const body = request.body as Static<typeof CreateRuntimeProfileBodySchema>;
      const definitionCid = await computeProfileDefinitionCid(body);
      try {
        const row = await fastify.daemonProfileRepository.create({
          teamId,
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
          leaseTtlSec: body.leaseTtlSec ?? 300,
          heartbeatIntervalMs: body.heartbeatIntervalMs ?? 60_000,
          maxBatchSize: body.maxBatchSize ?? 50,
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
            'A runtime profile with this name already exists in this team',
          );
        }
        throw err;
      }
    },
  );

  server.get(
    '/runtime-profiles/:profileId',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'getRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Get one runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        response: {
          200: Type.Ref(RuntimeProfileSchema.$id),
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
    '/runtime-profiles/:profileId',
    {
      schema: {
        operationId: 'updateRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Update one runtime profile.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: ProfileParamsSchema,
        body: Type.Ref(UpdateRuntimeProfileBodySchema.$id),
        response: {
          200: Type.Ref(RuntimeProfileSchema.$id),
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
      const body = request.body as Static<typeof UpdateRuntimeProfileBodySchema>;
      const next: ProfileDefinitionInput = {
        name: body.name ?? existing.name,
        description:
          'description' in body
            ? (body.description ?? null)
            : existing.description,
        provider: (body.provider ?? existing.provider).toLowerCase(),
        model: (body.model ?? existing.model).toLowerCase(),
        runtimeKind: body.runtimeKind ?? 'gondolin_pi',
        sandbox: body.sandbox ?? existing.sandbox,
        sessionStorageMode: body.sessionStorageMode ?? 'local',
        workspaceStorageMode: body.workspaceStorageMode ?? 'local',
        sessionTtlSec: body.sessionTtlSec ?? existing.sessionTtlSec,
        workspaceTtlSec: body.workspaceTtlSec ?? existing.workspaceTtlSec,
        leaseTtlSec: body.leaseTtlSec ?? existing.leaseTtlSec,
        heartbeatIntervalMs:
          body.heartbeatIntervalMs ?? existing.heartbeatIntervalMs,
        maxBatchSize: body.maxBatchSize ?? existing.maxBatchSize,
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
            'A runtime profile with this name already exists in this team',
          );
        }
        throw err;
      }
    },
  );

  server.delete(
    '/runtime-profiles/:profileId',
    {
      schema: {
        operationId: 'deleteRuntimeProfile',
        tags: ['runtime-profiles'],
        description: 'Delete one runtime profile.',
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
