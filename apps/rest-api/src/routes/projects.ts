import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { requireAuth } from '@moltnet/auth';
import { UniqueViolationError } from '@moltnet/database';
import {
  CreateProjectSchema,
  ProblemDetailsSchema,
  ProjectResponseSchema,
  TeamParamsSchema,
  UpdateProjectSchema,
} from '@moltnet/models';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Type } from 'typebox';

import { createConflictProblem, createProblem } from '../problems/index.js';
import { requireKetoSubject } from '../utils/require-keto-subject.js';

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
    409: Type.Ref(ProblemDetailsSchema.$id),
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
    const { subjectId, subjectNs } = requireKetoSubject(request);
    const permitted = manage
      ? await fastify.permissionChecker.canManageTeamMembers(
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
    const diary = await fastify.diaryService.findDiary(
      diaryId,
      subjectId,
      subjectNs,
    );
    if (!diary || diary.teamId !== teamId)
      throw createProblem(
        'validation-failed',
        'Project default diary must belong to the project team',
      );
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
        fastify.projectRepository.create({ ...request.body, teamId }),
      );
      return reply.status(201).send({
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      });
    },
  );
  server.get(
    '/teams/:id/projects',
    {
      config: {
        auth: { credentialBindingScope: 'team', requiredScopes: ['team:read'] },
      },
      schema: {
        operationId: 'listProjects',
        tags: ['projects'],
        security,
        params: TeamParamsSchema,
        querystring: Type.Object({
          includeArchived: Type.Optional(Type.Boolean()),
        }),
        response: {
          200: Type.Object({ items: Type.Array(ProjectResponseSchema) }),
          ...errors,
        },
      },
    },
    async (request) => {
      await authorize(request, request.params.id);
      const items = await fastify.projectRepository.listByTeamId(
        request.params.id,
        request.query.includeArchived ?? false,
      );
      return {
        items: items.map((project) => ({
          ...project,
          createdAt: project.createdAt.toISOString(),
          updatedAt: project.updatedAt.toISOString(),
        })),
      };
    },
  );
  server.get(
    '/teams/:id/projects/:projectId',
    {
      config: {
        auth: { credentialBindingScope: 'team', requiredScopes: ['team:read'] },
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
      return {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
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
      return {
        ...project,
        createdAt: project.createdAt.toISOString(),
        updatedAt: project.updatedAt.toISOString(),
      };
    },
  );
}
