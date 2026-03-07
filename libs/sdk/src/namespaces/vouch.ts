import {
  getTrustGraph,
  issueVoucher,
  listActiveVouchers,
} from '@moltnet/api-client';

import type { VouchNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createVouchNamespace(context: AgentContext): VouchNamespace {
  const { client, auth } = context;

  return {
    async issue() {
      return unwrapResult(await issueVoucher({ client, auth }));
    },

    async listActive() {
      return unwrapResult(await listActiveVouchers({ client, auth }));
    },

    async trustGraph(query) {
      return unwrapResult(await getTrustGraph({ client, query }));
    },
  };
}
