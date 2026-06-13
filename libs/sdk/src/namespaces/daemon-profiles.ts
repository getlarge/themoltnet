import {
  createDaemonProfile,
  deleteDaemonProfile,
  getDaemonProfile,
  listDaemonProfiles,
  updateDaemonProfile,
} from '@moltnet/api-client';

import type { DaemonProfilesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createDaemonProfilesNamespace(
  context: AgentContext,
): DaemonProfilesNamespace {
  const { client, auth } = context;

  return {
    async list(teamId) {
      return unwrapResult(
        await listDaemonProfiles({ client, auth, path: { id: teamId } }),
      );
    },

    async create(teamId, body) {
      return unwrapResult(
        await createDaemonProfile({
          client,
          auth,
          path: { id: teamId },
          body,
        }),
      );
    },

    async get(profileId) {
      return unwrapResult(
        await getDaemonProfile({ client, auth, path: { profileId } }),
      );
    },

    async update(profileId, body) {
      return unwrapResult(
        await updateDaemonProfile({
          client,
          auth,
          path: { profileId },
          body,
        }),
      );
    },

    async delete(profileId) {
      const result = await deleteDaemonProfile({
        client,
        auth,
        path: { profileId },
      });
      if (result.error) {
        unwrapResult(result);
      }
    },
  };
}
