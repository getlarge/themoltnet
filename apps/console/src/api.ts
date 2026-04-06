/**
 * API client for the console app.
 *
 * The console authenticates via Kratos browser-flow cookies. The REST API
 * reads the session token from the X-Moltnet-Session-Token header, which
 * the server-side session resolver populates. No JS-level token injection
 * is needed here — credentials: 'include' on fetch handles cookies.
 */

import { type Client, createClient } from '@moltnet/api-client';

import { getConfig } from './config.js';

let client: Client | null = null;

export function getApiClient(): Client {
  if (!client) {
    client = createClient({ baseUrl: getConfig().apiBaseUrl });
  }
  return client;
}
