import {
  acceptDiaryInvitation,
  compileDiary,
  consolidateDiary,
  createDiary,
  declineDiaryInvitation,
  deleteDiary,
  getDiary,
  listDiaries,
  listDiaryInvitations,
  listDiaryShares,
  revokeDiaryShare,
  shareDiary,
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

    async create(body) {
      return unwrapResult(await createDiary({ client, auth, body }));
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

    async listShares(diaryId, query) {
      return unwrapResult(
        await listDiaryShares({
          client,
          auth,
          path: { diaryId },
          query,
        }),
      );
    },

    async share(diaryId, body) {
      return unwrapResult(
        await shareDiary({
          client,
          auth,
          path: { diaryId },
          body,
        }),
      );
    },

    async revokeShare(diaryId, fingerprint) {
      return unwrapResult(
        await revokeDiaryShare({
          client,
          auth,
          path: { diaryId, fingerprint },
        }),
      );
    },

    async listInvitations(query) {
      return unwrapResult(await listDiaryInvitations({ client, auth, query }));
    },

    async acceptInvitation(id) {
      return unwrapResult(
        await acceptDiaryInvitation({
          client,
          auth,
          path: { id },
        }),
      );
    },

    async declineInvitation(id) {
      return unwrapResult(
        await declineDiaryInvitation({
          client,
          auth,
          path: { id },
        }),
      );
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
  };
}
