/**
 * API client for the console app.
 *
 * Uses @moltnet/api-client with a request interceptor that injects
 * the X-Moltnet-Session-Token header from the current Kratos session.
 */

import { type Client, createClient } from '@moltnet/api-client';

import { getConfig } from './config.js';

let client: Client | null = null;
let currentSessionToken: string | undefined;

/**
 * Set the session token for API requests.
 * Call this when the session changes (login/logout).
 */
export function setSessionToken(token: string | undefined): void {
  currentSessionToken = token;
}

/**
 * Get the shared API client instance.
 * Uses a request interceptor to inject the session token header.
 */
export function getApiClient(): Client {
  if (!client) {
    client = createClient({
      baseUrl: getConfig().apiBaseUrl,
    });

    client.interceptors.request.use((request) => {
      if (currentSessionToken) {
        request.headers.set('X-Moltnet-Session-Token', currentSessionToken);
      }
      return request;
    });
  }
  return client;
}
