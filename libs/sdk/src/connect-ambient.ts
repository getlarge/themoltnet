import type { CredentialScope } from '@moltnet/models';

import type { Agent } from './agent.js';
import {
  assertTrustedConfigApiUrl,
  normalizeApiUrl,
  requireSecureCredentialApiUrl,
} from './api-url.js';
import { readEnvCredentials } from './config.js';
import { connect } from './connect.js';
import {
  CredentialResolutionError,
  resolveAgentKey,
  resolveEnvSecretReference,
  resolveOAuth2ClientSecret,
} from './credential-resolver.js';
import { readConfig } from './credentials.js';
import { MoltNetError } from './errors.js';
import type { RetryOptions } from './retry.js';
import {
  createDefaultSecretProviderRegistry,
  type SecretProviderRegistry,
} from './secrets.js';

export interface AmbientConnectOptions {
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
  /** Abort token acquisition and requests made by this connection. */
  signal?: AbortSignal;
  /**
   * Providers used to resolve credential references at connection time,
   * including `MOLTNET_AGENT_KEY_REF`, `agent_key_ref`, and
   * `oauth2.client_secret_ref`.
   */
  secretProviders?: SecretProviderRegistry;
}

type ResolvedConnection =
  | { mode: 'agentKey'; agentKey: string; apiUrl: string }
  | { mode: 'oauth2'; clientId: string; clientSecret: string; apiUrl: string };

async function resolveConnection(
  options: AmbientConnectOptions,
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
  // 3. Env agent key or env agent-key reference (opts into key mode only once
  //    explicit options are ruled out). A value and a reference together is a
  //    misconfiguration, never a precedence question.
  const envAgentKey = env.agentKey?.trim();
  const envAgentKeyRef = env.agentKeyRef?.trim();
  if (envAgentKey && envAgentKeyRef) {
    throw new MoltNetError(
      'Set only one of MOLTNET_AGENT_KEY or MOLTNET_AGENT_KEY_REF.',
      { code: 'INVALID_CONFIG' },
    );
  }
  if (envAgentKey) {
    return {
      mode: 'agentKey',
      agentKey: envAgentKey,
      apiUrl: requireAgentKeyApiUrl(options.apiUrl, env.apiUrl),
    };
  }
  if (envAgentKeyRef) {
    const apiUrl = requireAgentKeyApiUrl(options.apiUrl, env.apiUrl);
    let agentKey: string;
    try {
      agentKey = await resolveEnvSecretReference(
        envAgentKeyRef,
        options.secretProviders ?? createDefaultSecretProviderRegistry(),
      );
    } catch (error) {
      throw new MoltNetError('Unable to resolve MOLTNET_AGENT_KEY_REF.', {
        code: 'NO_CREDENTIALS',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return { mode: 'agentKey', agentKey, apiUrl };
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
  // 5. Config file (~/.config/moltnet/moltnet.json). A configured
  //    agent_key_ref is a config-mode credential and precedes OAuth2; the
  //    config's own API endpoint is trusted through the same check.
  const config = await readConfig(options.configDir);
  if (config?.agent_key_ref) {
    const apiUrl = normalizeApiUrl(
      options.apiUrl,
      env.apiUrl,
      config.endpoints?.api,
    );
    if (!options.apiUrl && !env.apiUrl) {
      assertTrustedConfigApiUrl(apiUrl);
    }
    requireSecureCredentialApiUrl(apiUrl);
    let agentKey: string | null;
    try {
      agentKey = await resolveAgentKey(
        config,
        options.secretProviders ?? createDefaultSecretProviderRegistry(),
      );
    } catch (error) {
      if (
        error instanceof CredentialResolutionError &&
        error.code !== 'provider_failure'
      ) {
        throw new MoltNetError(
          error.code === 'unbound'
            ? 'Agent key reference is not bound to this MoltNet identity.'
            : 'Invalid agent_key_ref: the reference resolved to an empty value.',
          { code: 'INVALID_CONFIG' },
        );
      }
      throw new MoltNetError('Unable to resolve agent_key_ref.', {
        code: 'NO_CREDENTIALS',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    if (agentKey) {
      return { mode: 'agentKey', agentKey, apiUrl };
    }
  }
  if (config?.oauth2?.client_id) {
    const apiUrl = normalizeApiUrl(
      options.apiUrl,
      env.apiUrl,
      config.endpoints?.api,
    );
    if (!options.apiUrl && !env.apiUrl) {
      assertTrustedConfigApiUrl(apiUrl);
    }
    let clientSecret: string;
    try {
      clientSecret = await resolveOAuth2ClientSecret(
        config,
        options.secretProviders ?? createDefaultSecretProviderRegistry(),
      );
    } catch (error) {
      if (
        error instanceof CredentialResolutionError &&
        error.code !== 'provider_failure'
      ) {
        throw new MoltNetError(
          error.code === 'unbound'
            ? 'OAuth2 secret reference is not bound to this MoltNet identity and client.'
            : 'Invalid OAuth2 config: set exactly one of client_secret or client_secret_ref.',
          { code: 'INVALID_CONFIG' },
        );
      }
      throw new MoltNetError('Unable to resolve OAuth2 client secret.', {
        code: 'NO_CREDENTIALS',
        detail: error instanceof Error ? error.message : String(error),
      });
    }
    return {
      mode: 'oauth2',
      clientId: config.oauth2.client_id,
      clientSecret,
      apiUrl,
    };
  }

  throw new MoltNetError(
    'No credentials found. Provide an agentKey / MOLTNET_AGENT_KEY / ' +
      'MOLTNET_AGENT_KEY_REF, clientId/clientSecret, set ' +
      'MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET, or run `moltnet register` first.',
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
  return requireSecureCredentialApiUrl(normalizeApiUrl(apiUrl));
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

/**
 * Connect to MoltNet and return an authenticated Agent facade.
 *
 * Credential resolution, highest precedence first. Explicit in-code options —
 * of either kind — always win over the environment and config file:
 * 1. Explicit `agentKey` option → agent-key mode (static bearer)
 * 2. Explicit `clientId` / `clientSecret` → OAuth2 client-credentials
 * 3. `MOLTNET_AGENT_KEY` env → agent-key mode
 * 4. `MOLTNET_AGENT_KEY_REF` env → resolved agent-key mode
 * 5. `MOLTNET_CLIENT_ID` / `MOLTNET_CLIENT_SECRET` env → OAuth2
 * 6. Config file (`~/.config/moltnet/moltnet.json`) → `agent_key_ref`, then
 *    OAuth2, resolving credential references only at this use boundary
 *
 * In agent-key mode the key is sent directly as a bearer token — no OAuth2
 * round-trip — and 429 backoff still applies; a rejected key surfaces an
 * `AuthenticationError`.
 */
export async function connectAmbient(
  options: AmbientConnectOptions = {},
): Promise<Agent> {
  const resolved = await resolveConnection(options);
  const retry = options.retry === undefined ? {} : { retry: options.retry };
  const signal = options.signal ? { signal: options.signal } : {};

  if (resolved.mode === 'agentKey') {
    return connect({
      agentKey: resolved.agentKey,
      apiUrl: resolved.apiUrl,
      ...signal,
      ...retry,
    });
  }

  return connect({
    clientId: resolved.clientId,
    clientSecret: resolved.clientSecret,
    apiUrl: resolved.apiUrl,
    ...signal,
    ...(options.scopes === undefined ? {} : { scopes: options.scopes }),
    ...(options.autoToken === undefined
      ? {}
      : { autoToken: options.autoToken }),
    ...retry,
  });
}
