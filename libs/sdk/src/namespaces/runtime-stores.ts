import {
  appendRuntimeStoreCommit,
  type AppendRuntimeStoreCommitData,
  getRuntimeStoreForAttempt,
  listRuntimeStoreCommits,
  mintRuntimeStoreId,
  openRuntimeStore,
  type OpenRuntimeStoreData,
  releaseRuntimeStore,
  renewRuntimeStore,
  type RenewRuntimeStoreData,
} from '@moltnet/api-client';

import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { requiredTeamHeaders } from './team-headers.js';

export interface RuntimeStoreRequestOptions {
  teamId: string;
  signal?: AbortSignal;
}

export function createRuntimeStoresNamespace({ client, auth }: AgentContext) {
  const request = (options: RuntimeStoreRequestOptions) => ({
    client,
    auth,
    signal: options.signal,
    headers: requiredTeamHeaders(options),
  });
  return {
    async getForAttempt(
      taskId: string,
      attemptN: number,
      options: RuntimeStoreRequestOptions,
    ) {
      return unwrapResult(
        await getRuntimeStoreForAttempt({
          ...request(options),
          query: { taskId, attemptN },
        }),
      );
    },
    async open(
      body: OpenRuntimeStoreData['body'],
      options: RuntimeStoreRequestOptions,
    ) {
      return unwrapResult(
        await openRuntimeStore({ ...request(options), body }),
      );
    },
    async renew(
      storeId: string,
      body: RenewRuntimeStoreData['body'],
      options: RuntimeStoreRequestOptions,
    ) {
      return unwrapResult(
        await renewRuntimeStore({
          ...request(options),
          path: { storeId },
          body,
        }),
      );
    },
    async release(
      storeId: string,
      body: RenewRuntimeStoreData['body'],
      options: RuntimeStoreRequestOptions,
    ) {
      unwrapResult(
        await releaseRuntimeStore({
          ...request(options),
          path: { storeId },
          body,
        }),
      );
    },
    async mintId(
      storeId: string,
      body: RenewRuntimeStoreData['body'],
      options: RuntimeStoreRequestOptions,
    ) {
      return unwrapResult(
        await mintRuntimeStoreId({
          ...request(options),
          path: { storeId },
          body,
        }),
      );
    },
    async append(
      storeId: string,
      body: AppendRuntimeStoreCommitData['body'],
      options: RuntimeStoreRequestOptions,
    ) {
      return unwrapResult(
        await appendRuntimeStoreCommit({
          ...request(options),
          path: { storeId },
          body,
        }),
      );
    },
    async read(
      storeId: string,
      afterSeq: number,
      options: RuntimeStoreRequestOptions,
    ) {
      return unwrapResult(
        await listRuntimeStoreCommits({
          ...request(options),
          path: { storeId },
          query: { afterSeq },
        }),
      );
    },
  };
}

export type RuntimeStoresNamespace = ReturnType<
  typeof createRuntimeStoresNamespace
>;
