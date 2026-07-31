import type { Client } from '@moltnet/api-client';
import { createClient } from '@moltnet/api-client';
import type { CredentialScope } from '@moltnet/models';

import type { Agent } from './agent.js';
import { createAgent } from './agent.js';
import { normalizeApiUrl } from './api-url.js';
import { readEnvCredentials } from './config.js';
import { readConfig } from './credentials.js';
import { MoltNetError } from './errors.js';
import type { RetryOptions } from './retry.js';
import { createAgentKeyFetch, createRetryFetch } from './retry.js';
import { TokenManager } from './token.js';

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
  /** OAuth2 scopes requested for access tokens. Defaults to the full agent grant. */
  scopes?: readonly CredentialScope[];
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
  const explicitAgentKey = options.agentKey?.trim();

  // Explicit in-code credentials — of either kind — are always authoritative,
  // so a stray environment variable can never override what the caller wrote.
  // 1. Explicit agent key
  if (explicitAgentKey) {
    const config = await readConfig(options.configDir);
    return {
      mode: 'agentKey',
      agentKey: explicitAgentKey,
      apiUrl: normalizeApiUrl(
        options.apiUrl,
        env.apiUrl,
        config?.endpoints?.api,
      ),
    };
  }
  // 2. Explicit OAuth2 client credentials
  if (options.clientId && options.clientSecret) {
    return {
      mode: 'oauth2',
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      apiUrl: normalizeApiUrl(options.apiUrl, env.apiUrl),
    };
  }

  // No explicit credentials — fall back to the environment, then the config.
  // 3. Env agent key (opts into key mode only once explicit options are ruled out)
  const envAgentKey = env.agentKey?.trim();
  if (envAgentKey) {
    const config = await readConfig(options.configDir);
    return {
      mode: 'agentKey',
      agentKey: envAgentKey,
      apiUrl: normalizeApiUrl(
        options.apiUrl,
        env.apiUrl,
        config?.endpoints?.api,
      ),
    };
  }
  // 4. Env OAuth2 client credentials
  if (env.clientId && env.clientSecret) {
    return {
      mode: 'oauth2',
      clientId: env.clientId,
      clientSecret: env.clientSecret,
      apiUrl: normalizeApiUrl(options.apiUrl, env.apiUrl),
    };
  }
  // 5. Config file (~/.config/moltnet/moltnet.json)
  const config = await readConfig(options.configDir);
  if (config?.oauth2?.client_id && config?.oauth2?.client_secret) {
    return {
      mode: 'oauth2',
      clientId: config.oauth2.client_id,
      clientSecret: config.oauth2.client_secret,
      apiUrl: normalizeApiUrl(options.apiUrl, config.endpoints?.api),
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
 * Credential resolution, highest precedence first. Explicit in-code options —
 * of either kind — always win over the environment and config file:
 * 1. Explicit `agentKey` option → agent-key mode (static bearer)
 * 2. Explicit `clientId` / `clientSecret` → OAuth2 client-credentials
 * 3. `MOLTNET_AGENT_KEY` env → agent-key mode
 * 4. `MOLTNET_CLIENT_ID` / `MOLTNET_CLIENT_SECRET` env → OAuth2
 * 5. Config file (`~/.config/moltnet/moltnet.json`) → OAuth2
 *
 * In agent-key mode the key is sent directly as a bearer token — no OAuth2
 * round-trip — and 429 backoff still applies; a rejected key surfaces an
 * `AuthenticationError`.
 */
export async function connect(options: ConnectOptions = {}): Promise<Agent> {
  const resolved = await resolveConnection(options);

  // Agent-key mode: authenticate with a static bearer. A static key cannot be
  // refreshed, so there is no TokenManager; the key-mode fetch keeps 429 backoff
  // and turns a rejected key (401) into an actionable AuthenticationError.
  if (resolved.mode === 'agentKey') {
    const client: Client = createClient({
      baseUrl: resolved.apiUrl,
      fetch: createAgentKeyFetch(options.retry),
    });
    const auth = () => Promise.resolve(resolved.agentKey);
    return createAgent({ client, auth });
  }

  const creds = resolved;
  const autoToken = options.autoToken ?? true;

  const tokenManager = new TokenManager({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    apiUrl: creds.apiUrl,
    scopes: options.scopes,
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
