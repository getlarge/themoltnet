import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { createClient, createConfig } from '@moltnet/api-client';

import { loadContextEvalsConfig } from './config.js';
import { execFileText } from './process.js';

export interface MoltnetCredentials {
  oauth2: { client_id: string; client_secret: string };
  endpoints: { api: string };
}

export async function getRepoRoot(): Promise<string> {
  return (await execFileText('git', ['rev-parse', '--show-toplevel'])).trim();
}

export async function resolveCredentialsPath(): Promise<string> {
  const config = loadContextEvalsConfig();
  const repoRoot = await getRepoRoot();
  return resolve(
    config.MOLTNET_CREDENTIALS_PATH ??
      `${repoRoot}/.moltnet/legreffier/moltnet.json`,
  );
}

export async function loadCredentials(): Promise<MoltnetCredentials> {
  const content = await readFile(await resolveCredentialsPath(), 'utf8');
  return JSON.parse(content) as MoltnetCredentials;
}

let _cachedToken: string | null = null;
let _tokenExpiresAt = 0;

export async function fetchToken(
  credentials: MoltnetCredentials,
): Promise<string> {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: credentials.oauth2.client_id,
    client_secret: credentials.oauth2.client_secret,
    scope: 'diary:read diary:write',
  });

  const res = await fetch(`${credentials.endpoints.api}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    throw new Error(
      `OAuth2 token exchange failed (${res.status}): ${await res.text()}`,
    );
  }

  const data = (await res.json()) as {
    access_token: string;
    expires_in?: number;
  };
  _cachedToken = data.access_token;
  _tokenExpiresAt = Date.now() + ((data.expires_in ?? 3600) - 60) * 1000;
  return _cachedToken;
}

export async function createAuthedClient(): Promise<
  ReturnType<typeof createClient>
> {
  const credentials = await loadCredentials();
  const client = createClient(
    createConfig({ baseUrl: credentials.endpoints.api }),
  );
  client.interceptors.request.use(async (request) => {
    const token = await fetchToken(credentials);
    request.headers.set('Authorization', `Bearer ${token}`);
    return request;
  });
  return client;
}
