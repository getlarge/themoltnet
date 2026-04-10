import {
  createTeam,
  createTeamInvite,
  getTeam,
  joinTeam,
  listTeamInvites,
  listTeamMembers,
  listTeams,
} from '@moltnet/api-client';

import type { TeamsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createTeamsNamespace(context: AgentContext): TeamsNamespace {
  const { client, auth } = context;

  return {
    async list() {
      return unwrapResult(await listTeams({ client, auth }));
    },

    async get(id) {
      return unwrapResult(await getTeam({ client, auth, path: { id } }));
    },

    async listMembers(id) {
      return unwrapResult(
        await listTeamMembers({ client, auth, path: { id } }),
      );
    },

    async create(body) {
      return unwrapResult(await createTeam({ client, auth, body }));
    },

    async join(code) {
      return unwrapResult(await joinTeam({ client, auth, body: { code } }));
    },

    invites: {
      async create(teamId, body) {
        return unwrapResult(
          await createTeamInvite({
            client,
            auth,
            path: { id: teamId },
            body,
          }),
        );
      },

      async list(teamId) {
        return unwrapResult(
          await listTeamInvites({
            client,
            auth,
            path: { id: teamId },
          }),
        );
      },
    },
  };
}
