import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { RegisterResult } from './register.js';

export interface MoltNetConfig {
  identity_id: string;
  registered_at: string;
  oauth2: { client_id: string; client_secret: string };
  keys: { public_key: string; private_key: string; fingerprint: string };
  endpoints: { api: string; mcp: string };
  ssh?: { private_key_path: string; public_key_path: string };
  git?: {
    name: string;
    email: string;
    signing: boolean;
    config_path: string;
  };
  github?: {
    app_id: string;
    app_slug?: string;
    installation_id: string;
    private_key_path: string;
  };
}

/** @deprecated Use MoltNetConfig. Removal scheduled for 3 minor versions. */
export type CredentialsFile = MoltNetConfig;

export function getConfigDir(): string {
  return join(homedir(), '.config', 'moltnet');
}

/** Returns the path to `moltnet.json` in the config directory. */
export function getConfigPath(configDir?: string): string {
  return join(configDir ?? getConfigDir(), 'moltnet.json');
}

/**
 * @deprecated Use `getConfigPath()`. Removal scheduled for 3 minor versions.
 */
export function getCredentialsPath(): string {
  return getConfigPath();
}

/**
 * Read the MoltNet config file.
 * Tries `moltnet.json` first; falls back to `credentials.json` with a
 * deprecation warning printed to stderr.
 */
export async function readConfig(
  configDir?: string,
): Promise<MoltNetConfig | null> {
  const dir = configDir ?? getConfigDir();

  // Try moltnet.json first
  try {
    const content = await readFile(join(dir, 'moltnet.json'), 'utf-8');
    return JSON.parse(content) as MoltNetConfig;
  } catch {
    // not found or unreadable — try legacy path
  }

  // Fall back to credentials.json
  try {
    const content = await readFile(join(dir, 'credentials.json'), 'utf-8');
    // eslint-disable-next-line no-console
    console.warn(
      'Warning: credentials.json is deprecated. ' +
        'New writes use moltnet.json. ' +
        'Support will be removed in 3 minor versions.',
    );
    return JSON.parse(content) as MoltNetConfig;
  } catch {
    return null;
  }
}

/** Write a MoltNetConfig to `moltnet.json` with mode 0o600. */
export async function writeConfig(
  config: MoltNetConfig,
  configDir?: string,
): Promise<string> {
  const dir = configDir ?? getConfigDir();
  await mkdir(dir, { recursive: true });

  const filePath = join(dir, 'moltnet.json');
  await writeFile(filePath, JSON.stringify(config, null, 2) + '\n', {
    mode: 0o600,
  });
  await chmod(filePath, 0o600);

  return filePath;
}

/**
 * Read config, shallow-merge a section, and write back.
 */
export async function updateConfigSection(
  section: keyof MoltNetConfig,
  data: object,
  configDir?: string,
): Promise<void> {
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }

  const existing =
    (config[section] as Record<string, unknown> | undefined) ?? {};
  const updated = { ...existing, ...(data as Record<string, unknown>) };
  Object.assign(config, { [section]: updated });

  await writeConfig(config, configDir);
}

/**
 * @deprecated Use `writeConfig()`. Adapts RegisterResult to MoltNetConfig.
 */
export async function writeCredentials(
  result: RegisterResult,
): Promise<string> {
  const config: MoltNetConfig = {
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

  return writeConfig(config);
}

/**
 * @deprecated Use `readConfig()`. Removal scheduled for 3 minor versions.
 */
export async function readCredentials(
  path?: string,
): Promise<MoltNetConfig | null> {
  if (path) {
    // Explicit path — read directly (legacy behavior)
    try {
      const content = await readFile(path, 'utf-8');
      return JSON.parse(content) as MoltNetConfig;
    } catch {
      return null;
    }
  }
  return readConfig();
}
