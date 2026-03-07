import {
  createSigningRequest,
  getSigningRequest,
  listSigningRequests,
  submitSignature,
} from '@moltnet/api-client';

import type { SigningRequestsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createSigningRequestsNamespace(
  context: AgentContext,
): SigningRequestsNamespace {
  const { client, auth } = context;

  return {
    async list(query) {
      return unwrapResult(
        await listSigningRequests({
          client,
          auth,
          query,
        }),
      );
    },

    async create(body) {
      return unwrapResult(
        await createSigningRequest({
          client,
          auth,
          body,
        }),
      );
    },

    async get(id) {
      return unwrapResult(
        await getSigningRequest({
          client,
          auth,
          path: { id },
        }),
      );
    },

    async submit(id, body) {
      return unwrapResult(
        await submitSignature({
          client,
          auth,
          path: { id },
          body,
        }),
      );
    },
  };
}
