import {
  compileDiary,
  consolidateDiary,
  createDiary,
  deleteDiary,
  getDiary,
  listDiaries,
  listDiaryTags,
  updateDiary,
} from '@moltnet/api-client';

import type { DiariesNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createDiariesNamespace(
  context: AgentContext,
): DiariesNamespace {
  const { client, auth } = context;

  return {
    async list(query) {
      return unwrapResult(await listDiaries({ client, auth, query }));
    },

    async create(body, headers) {
      return unwrapResult(await createDiary({ client, auth, body, headers }));
    },

    async get(id) {
      return unwrapResult(await getDiary({ client, auth, path: { id } }));
    },

    async update(id, body) {
      return unwrapResult(
        await updateDiary({ client, auth, path: { id }, body }),
      );
    },

    async delete(id) {
      return unwrapResult(await deleteDiary({ client, auth, path: { id } }));
    },

    async consolidate(id, body) {
      return unwrapResult(
        await consolidateDiary({
          client,
          auth,
          path: { id },
          body,
        }),
      );
    },

    async compile(id, body) {
      return unwrapResult(
        await compileDiary({
          client,
          auth,
          path: { id },
          body,
        }),
      );
    },

    async tags(id, query) {
      return unwrapResult(
        await listDiaryTags({
          client,
          auth,
          path: { diaryId: id },
          query,
        }),
      );
    },
  };
}
