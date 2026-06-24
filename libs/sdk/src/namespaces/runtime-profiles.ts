import {
  createRuntimeProfile,
  deleteRuntimeProfile,
  getRuntimeProfile,
  listRuntimeProfiles,
  updateRuntimeProfile,
} from '@moltnet/api-client';

import type { RuntimeProfilesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { teamHeaders } from './team-headers.js';

export function createRuntimeProfilesNamespace(
  context: AgentContext,
): RuntimeProfilesNamespace {
  const { client, auth } = context;

  return {
    async list(options) {
      return unwrapResult(
        await listRuntimeProfiles({
          client,
          auth,
          headers: teamHeaders(options),
        }),
      );
    },

    async create(body, options) {
      return unwrapResult(
        await createRuntimeProfile({
          client,
          auth,
          headers: teamHeaders(options),
          body,
        }),
      );
    },

    async get(profileId) {
      return unwrapResult(
        await getRuntimeProfile({ client, auth, path: { profileId } }),
      );
    },

    async update(profileId, body) {
      return unwrapResult(
        await updateRuntimeProfile({
          client,
          auth,
          path: { profileId },
          body,
        }),
      );
    },

    async delete(profileId) {
      const result = await deleteRuntimeProfile({
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
