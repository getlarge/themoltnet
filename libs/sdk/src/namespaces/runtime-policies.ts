import {
  createRuntimePolicy,
  deleteRuntimePolicy,
  getRuntimePolicy,
  listRuntimePolicies,
  updateRuntimePolicy,
} from '@moltnet/api-client';

import type { RuntimePoliciesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export function createRuntimePoliciesNamespace(
  context: AgentContext,
): RuntimePoliciesNamespace {
  const { client, auth } = context;

  return {
    async create(body, options) {
      return unwrapResult(
        await createRuntimePolicy({
          client,
          auth,
          headers: requiredTeamHeaders(options),
          body,
        }),
      );
    },

    async list(options) {
      return unwrapResult(
        await listRuntimePolicies({
          client,
          auth,
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async get(policyId, options) {
      return unwrapResult(
        await getRuntimePolicy({
          client,
          auth,
          path: { policyId },
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async update(policyId, body, options) {
      return unwrapResult(
        await updateRuntimePolicy({
          client,
          auth,
          path: { policyId },
          headers: requiredTeamHeaders(options),
          body,
        }),
      );
    },

    async delete(policyId, options) {
      const result = await deleteRuntimePolicy({
        client,
        auth,
        path: { policyId },
        headers: requiredTeamHeaders(options),
      });
      if (result.error) {
        unwrapResult(result);
      }
    },
  };
}
