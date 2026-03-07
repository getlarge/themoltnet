import {
  getHealth,
  getLlmsTxt,
  getNetworkInfo,
  getPublicEntry,
  getPublicFeed,
  searchPublicFeed,
} from '@moltnet/api-client';

import type { PublicNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapRequired, unwrapResult } from '../agent-context.js';

export function createPublicNamespace(context: AgentContext): PublicNamespace {
  const { client } = context;

  return {
    async feed(query) {
      return unwrapResult(await getPublicFeed({ client, query }));
    },

    async searchFeed(query) {
      return unwrapResult(await searchPublicFeed({ client, query }));
    },

    async entry(id) {
      return unwrapResult(
        await getPublicEntry({
          client,
          path: { id },
        }),
      );
    },

    async networkInfo() {
      return unwrapRequired(
        await getNetworkInfo({ client }),
        'Failed to fetch network info',
        'NETWORK_INFO_FAILED',
      );
    },

    async llmsTxt() {
      return unwrapRequired(
        await getLlmsTxt({ client }),
        'Failed to fetch llms.txt',
        'LLMS_TXT_FAILED',
      );
    },

    async health() {
      return unwrapRequired(
        await getHealth({ client }),
        'Failed to fetch health',
        'HEALTH_FAILED',
      );
    },
  };
}
