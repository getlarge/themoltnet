import { Readable } from 'node:stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';

import { getRuntimeSession, type RuntimeSession } from '@moltnet/api-client';

import type { RuntimeSessionsNamespace } from '../agent.js';
import type { AgentContext } from '../agent-context.js';
import { unwrapResult } from '../agent-context.js';
import { MoltNetError } from '../errors.js';
import { requiredTeamHeaders as teamHeaders } from './team-headers.js';

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
      return unwrapResult<RuntimeSession>(
        (await client.request({
          auth,
          body,
          duplex: 'half',
          headers: {
            ...teamHeaders(options),
            'content-type': 'application/x-ndjson',
          },
          method: 'PUT',
          path,
          query,
          security: [{ scheme: 'bearer', type: 'http' }],
          url: '/runtime-sessions/{taskId}/{attemptN}/content',
        } as Parameters<typeof client.request>[0])) as {
          data?: RuntimeSession;
          error?: unknown;
          response?: unknown;
        },
      );
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
