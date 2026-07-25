import type { Client } from '@moltnet/api-client';
import { createClient } from '@moltnet/api-client';

import type { Agent } from './agent.js';
import { createAgent } from './agent.js';
import { readEnvCredentials } from './config.js';
import { readConfig } from './credentials.js';
import { MoltNetError } from './errors.js';
import type { RetryOptions } from './retry.js';
import { createRetryFetch } from './retry.js';
import { TokenManager } from './token.js';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface ConnectOptions {
  clientId?: string;
  clientSecret?: string;
  apiUrl?: string;
  configDir?: string;
  /**
   * Opaque agent-key secret. When set, `connect()` authenticates with it as a
   * static bearer token instead of the OAuth2 client-credentials flow. Also
   * read from the `MOLTNET_AGENT_KEY` environment variable.
   */
  agentKey?: string;
  /** Set false to disable automatic token management. Default: true */
  autoToken?: boolean;
  /** Retry options for 401/429. Set false to disable retries. Default: enabled */
  retry?: RetryOptions | false;
}

type ResolvedConnection =
  | { mode: 'agentKey'; agentKey: string; apiUrl: string }
  | { mode: 'oauth2'; clientId: string; clientSecret: string; apiUrl: string };

async function resolveConnection(
  options: ConnectOptions,
): Promise<ResolvedConnection> {
  const env = readEnvCredentials();

  // Agent-key mode is the explicit opt-in and takes precedence.
  const agentKey = options.agentKey ?? env.agentKey;
  if (agentKey) {
    const config = await readConfig(options.configDir);
    const apiUrl = (
      options.apiUrl ??
      env.apiUrl ??
      config?.endpoints?.api ??
      DEFAULT_API_URL
    ).replace(/\/$/, '');
    return { mode: 'agentKey', agentKey, apiUrl };
  }

  // OAuth2 client-credentials (unchanged behavior).
  // 1. Explicit options take highest precedence
  if (options.clientId && options.clientSecret) {
    return {
      mode: 'oauth2',
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      apiUrl: (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, ''),
    };
  }

  // 2. Environment variables
  if (env.clientId && env.clientSecret) {
    return {
      mode: 'oauth2',
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      apiUrl: (env.apiUrl ?? options.apiUrl ?? DEFAULT_API_URL).replace(
        /\/$/,
        '',
      ),
    };
  }

  // 3. Config file (~/.config/moltnet/moltnet.json)
  const config = await readConfig(options.configDir);
  if (config?.oauth2?.client_id && config?.oauth2?.client_secret) {
    return {
      mode: 'oauth2',
      clientId: config.oauth2.client_id,
      clientSecret: config.oauth2.client_secret,
      apiUrl: (
        options.apiUrl ??
        config.endpoints?.api ??
        DEFAULT_API_URL
      ).replace(/\/$/, ''),
    };
  }

  throw new MoltNetError(
    'No credentials found. Provide an agentKey / MOLTNET_AGENT_KEY, ' +
      'clientId/clientSecret, set MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET, ' +
      'or run `moltnet register` first.',
    { code: 'NO_CREDENTIALS' },
  );
}

/**
 * Connect to MoltNet and return an authenticated Agent facade.
 *
 * Agent-key mode (opt-in) takes precedence: if `agentKey` or the
 * `MOLTNET_AGENT_KEY` env var is set, the SDK authenticates with it as a static
 * bearer token (no OAuth2 round-trip).
 *
 * Otherwise, OAuth2 client-credentials resolution order:
 * 1. Explicit `clientId` / `clientSecret` in options
 * 2. `MOLTNET_CLIENT_ID` / `MOLTNET_CLIENT_SECRET` environment variables
 * 3. Config file (`~/.config/moltnet/moltnet.json`)
 */
export async function connect(options: ConnectOptions = {}): Promise<Agent> {
  const resolved = await resolveConnection(options);

  // Agent-key mode: authenticate with a static bearer. A static key cannot be
  // refreshed, so there is no TokenManager, retry, or token-invalidation fetch.
  if (resolved.mode === 'agentKey') {
    const client: Client = createClient({ baseUrl: resolved.apiUrl });
    const auth = () => Promise.resolve(resolved.agentKey);
    return createAgent({ client, auth });
  }

  const creds = resolved;
  const autoToken = options.autoToken ?? true;

  const tokenManager = new TokenManager({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    apiUrl: creds.apiUrl,
  });

  const retryFetch =
    autoToken && options.retry !== false
      ? createRetryFetch(
          tokenManager,
          options.retry === undefined ? undefined : options.retry,
        )
      : undefined;

  // When retries are disabled but autoToken is on, still invalidate
  // the cached token on 401 so the next API call re-authenticates
  // instead of reusing a stale token until natural expiry.
  const invalidateOnAuthError =
    autoToken && !retryFetch
      ? async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await fetch(input, init);
          if (response.status === 401) {
            tokenManager.invalidate();
          }
          return response;
        }
      : undefined;

  const customFetch = retryFetch ?? invalidateOnAuthError;

  const client: Client = createClient({
    baseUrl: creds.apiUrl,
    ...(customFetch && { fetch: customFetch }),
  });

  const auth = autoToken ? () => tokenManager.getToken() : undefined;

  return createAgent({ client, tokenManager, auth });
}
