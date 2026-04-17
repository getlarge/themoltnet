import {
  getContextPackById,
  getContextPackProvenanceByCid,
  getContextPackProvenanceById,
  listContextPacks,
  listDiaryPacks,
  updateContextPack,
  updateRenderedPack,
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

    async list(selector) {
      if ('diaryId' in selector) {
        const { diaryId, ...query } = selector;
        return unwrapResult(
          await listDiaryPacks({
            client,
            auth,
            path: { id: diaryId },
            query,
          }),
        );
      }

      const { containsEntry, ...query } = selector;
      return unwrapResult(
        await listContextPacks({
          client,
          auth,
          query: {
            ...query,
            containsEntry,
          },
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

    async updateRendered(id, body) {
      return unwrapResult(
        await updateRenderedPack({
          client,
          auth,
          path: { id },
          body,
        }),
      );
    },
  };
}
