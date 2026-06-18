import { type TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { KetoNamespace, requireAuth, TEAM_HEADER } from '@moltnet/auth';
import type { RuntimeModel } from '@moltnet/database';
import {
  ProblemDetailsSchema,
  TeamHeaderOptionalSchema,
} from '@moltnet/models';
import { RuntimeModel as RuntimeModelSchema } from '@moltnet/tasks';
import type { FastifyInstance } from 'fastify';
import { type Static, Type } from 'typebox';

import { createProblem, isUniqueViolation } from '../problems/index.js';
import {
  CreateRuntimeModelBodySchema,
  RuntimeModelListResponseSchema,
  RuntimeModelParamsSchema,
  UpdateRuntimeModelBodySchema,
} from '../schemas.js';
import { authContextToCreator } from '../utils/auth-principal.js';

type CreateRuntimeModelBody = Static<typeof CreateRuntimeModelBodySchema>;
type UpdateRuntimeModelBody = Static<typeof UpdateRuntimeModelBodySchema>;

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

/**
 * `x-moltnet-team-id` is optional for the catalog: without it, only global
 * entries are returned. With it, team-scoped entries for that team are
 * appended. This keeps the autocomplete feed useful for callers that don't
 * have a team context yet (operator endpoints, MCP, etc.).
 */
function optionalTeamId(request: {
  authContext: { currentTeamId: string | null } | null;
}): string | undefined {
  return request.authContext?.currentTeamId ?? undefined;
}

function serializeModel(row: RuntimeModel): Static<typeof RuntimeModelSchema> {
  return {
    id: row.id,
    teamId: row.teamId,
    provider: row.provider,
    model: row.model,
    displayName: row.displayName ?? null,
    description: row.description ?? null,
    capabilities:
      (row.capabilities as Static<typeof RuntimeModelSchema>['capabilities']) ??
      {},
    isActive: row.isActive,
    createdByAgentId: row.createdByAgentId ?? null,
    createdByHumanId: row.createdByHumanId ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function runtimeModelRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);

  server.get(
    '/runtime-models',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'listRuntimeModels',
        tags: ['runtime-models'],
        description:
          'List runtime model catalog entries visible to the caller. Global entries are always included; team-scoped entries are appended when `x-moltnet-team-id` is set. Supports `?provider=<id>` for autocomplete narrowing.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        querystring: Type.Object(
          {
            provider: Type.Optional(
              Type.String({ minLength: 1, maxLength: 100 }),
            ),
          },
          { additionalProperties: false },
        ),
        response: {
          200: Type.Ref(RuntimeModelListResponseSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const teamId = optionalTeamId(request);
      const rows = await fastify.runtimeModelRepository.listVisible({
        teamId,
        provider: request.query.provider,
      });
      return { items: rows.map(serializeModel) };
    },
  );

  server.post(
    '/runtime-models',
    {
      schema: {
        operationId: 'createRuntimeModel',
        tags: ['runtime-models'],
        description:
          'Create a team-scoped runtime model catalog entry. Requires `x-moltnet-team-id` and `canManageTeam` on the active team.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        headers: TeamHeaderOptionalSchema,
        body: Type.Ref(CreateRuntimeModelBodySchema.$id),
        response: {
          201: Type.Ref(RuntimeModelSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const teamId = optionalTeamId(request);
      if (!teamId) {
        throw createProblem(
          'validation-failed',
          `${TEAM_HEADER} header is required: runtime model creation is team-scoped`,
        );
      }
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
      const body = request.body as CreateRuntimeModelBody;
      try {
        const row = await fastify.runtimeModelRepository.create({
          teamId,
          provider: body.provider.toLowerCase(),
          model: body.model.toLowerCase(),
          displayName: body.displayName ?? null,
          description: body.description ?? null,
          capabilities: body.capabilities ?? {},
          isActive: true,
          createdByAgentId: creator.kind === 'agent' ? creator.id : null,
          createdByHumanId: creator.kind === 'human' ? creator.id : null,
        });
        return await reply.status(201).send(serializeModel(row));
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw createProblem(
            'conflict',
            'A runtime model entry with this (provider, model) already exists for this team',
          );
        }
        throw err;
      }
    },
  );

  server.get(
    '/runtime-models/:entryId',
    {
      config: { rateLimit: fastify.rateLimitConfig.read },
      schema: {
        operationId: 'getRuntimeModel',
        tags: ['runtime-models'],
        description: 'Get one runtime model catalog entry.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: RuntimeModelParamsSchema,
        response: {
          200: Type.Ref(RuntimeModelSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const row = await fastify.runtimeModelRepository.findById(
        request.params.entryId,
      );
      if (!row || !row.isActive) throw createProblem('not-found');
      // Team-scoped entries: caller must be able to access the team.
      // Global entries: any authenticated caller can read.
      if (row.teamId) {
        const { identityId, subjectNs } = authSubject(request);
        const canAccess = await fastify.permissionChecker.canAccessTeam(
          row.teamId,
          identityId,
          subjectNs,
        );
        if (!canAccess) throw createProblem('not-found');
      }
      return serializeModel(row);
    },
  );

  server.patch(
    '/runtime-models/:entryId',
    {
      schema: {
        operationId: 'updateRuntimeModel',
        tags: ['runtime-models'],
        description:
          'Update a team-scoped runtime model catalog entry. Global entries are not modifiable through this endpoint.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: RuntimeModelParamsSchema,
        body: Type.Ref(UpdateRuntimeModelBodySchema.$id),
        response: {
          200: Type.Ref(RuntimeModelSchema.$id),
          400: Type.Ref(ProblemDetailsSchema.$id),
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
          409: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request) => {
      const existing = await fastify.runtimeModelRepository.findById(
        request.params.entryId,
      );
      if (!existing) throw createProblem('not-found');
      if (!existing.teamId) {
        throw createProblem(
          'forbidden',
          'Global catalog entries are not modifiable via the public API',
        );
      }
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeam(
        existing.teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      const body = request.body as UpdateRuntimeModelBody;
      const patch = {
        ...(body.provider !== undefined
          ? { provider: body.provider.toLowerCase() }
          : {}),
        ...(body.model !== undefined
          ? { model: body.model.toLowerCase() }
          : {}),
        ...(body.displayName !== undefined
          ? { displayName: body.displayName }
          : {}),
        ...(body.description !== undefined
          ? { description: body.description }
          : {}),
        ...(body.capabilities !== undefined
          ? { capabilities: body.capabilities }
          : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      };
      try {
        const row = await fastify.runtimeModelRepository.update(
          existing.id,
          patch,
        );
        if (!row) throw createProblem('not-found');
        return serializeModel(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw createProblem(
            'conflict',
            'A runtime model entry with this (provider, model) already exists for this team',
          );
        }
        throw err;
      }
    },
  );

  server.delete(
    '/runtime-models/:entryId',
    {
      schema: {
        operationId: 'deleteRuntimeModel',
        tags: ['runtime-models'],
        description:
          'Delete a team-scoped runtime model catalog entry. Global entries are not deletable.',
        security: [{ bearerAuth: [] }, { sessionAuth: [] }, { cookieAuth: [] }],
        params: RuntimeModelParamsSchema,
        response: {
          204: { type: 'null' },
          401: Type.Ref(ProblemDetailsSchema.$id),
          403: Type.Ref(ProblemDetailsSchema.$id),
          404: Type.Ref(ProblemDetailsSchema.$id),
        },
      },
    },
    async (request, reply) => {
      const existing = await fastify.runtimeModelRepository.findById(
        request.params.entryId,
      );
      if (!existing) throw createProblem('not-found');
      if (!existing.teamId) {
        throw createProblem(
          'forbidden',
          'Global catalog entries are not deletable via the public API',
        );
      }
      const { identityId, subjectNs } = authSubject(request);
      const canManage = await fastify.permissionChecker.canManageTeam(
        existing.teamId,
        identityId,
        subjectNs,
      );
      if (!canManage) throw createProblem('forbidden');
      await fastify.runtimeModelRepository.delete(existing.id);
      return reply.status(204).send(null);
    },
  );
}
