/**
 * API client for the dashboard app.
 *
 * Uses @moltnet/api-client for typed REST calls.
 * Session token is injected via the auth callback.
 */

import { createClient } from '@moltnet/api-client';

import { getConfig } from './config.js';

export function createApiClient(sessionToken?: string) {
  return createClient({
    baseUrl: getConfig().apiBaseUrl,
    ...(sessionToken
      ? {
          headers: {
            'X-Session-Token': sessionToken,
          },
        }
      : {}),
  });
}
