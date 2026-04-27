/**
 * MoltNet API client for the docs site.
 *
 * Authenticated by the same Kratos session cookie as the rest of docs auth —
 * `credentials: 'include'` makes the browser attach the `.themolt.net`-scoped
 * cookie, and the rest-api's session resolver does the rest. No JWT, no
 * client_credentials, no token storage.
 */

import { type Client, createClient } from '@moltnet/api-client';

const DEFAULT_API_URL = 'https://api.themolt.net';

let client: Client | null = null;

function getApiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    const injected = (
      window as unknown as { __MOLTNET_CONFIG__?: { apiBaseUrl?: string } }
    ).__MOLTNET_CONFIG__;
    const injected_url = injected?.apiBaseUrl?.trim();
    if (injected_url) return injected_url;
  }
  const env_url = import.meta.env.VITE_API_BASE_URL?.trim();
  return env_url || DEFAULT_API_URL;
}

export function getApiClient(): Client {
  if (!client) {
    client = createClient({
      baseUrl: getApiBaseUrl(),
      fetch: (url, init) => fetch(url, { ...init, credentials: 'include' }),
    });
  }
  return client;
}
