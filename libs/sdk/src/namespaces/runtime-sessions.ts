import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import {
  getRuntimeSession,
  uploadRuntimeSession,
  type UploadRuntimeSessionData,
} from '@moltnet/api-client';

import type { RuntimeSessionsNamespace } from '../agent.js';
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

  return {
    async getForAttempt(path, options) {
      try {
        return unwrapResult(
          await getRuntimeSession({
            client,
            auth,
            headers: teamHeaders(options),
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
        auth,
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
          auth,
          headers: teamHeaders(options),
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
