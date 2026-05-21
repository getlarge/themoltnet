import {
  acceptTransfer,
  initiateTransfer,
  listPendingTransfers,
  rejectTransfer,
} from '@moltnet/api-client';

import type { DiaryTransfersNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';

export function createDiaryTransfersNamespace(
  context: AgentContext,
): DiaryTransfersNamespace {
  const { client, auth } = context;

  return {
    async initiate(diaryId, body) {
      return unwrapResult(
        await initiateTransfer({ client, auth, path: { id: diaryId }, body }),
      );
    },

    async listPending() {
      return unwrapResult(await listPendingTransfers({ client, auth }));
    },

    async accept(transferId) {
      return unwrapResult(
        await acceptTransfer({ client, auth, path: { transferId } }),
      );
    },

    async reject(transferId) {
      return unwrapResult(
        await rejectTransfer({ client, auth, path: { transferId } }),
      );
    },
  };
}
