import {
  createProject,
  type CreateProjectData,
  getProject,
  listProjects,
  updateProject,
  type UpdateProjectData,
} from '@moltnet/api-client';

import { type AgentContext, unwrapResult } from '../agent-context.js';

export function createProjectsNamespace({ client, auth }: AgentContext) {
  const headers = (teamId: string) => ({ 'x-moltnet-team-id': teamId });
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
    async list(teamId: string, includeArchived = false) {
      return unwrapResult(
        await listProjects({
          client,
          auth,
          path: { id: teamId },
          headers: headers(teamId),
          query: { includeArchived },
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
  };
}
export type ProjectsNamespace = ReturnType<typeof createProjectsNamespace>;
