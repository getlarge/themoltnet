import {
  getContextPackById,
  getContextPackProvenanceByCid,
  getContextPackProvenanceById,
  listDiaryPacks,
  updateContextPack,
} from '@moltnet/api-client';

import type { PacksNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createPacksNamespace(context: AgentContext): PacksNamespace {
  const { client, auth } = context;

  return {
    async get(id, query) {
      return unwrapResult(
        await getContextPackById({
          client,
          auth,
          path: { id },
          query,
        }),
      );
    },

    async list(diaryId, query) {
      return unwrapResult(
        await listDiaryPacks({
          client,
          auth,
          path: { id: diaryId },
          query,
        }),
      );
    },

    async getProvenance(id, query) {
      return unwrapResult(
        await getContextPackProvenanceById({
          client,
          auth,
          path: { id },
          query,
        }),
      );
    },

    async getProvenanceByCid(cid, query) {
      return unwrapResult(
        await getContextPackProvenanceByCid({
          client,
          auth,
          path: { cid },
          query,
        }),
      );
    },

    async update(id, body) {
      return unwrapResult(
        await updateContextPack({
          client,
          auth,
          path: { id },
          body,
        }),
      );
    },
  };
}
