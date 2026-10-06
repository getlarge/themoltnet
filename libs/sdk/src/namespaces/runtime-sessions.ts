import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
  appendRuntimeStoreCommit,
  type AppendRuntimeStoreCommitData,
  getRuntimeSession,
  getRuntimeStoreForAttempt,
  listRuntimeStoreCommits,
  mintRuntimeStoreId,
  openRuntimeStore,
  type OpenRuntimeStoreData,
  releaseRuntimeStore,
  renewRuntimeStore,
  type RenewRuntimeStoreData,
  uploadRuntimeSession,
  type UploadRuntimeSessionData,
} from '@moltnet/api-client';

import type {
  RuntimeSessionRequestOptions,
  RuntimeSessionsNamespace,
} from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { MoltNetError } from '../errors.js';
import { requiredTeamHeaders as teamHeaders } from './team-headers.js';

type RuntimeSessionUploadOptions = Parameters<
  typeof uploadRuntimeSession
>[0] & {
  duplex: 'half';
};

export function createRuntimeSessionsNamespace(
  context: AgentContext,
): RuntimeSessionsNamespace {
  const { client, auth } = context;
  const request = (options: RuntimeSessionRequestOptions) => ({
    client,
    auth,
    signal: options.signal,
    headers: teamHeaders(options),
  });

  return {
    async getDurableForAttempt(
      taskId: string,
      attemptN: number,
      options: RuntimeSessionRequestOptions,
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
      options: RuntimeSessionRequestOptions,
    ) {
      return unwrapResult(
        await openRuntimeStore({ ...request(options), body }),
      );
    },
    async renew(
      storeId: string,
      body: RenewRuntimeStoreData['body'],
      options: RuntimeSessionRequestOptions,
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
      options: RuntimeSessionRequestOptions,
    ) {
      const result = await releaseRuntimeStore({
        ...request(options),
        path: { storeId },
        body,
      });
      if (result.error) unwrapResult(result);
    },
    async mintId(
      storeId: string,
      body: RenewRuntimeStoreData['body'],
      options: RuntimeSessionRequestOptions,
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
      options: RuntimeSessionRequestOptions,
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
      options: RuntimeSessionRequestOptions,
    ) {
      return unwrapResult(
        await listRuntimeStoreCommits({
          ...request(options),
          path: { storeId },
          query: { afterSeq },
        }),
      );
    },
    async getForAttempt(path, options) {
      try {
        return unwrapResult(
          await getRuntimeSession({
            ...request(options),
            path,
          }),
        );
      } catch (err) {
        if (err instanceof MoltNetError && err.statusCode === 404) {
          return null;
        }
        throw err;
      }
    },

    async upload(path, body, query, options) {
      const uploadOptions = {
        ...request(options),
        body: body as unknown as NonNullable<UploadRuntimeSessionData['body']>,
        client,
        duplex: 'half',
        headers: {
          ...teamHeaders(options),
          'content-type': 'application/octet-stream',
        },
        path,
        query,
      } satisfies RuntimeSessionUploadOptions;

      return unwrapResult(await uploadRuntimeSession(uploadOptions));
    },

    async download(path, options) {
      const stream = unwrapResult(
        await client.request({
          ...request(options),
          method: 'GET',
          parseAs: 'stream',
          path,
          security: [{ scheme: 'bearer', type: 'http' }],
          url: '/runtime-sessions/{taskId}/{attemptN}/content',
        }),
      );
      if (stream instanceof Readable) return stream;
      if (stream instanceof ReadableStream) {
        return Readable.fromWeb(stream as NodeReadableStream);
      }
      throw new MoltNetError(
        'Unexpected runtime session download response stream',
        { code: 'INVALID_RESPONSE' },
      );
    },
  };
}
