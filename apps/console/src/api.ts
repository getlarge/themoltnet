/**
 * API client for the console app.
 *
 * The console authenticates via Kratos browser-flow cookies. The REST API
 * reads the session token from the X-Moltnet-Session-Token header, which
 * the server-side session resolver populates. No JS-level token injection
 * is needed here — credentials: 'include' on fetch handles cookies.
 *
 * When a team is selected, the x-moltnet-team-id header is injected so
 * the API scopes responses to that team.
 */

import { type Client, createClient } from '@moltnet/api-client';

import { getConfig } from './config.js';

let client: Client | null = null;
let currentTeamId: string | null = null;

export function setTeamId(teamId: string | null): void {
  if (teamId !== currentTeamId) {
    currentTeamId = teamId;
    client = null;
  }
}

export function getApiClient(): Client {
  if (!client) {
    client = createClient({
      baseUrl: getConfig().apiBaseUrl,
      // Send Kratos session cookie with every request
      fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
      headers: currentTeamId
        ? { 'x-moltnet-team-id': currentTeamId }
        : undefined,
    });
  }
  return client;
}
