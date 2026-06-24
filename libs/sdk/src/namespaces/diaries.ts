import {
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
import { requiredTeamHeaders, teamHeaders } from './team-headers.js';

export function createDiariesNamespace(
  context: AgentContext,
): DiariesNamespace {
  const { client, auth } = context;

  return {
    async list(query, options) {
      return unwrapResult(
        await listDiaries({
          client,
          auth,
          query,
          headers: teamHeaders(options),
        }),
      );
    },

    async create(body, options) {
      return unwrapResult(
        await createDiary({
          client,
          auth,
          body,
          headers: requiredTeamHeaders(options),
        }),
      );
    },

    async get(id, options) {
      return unwrapResult(
        await getDiary({
          client,
          auth,
          path: { id },
          headers: teamHeaders(options),
        }),
      );
    },

    async update(id, body, options) {
      return unwrapResult(
        await updateDiary({
          client,
          auth,
          path: { id },
          body,
          headers: teamHeaders(options),
        }),
      );
    },

    async delete(id, options) {
      return unwrapResult(
        await deleteDiary({
          client,
          auth,
          path: { id },
          headers: teamHeaders(options),
        }),
      );
    },

    async tags(diaryId, query) {
      return unwrapResult(
        await listDiaryTags({
          client,
          auth,
          path: { diaryId },
          query,
        }),
      );
    },
  };
}
