import {
  createRuntimeProfile,
  deleteRuntimeProfile,
  getRuntimeProfile,
  getRuntimeProfileAllowedTools,
  getRuntimeProfilePolicies,
  listRuntimeProfiles,
  setRuntimeProfilePolicies,
  updateRuntimeProfile,
} from '@moltnet/api-client';

import type { RuntimeProfilesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders, teamHeaders } from './team-headers.js';

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

    async allowedTools(profileId, options) {
      return unwrapResult(
        await getRuntimeProfileAllowedTools({
          client,
          auth,
          path: { profileId },
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async setPolicies(profileId, policyIds, options) {
      const result = await setRuntimeProfilePolicies({
        client,
        auth,
        path: { profileId },
        headers: requiredTeamHeaders(options),
        body: { policyIds },
      });
      if (result.error) {
        unwrapResult(result);
      }
    },

    async getPolicies(profileId, options) {
      return unwrapResult(
        await getRuntimeProfilePolicies({
          client,
          auth,
          path: { profileId },
          headers: requiredTeamHeaders(options),
        }),
      );
    },
  };
}
