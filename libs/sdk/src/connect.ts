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
import {
  assertOAuth2SecretReferenceBinding,
  createDefaultSecretProviderRegistry,
  type SecretProviderRegistry,
} from './secrets.js';
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
  /** Providers used to resolve oauth2.client_secret_ref at connection time. */
  secretProviders?: SecretProviderRegistry;
}

type ResolvedConnection =
  | { mode: 'agentKey'; agentKey: string; apiUrl: string }
  | { mode: 'oauth2'; clientId: string; clientSecret: string; apiUrl: string };

async function resolveConnection(
  options: ConnectOptions,
): Promise<ResolvedConnection> {
  const env = readEnvCredentials();
  requireActivatedConfigDir(options.configDir, env.credentialsPath);
  const explicitAgentKey = options.agentKey?.trim();

  // Explicit in-code credentials — of either kind — are always authoritative,
  // so a stray environment variable can never override what the caller wrote.
  // 1. Explicit agent key
  if (explicitAgentKey) {
    return {
      mode: 'agentKey',
      agentKey: explicitAgentKey,
      apiUrl: requireAgentKeyApiUrl(options.apiUrl, env.apiUrl),
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
    return {
      mode: 'agentKey',
      agentKey: envAgentKey,
      apiUrl: requireAgentKeyApiUrl(options.apiUrl, env.apiUrl),
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
  if (config?.oauth2?.client_id) {
    const legacySecret = config.oauth2.client_secret;
    const secretReference = config.oauth2.client_secret_ref;
    if (legacySecret && secretReference) {
      throw new MoltNetError(
        'Invalid OAuth2 config: set exactly one of client_secret or client_secret_ref.',
        { code: 'INVALID_CONFIG' },
      );
    }
    const apiUrl = normalizeApiUrl(
      options.apiUrl,
      env.apiUrl,
      config.endpoints?.api,
    );
    if (!options.apiUrl && !env.apiUrl) {
      requireTrustedConfigApiUrl(apiUrl);
    }
    let clientSecret: string;
    if (secretReference) {
      requireBoundSecretReference(config, secretReference);
      try {
        clientSecret = await (
          options.secretProviders ?? createDefaultSecretProviderRegistry()
        ).resolve(secretReference);
      } catch (error) {
        throw new MoltNetError('Unable to resolve OAuth2 client secret.', {
          code: 'NO_CREDENTIALS',
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    } else if (legacySecret) {
      // eslint-disable-next-line no-console
      console.warn(
        'Warning: plaintext oauth2.client_secret is deprecated; migrate it to a secret provider.',
      );
      clientSecret = legacySecret;
    } else {
      throw new MoltNetError(
        'Invalid OAuth2 config: set exactly one of client_secret or client_secret_ref.',
        { code: 'INVALID_CONFIG' },
      );
    }
    return {
      mode: 'oauth2',
      clientId: config.oauth2.client_id,
      clientSecret,
      apiUrl,
    };
  }

  throw new MoltNetError(
    'No credentials found. Provide an agentKey / MOLTNET_AGENT_KEY, ' +
      'clientId/clientSecret, set MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET, ' +
      'or run `moltnet register` first.',
    { code: 'NO_CREDENTIALS' },
  );
}

function requireAgentKeyApiUrl(
  explicitApiUrl: string | undefined,
  environmentApiUrl: string | undefined,
): string {
  const apiUrl = explicitApiUrl?.trim() || environmentApiUrl?.trim();
  if (!apiUrl) {
    throw new MoltNetError(
      'Agent-key authentication requires an explicit API endpoint. Set apiUrl or MOLTNET_API_URL; agent-key mode does not read moltnet.json.',
      { code: 'INVALID_CONFIG' },
    );
  }
  return normalizeApiUrl(apiUrl);
}

function requireActivatedConfigDir(
  configDir: string | undefined,
  activatedCredentialsPath: string | undefined,
): void {
  if (!configDir || !activatedCredentialsPath) return;
  const normalize = (value: string) =>
    value.replaceAll('\\', '/').replace(/\/+$/, '');
  const requested = `${normalize(configDir)}/moltnet.json`;
  if (requested !== normalize(activatedCredentialsPath)) {
    throw new MoltNetError(
      'configDir does not match the identity activated by `moltnet start`.',
      { code: 'INVALID_CONFIG' },
    );
  }
}

function requireBoundSecretReference(
  config: NonNullable<Awaited<ReturnType<typeof readConfig>>>,
  reference: { provider: string; key: string },
): void {
  try {
    assertOAuth2SecretReferenceBinding(
      reference,
      config.identity_id,
      config.oauth2.client_id,
    );
  } catch {
    throw new MoltNetError(
      'OAuth2 secret reference is not bound to this MoltNet identity and client.',
      { code: 'INVALID_CONFIG' },
    );
  }
}

function requireTrustedConfigApiUrl(apiUrl: string): void {
  const url = new URL(apiUrl);
  const loopback =
    url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]';
  const moltNet =
    url.protocol === 'https:' &&
    (url.hostname === 'themolt.net' || url.hostname.endsWith('.themolt.net'));
  if (!loopback && !moltNet) {
    throw new MoltNetError(
      'Config-provided OAuth2 endpoints must use HTTPS on themolt.net or a loopback host.',
      { code: 'INVALID_CONFIG' },
    );
  }
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
 * 5. Config file (`~/.config/moltnet/moltnet.json`) → OAuth2, resolving a
 *    `client_secret_ref` only at this use boundary
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
