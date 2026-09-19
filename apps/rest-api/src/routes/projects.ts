import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { type Project, UniqueViolationError } from '@moltnet/database';
import { DiaryServiceError } from '@moltnet/diary-service';
import {
  ConflictProblemDetailsSchema,
  CreateProjectSchema,
  ProblemDetailsSchema,
  ProjectResponseSchema,
  TeamParamsSchema,
  UpdateProjectSchema,
} from '@moltnet/models';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import {
  createConflictProblem,
  createProblem,
  createValidationProblem,
} from '../problems/index.js';
import { authContextToCreator } from '../utils/auth-principal.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

function serializeProject(project: Project) {
  return {
    ...project,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  };
}

export async function projectRoutes(fastify: FastifyInstance) {
  const server = fastify.withTypeProvider<TypeBoxTypeProvider>();
  server.addHook('preHandler', requireAuth);
  const params = Type.Object({
    id: Type.String({ format: 'uuid' }),
    projectId: Type.String({ format: 'uuid' }),
  });
  const errors = {
    400: Type.Ref(ProblemDetailsSchema.$id),
    401: Type.Ref(ProblemDetailsSchema.$id),
    403: Type.Ref(ProblemDetailsSchema.$id),
    404: Type.Ref(ProblemDetailsSchema.$id),
    409: Type.Ref(ConflictProblemDetailsSchema.$id),
  };
  const security: Record<string, string[]>[] = [
    { bearerAuth: [] },
    { sessionAuth: [] },
    { cookieAuth: [] },
  ];
  async function authorize(
    request: FastifyRequest,
    teamId: string,
    manage = false,
  ) {
    if (
      request.authContext?.currentTeamId &&
      request.authContext.currentTeamId !== teamId
    ) {
      throw createProblem('forbidden');
    }
    const { subjectId, subjectNs } = requireKetoSubject(request);
    const permitted = manage
      ? await fastify.permissionChecker.canWriteTeam(
          teamId,
          subjectId,
          subjectNs,
        )
      : await fastify.permissionChecker.canAccessTeam(
          teamId,
          subjectId,
          subjectNs,
        );
    if (!permitted) throw createProblem(manage ? 'forbidden' : 'not-found');
  }
  async function validateDiary(
    request: FastifyRequest,
    teamId: string,
    diaryId?: string | null,
  ) {
    if (!diaryId) return;
    const { subjectId, subjectNs } = requireKetoSubject(request);
    const invalidDiary = () =>
      createValidationProblem([
        {
          field: 'defaultDiaryId',
          message:
            'Project default diary must be accessible and belong to the project team',
        },
      ]);
    try {
      const diary = await fastify.diaryService.findDiary(
        diaryId,
        subjectId,
        subjectNs,
      );
      if (!diary || diary.teamId !== teamId) throw invalidDiary();
    } catch (error) {
      if (
        error instanceof DiaryServiceError &&
        (error.code === 'not_found' || error.code === 'forbidden')
      )
        throw invalidDiary();
      throw error;
    }
  }

  async function find(teamId: string, id: string) {
    const project = await fastify.projectRepository.findById(id);
    if (!project || project.teamId !== teamId) throw createProblem('not-found');
    return project;
  }
  async function mutation<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UniqueViolationError)
        throw createConflictProblem(
          'A project with this name already exists in this team',
          { constraint: error.constraint, target: error.target },
        );
      throw error;
    }
  }
  server.post(
    '/teams/:id/projects',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['team:manage'],
        },
      },
      schema: {
        operationId: 'createProject',
        tags: ['projects'],
        security,
        params: TeamParamsSchema,
        body: CreateProjectSchema,
        response: { 201: ProjectResponseSchema, ...errors },
      },
    },
    async (request, reply) => {
      const { id: teamId } = request.params;
      await authorize(request, teamId, true);
      if (!(await fastify.teamRepository.findById(teamId)))
        throw createProblem('not-found');
      await validateDiary(request, teamId, request.body.defaultDiaryId);
      const project = await mutation(() =>
        fastify.projectRepository.create({
          ...request.body,
          teamId,
          creator: authContextToCreator(request),
        }),
      );
      return reply.status(201).send(serializeProject(project));
    },
  );
  server.get(
    '/teams/:id/projects',
    {
      config: {
        auth: { credentialBindingScope: 'team', requiredScopes: ['team:read'] },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'listProjects',
        tags: ['projects'],
        security,
        params: TeamParamsSchema,
        querystring: Type.Object({
          includeArchived: Type.Optional(Type.Boolean()),
          limit: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 100, default: 50 }),
          ),
          offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })),
        }),
        response: {
          200: Type.Object({
            items: Type.Array(ProjectResponseSchema),
            nextOffset: Type.Union([Type.Integer(), Type.Null()]),
          }),
          ...errors,
        },
      },
    },
    async (request) => {
      await authorize(request, request.params.id);
      const limit = request.query.limit ?? 50;
      const offset = request.query.offset ?? 0;
      const items = await fastify.projectRepository.listByTeamId(
        request.params.id,
        request.query.includeArchived ?? false,
        { limit: limit + 1, offset },
      );
      return {
        items: items.slice(0, limit).map(serializeProject),
        nextOffset: items.length > limit ? offset + limit : null,
      };
    },
  );
  server.get(
    '/teams/:id/projects/:projectId',
    {
      config: {
        auth: { credentialBindingScope: 'team', requiredScopes: ['team:read'] },
        rateLimit: fastify.rateLimitConfig.read,
      },
      schema: {
        operationId: 'getProject',
        tags: ['projects'],
        security,
        params,
        response: { 200: ProjectResponseSchema, ...errors },
      },
    },
    async (request) => {
      await authorize(request, request.params.id);
      const project = await find(request.params.id, request.params.projectId);
      return serializeProject(project);
    },
  );
  server.patch(
    '/teams/:id/projects/:projectId',
    {
      config: {
        auth: {
          credentialBindingScope: 'team',
          requiredScopes: ['team:manage'],
        },
      },
      schema: {
        operationId: 'updateProject',
        tags: ['projects'],
        security,
        params,
        body: UpdateProjectSchema,
        response: { 200: ProjectResponseSchema, ...errors },
      },
    },
    async (request) => {
      const { id: teamId, projectId } = request.params;
      await authorize(request, teamId, true);
      await find(teamId, projectId);
      await validateDiary(request, teamId, request.body.defaultDiaryId);
      const project = await mutation(() =>
        fastify.projectRepository.update(projectId, teamId, request.body),
      );
      if (!project) throw createProblem('not-found');
      return serializeProject(project);
    },
  );
}
