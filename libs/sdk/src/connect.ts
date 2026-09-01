import type { Client } from '@moltnet/api-client';
import { createClient } from '@moltnet/api-client';
import type { CredentialScope } from '@moltnet/models';

import type { Agent } from './agent.js';
import { createAgent } from './agent.js';
import { normalizeApiUrl, requireSecureCredentialApiUrl } from './api-url.js';
import {
  createAgentKeyFetch,
  createRetryFetch,
  type RetryOptions,
} from './retry.js';
import { TokenManager } from './token.js';

interface ConnectBaseOptions {
  apiUrl: string;
  /** Retry options for 401/429. Set false to disable retries. */
  retry?: RetryOptions | false;
}

/** Static agent-key credentials for an ambient-free SDK connection. */
export interface ConnectAgentKeyOptions extends ConnectBaseOptions {
  agentKey: string;
  clientId?: never;
  clientSecret?: never;
  scopes?: never;
  autoToken?: never;
}

/** OAuth2 credentials and token behavior for an ambient-free connection. */
export interface ConnectOAuth2Options extends ConnectBaseOptions {
  agentKey?: never;
  clientId: string;
  clientSecret: string;
  /** OAuth2 scopes requested for access tokens. */
  scopes?: readonly CredentialScope[];
  /** Set false to disable automatic token management. Default: true. */
  autoToken?: boolean;
}

export type ConnectOptions = ConnectAgentKeyOptions | ConnectOAuth2Options;

/**
 * Connect with one required in-memory credential mode: a static agent key or
 * OAuth2 client credentials.
 *
 * This entry point never reads environment variables, config files, keyrings,
 * or other ambient credential providers. Node applications that intentionally
 * use ambient credential resolution should import `connect` from
 * `@themoltnet/sdk/node`.
 */
export function connect(options: ConnectOptions): Promise<Agent> {
  return Promise.resolve().then(() => createConnection(options));
}

function createConnection(options: ConnectOptions): Agent {
  const apiUrl = requireSecureCredentialApiUrl(normalizeApiUrl(options.apiUrl));
  if (typeof options.agentKey === 'string') {
    const agentKey = options.agentKey.trim();
    if (!agentKey) {
      throw new TypeError('connect requires a non-empty agent key.');
    }
    const client: Client = createClient({
      baseUrl: apiUrl,
      fetch: createAgentKeyFetch(options.retry),
    });
    return createAgent({ client, auth: () => Promise.resolve(agentKey) });
  }

  const autoToken = options.autoToken ?? true;
  const tokenManager = new TokenManager({
    apiUrl,
    clientId: options.clientId,
    clientSecret: options.clientSecret,
    scopes: options.scopes,
  });
  const retryFetch =
    autoToken && options.retry !== false
      ? createRetryFetch(
          tokenManager,
          options.retry === undefined ? undefined : options.retry,
        )
      : undefined;
  const invalidateOnAuthError =
    autoToken && !retryFetch
      ? async (input: RequestInfo | URL, init?: RequestInit) => {
          const response = await fetch(input, init);
          if (response.status === 401) tokenManager.invalidate();
          return response;
        }
      : undefined;
  const customFetch = retryFetch ?? invalidateOnAuthError;
  const client: Client = createClient({
    baseUrl: apiUrl,
    ...(customFetch && { fetch: customFetch }),
  });
  const auth = autoToken ? () => tokenManager.getToken() : undefined;

  return createAgent({ client, tokenManager, auth });
}
