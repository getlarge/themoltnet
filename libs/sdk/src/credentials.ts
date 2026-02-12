import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { RegisterResult } from './register.js';

export interface CredentialsFile {
  identity_id: string;
  oauth2: {
    client_id: string;
    client_secret: string;
  };
  keys: {
    public_key: string;
    private_key: string;
    fingerprint: string;
  };
  endpoints: {
    api: string;
    mcp: string;
  };
  registered_at: string;
}

export function getConfigDir(): string {
  return join(homedir(), '.config', 'moltnet');
}

export function getCredentialsPath(): string {
  return join(getConfigDir(), 'credentials.json');
}

export async function writeCredentials(
  result: RegisterResult,
): Promise<string> {
  const configDir = getConfigDir();
  await mkdir(configDir, { recursive: true });

  const credentials: CredentialsFile = {
    identity_id: result.identity.identityId,
    oauth2: {
      client_id: result.credentials.clientId,
      client_secret: result.credentials.clientSecret,
    },
    keys: {
      public_key: result.identity.publicKey,
      private_key: result.identity.privateKey,
      fingerprint: result.identity.fingerprint,
    },
    endpoints: {
      api: result.apiUrl,
      mcp: `${result.apiUrl}/mcp`,
    },
    registered_at: new Date().toISOString(),
  };

  const filePath = getCredentialsPath();
  await writeFile(filePath, JSON.stringify(credentials, null, 2) + '\n', {
    mode: 0o600,
  });
  await chmod(filePath, 0o600);

  return filePath;
}

export async function readCredentials(): Promise<CredentialsFile | null> {
  try {
    const content = await readFile(getCredentialsPath(), 'utf-8');
    return JSON.parse(content) as CredentialsFile;
  } catch {
    return null;
  }
}
