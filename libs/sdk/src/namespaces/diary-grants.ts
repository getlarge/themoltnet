import {
  createDiaryGrant,
  listDiaryGrants,
  revokeDiaryGrant,
} from '@moltnet/api-client';

import type { DiaryGrantsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createDiaryGrantsNamespace(
  context: AgentContext,
): DiaryGrantsNamespace {
  const { client, auth } = context;

  return {
    async create(diaryId, body) {
      return unwrapResult(
        await createDiaryGrant({ client, auth, path: { id: diaryId }, body }),
      );
    },

    async list(diaryId) {
      return unwrapResult(
        await listDiaryGrants({ client, auth, path: { id: diaryId } }),
      );
    },

    async revoke(diaryId, body) {
      return unwrapResult(
        await revokeDiaryGrant({ client, auth, path: { id: diaryId }, body }),
      );
    },
  };
}
