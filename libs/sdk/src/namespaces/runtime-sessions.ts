import {
  downloadRuntimeSession,
  getRuntimeSession,
  uploadRuntimeSession,
} from '@moltnet/api-client';

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

    async upload(path, body, options) {
      return unwrapResult(
        await uploadRuntimeSession({
          client,
          auth,
          headers: teamHeaders(options),
          path,
          body,
        }),
      );
    },

    async download(path, options) {
      return unwrapResult(
        await downloadRuntimeSession({
          client,
          auth,
          headers: teamHeaders(options),
          path,
        }),
      );
    },
  };
}
