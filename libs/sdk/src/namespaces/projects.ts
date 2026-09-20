import {
  createProject,
  type CreateProjectData,
  type CreateProjectResponse,
  getProject,
  type GetProjectResponse,
  listProjects,
  type ListProjectsResponse,
  updateProject,
  type UpdateProjectData,
  type UpdateProjectResponse,
} from '@moltnet/api-client';

import { type AgentContext, unwrapResult } from '../agent-context.js';
import {
  requiredTeamHeaders,
  type RequiredTeamRequestOptions,
} from './team-headers.js';

export interface ProjectsNamespace {
  create(
    body: CreateProjectData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<CreateProjectResponse>;
  list(
    query:
      | { includeArchived?: boolean; limit?: number; offset?: number }
      | undefined,
    options: RequiredTeamRequestOptions,
  ): Promise<ListProjectsResponse>;
  get(
    projectId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<GetProjectResponse>;
  update(
    projectId: string,
    body: UpdateProjectData['body'],
    options: RequiredTeamRequestOptions,
  ): Promise<UpdateProjectResponse>;
  archive(
    projectId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<UpdateProjectResponse>;
  unarchive(
    projectId: string,
    options: RequiredTeamRequestOptions,
  ): Promise<UpdateProjectResponse>;
}

export function createProjectsNamespace({
  client,
  auth,
}: AgentContext): ProjectsNamespace {
  return {
    async create(body, options) {
      return unwrapResult(
        await createProject({
          client,
          auth,
          body,
          headers: requiredTeamHeaders(options),
        }),
      );
    },
    async list(query, options) {
      return unwrapResult(
        await listProjects({
          client,
          auth,
          query,
          headers: requiredTeamHeaders(options),
        }),
      );
    },
    async get(projectId, options) {
      return unwrapResult(
        await getProject({
          client,
          auth,
          path: { projectId },
          headers: requiredTeamHeaders(options),
        }),
      );
    },
    async update(projectId, body, options) {
      return unwrapResult(
        await updateProject({
          client,
          auth,
          path: { projectId },
          body,
          headers: requiredTeamHeaders(options),
        }),
      );
    },
    async archive(projectId, options) {
      return unwrapResult(
        await updateProject({
          client,
          auth,
          path: { projectId },
          body: { archived: true },
          headers: requiredTeamHeaders(options),
        }),
      );
    },
    async unarchive(projectId, options) {
      return unwrapResult(
        await updateProject({
          client,
          auth,
          path: { projectId },
          body: { archived: false },
          headers: requiredTeamHeaders(options),
        }),
      );
    },
  };
}
