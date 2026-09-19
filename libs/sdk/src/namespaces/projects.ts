import {
  createProject,
  type CreateProjectData,
  type CreateProjectResponse,
  getProject,
  listProjects,
  type ListProjectsResponse,
  updateProject,
  type UpdateProjectData,
} from '@moltnet/api-client';

import { type AgentContext, unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export interface ProjectsNamespace {
  create(
    teamId: string,
    body: CreateProjectData['body'],
  ): Promise<CreateProjectResponse>;
  list(
    teamId: string,
    options?: { includeArchived?: boolean },
  ): Promise<ListProjectsResponse>;
  get(teamId: string, projectId: string): Promise<CreateProjectResponse>;
  update(
    teamId: string,
    projectId: string,
    body: UpdateProjectData['body'],
  ): Promise<CreateProjectResponse>;
  archive(teamId: string, projectId: string): Promise<CreateProjectResponse>;
  unarchive(teamId: string, projectId: string): Promise<CreateProjectResponse>;
}

export function createProjectsNamespace({
  client,
  auth,
}: AgentContext): ProjectsNamespace {
  const headers = (teamId: string) => requiredTeamHeaders({ teamId });
  return {
    async create(teamId: string, body: CreateProjectData['body']) {
      return unwrapResult(
        await createProject({
          client,
          auth,
          path: { id: teamId },
          headers: headers(teamId),
          body,
        }),
      );
    },
    async list(teamId, options) {
      return unwrapResult(
        await listProjects({
          client,
          auth,
          path: { id: teamId },
          headers: headers(teamId),
          query: { includeArchived: options?.includeArchived ?? false },
        }),
      );
    },
    async get(teamId: string, projectId: string) {
      return unwrapResult(
        await getProject({
          client,
          auth,
          path: { id: teamId, projectId },
          headers: headers(teamId),
        }),
      );
    },
    async update(
      teamId: string,
      projectId: string,
      body: UpdateProjectData['body'],
    ) {
      return unwrapResult(
        await updateProject({
          client,
          auth,
          path: { id: teamId, projectId },
          headers: headers(teamId),
          body,
        }),
      );
    },
    async archive(teamId: string, projectId: string) {
      return unwrapResult(
        await updateProject({
          client,
          auth,
          path: { id: teamId, projectId },
          headers: headers(teamId),
          body: { archived: true },
        }),
      );
    },
    async unarchive(teamId: string, projectId: string) {
      return unwrapResult(
        await updateProject({
          client,
          auth,
          path: { id: teamId, projectId },
          headers: headers(teamId),
          body: { archived: false },
        }),
      );
    },
  };
}
