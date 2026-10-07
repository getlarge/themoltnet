import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
  appendRuntimeStoreCommit,
  type AppendRuntimeStoreCommitData,
  getRuntimeSession,
  getRuntimeStoreForAttempt,
  mintRuntimeStoreId,
  openRuntimeStore,
  type OpenRuntimeStoreData,
  releaseRuntimeStore,
  renewRuntimeStore,
  type RenewRuntimeStoreData,
  uploadRuntimeSession,
  type UploadRuntimeSessionData,
} from '@moltnet/api-client';
import { RuntimeStoreCommit } from '@moltnet/runtime-profiles';
import { Value } from 'typebox/value';

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
      const body = unwrapResult(
        await client.request({
          ...request(options),
          method: 'GET',
          parseAs: 'stream',
          security: [{ scheme: 'bearer', type: 'http' }],
          url: '/runtime-sessions/durable/{storeId}/commits',
          path: { storeId },
          query: { afterSeq },
        }),
      );
      const stream =
        body instanceof Readable
          ? body
          : body instanceof ReadableStream
            ? Readable.fromWeb(body as NodeReadableStream)
            : null;
      if (!stream) throw invalidStoreResponse();
      const lines = storeLines(stream);
      try {
        const first = await lines.next();
        if (first.done) throw invalidStoreResponse();
        const header = JSON.parse(first.value) as {
          headSeq: number;
          count: number;
        };
        if (
          !Number.isSafeInteger(header.headSeq) ||
          header.headSeq < afterSeq ||
          !Number.isSafeInteger(header.count) ||
          header.count < 0 ||
          header.count > 100 ||
          header.count > header.headSeq - afterSeq
        )
          throw invalidStoreResponse();
        async function* items() {
          let count = 0;
          try {
            for await (const line of lines) {
              const commit: unknown = JSON.parse(line);
              if (
                !Value.Check(RuntimeStoreCommit, commit) ||
                commit.seq !== afterSeq + count + 1 ||
                count >= header.count
              )
                throw invalidStoreResponse();
              count++;
              yield commit;
            }
            if (count !== header.count) throw invalidStoreResponse();
          } finally {
            stream!.destroy();
          }
        }
        return { headSeq: header.headSeq, items: items() };
      } catch (error) {
        await lines.return(undefined);
        stream.destroy();
        throw error;
      }
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

function invalidStoreResponse() {
  return new MoltNetError('Invalid or incomplete runtime store stream', {
    code: 'INVALID_RESPONSE',
  });
}

/** Bound unfinished records and preserve UTF-8 across arbitrary network chunks. */
async function* storeLines(stream: Readable): AsyncGenerator<string> {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  try {
    for await (const chunk of stream) {
      pending += decoder.decode(chunk as Uint8Array, { stream: true });
      let newline: number;
      while ((newline = pending.indexOf('\n')) !== -1) {
        if (newline > 2 * 1024 * 1024) throw invalidStoreResponse();
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        yield line;
      }
      if (pending.length > 2 * 1024 * 1024) throw invalidStoreResponse();
    }
    pending += decoder.decode();
    if (pending.length) throw invalidStoreResponse();
  } finally {
    stream.destroy();
  }
}
