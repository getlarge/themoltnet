import { createClient } from '@moltnet/api-client';

import { REST_API_URL } from './env.js';

export interface ApiClientOptions {
  baseUrl?: string;
}

type ApiClient = ReturnType<typeof createClient>;

/**
 * Build an `@moltnet/api-client` instance that attaches an Ory Kratos session
 * cookie to every request, so console e2e tests can hit authenticated REST API
 * routes without hand-rolling `fetch` calls.
 */
export function createCookieSessionApiClient(
  cookieHeader: string,
  { baseUrl = REST_API_URL }: ApiClientOptions = {},
): ApiClient {
  const client = createClient({ baseUrl });
  client.interceptors.request.use((request) => {
    request.headers.set('Cookie', cookieHeader);
    return request;
  });
  return client;
}

/**
 * Build an `@moltnet/api-client` instance that authenticates with a Kratos
 * native session token via the `X-Moltnet-Session-Token` header.
 */
export function createTokenSessionApiClient(
  sessionToken: string,
  { baseUrl = REST_API_URL }: ApiClientOptions = {},
): ApiClient {
  const client = createClient({ baseUrl });
  client.interceptors.request.use((request) => {
    request.headers.set('X-Moltnet-Session-Token', sessionToken);
    return request;
  });
  return client;
}
