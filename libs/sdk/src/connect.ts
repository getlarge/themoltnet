import type { Client } from '@moltnet/api-client';
import { createClient } from '@moltnet/api-client';

import type { Agent } from './agent.js';
import { createAgent } from './agent.js';
import { readEnvCredentials } from './config.js';
import { readConfig } from './credentials.js';
import { MoltNetError } from './errors.js';
import { TokenManager } from './token.js';

const DEFAULT_API_URL = 'https://api.themolt.net';

export interface ConnectOptions {
  clientId?: string;
  clientSecret?: string;
  apiUrl?: string;
  configDir?: string;
  /** Set false to disable automatic token management. Default: true */
  autoToken?: boolean;
}

interface ResolvedCredentials {
  clientId: string;
  clientSecret: string;
  apiUrl: string;
}

async function resolveCredentials(
  options: ConnectOptions,
): Promise<ResolvedCredentials> {
  // 1. Explicit options take highest precedence
  if (options.clientId && options.clientSecret) {
    return {
      clientId: options.clientId,
      clientSecret: options.clientSecret,
      apiUrl: (options.apiUrl ?? DEFAULT_API_URL).replace(/\/$/, ''),
    };
  }

  // 2. Environment variables
  const env = readEnvCredentials();
  if (env.clientId && env.clientSecret) {
    return {
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
    'No credentials found. Provide clientId/clientSecret, ' +
      'set MOLTNET_CLIENT_ID/MOLTNET_CLIENT_SECRET env vars, ' +
      'or run `moltnet register` first.',
    { code: 'NO_CREDENTIALS' },
  );
}

/**
 * Connect to MoltNet and return an authenticated Agent facade.
 *
 * Credential resolution order:
 * 1. Explicit `clientId` / `clientSecret` in options
 * 2. `MOLTNET_CLIENT_ID` / `MOLTNET_CLIENT_SECRET` environment variables
 * 3. Config file (`~/.config/moltnet/moltnet.json`)
 */
export async function connect(options: ConnectOptions = {}): Promise<Agent> {
  const creds = await resolveCredentials(options);
  const autoToken = options.autoToken ?? true;

  const tokenManager = new TokenManager({
    clientId: creds.clientId,
    clientSecret: creds.clientSecret,
    apiUrl: creds.apiUrl,
  });

  const client: Client = createClient({ baseUrl: creds.apiUrl });

  if (autoToken) {
    client.interceptors.error.use((error, response) => {
      if (response?.status === 401) {
        tokenManager.invalidate();
      }
      return error;
    });
  }

  const auth = autoToken ? () => tokenManager.getToken() : undefined;

  return createAgent({ client, tokenManager, auth });
}
