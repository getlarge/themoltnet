import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export function deriveMcpUrl(apiUrl: string): string {
  return apiUrl.replace('://api.', '://mcp.') + '/mcp';
}

export interface SecretReference {
  provider: string;
  key: string;
}

export type OAuth2Config =
  | {
      client_id: string;
      client_secret: string;
      client_secret_ref?: never;
    }
  | {
      client_id: string;
      client_secret?: never;
      client_secret_ref: SecretReference;
    };

/** Exactly one of `private_key` (legacy plaintext seed) or `private_key_ref`. */
export type KeysConfig =
  | {
      public_key: string;
      fingerprint: string;
      private_key: string;
      private_key_ref?: never;
    }
  | {
      public_key: string;
      fingerprint: string;
      private_key?: never;
      private_key_ref: SecretReference;
    };

export interface MoltNetConfig {
  identity_id: string;
  registered_at: string;
  oauth2: OAuth2Config;
  keys: KeysConfig;
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
    org?: string;
  };
}

export function getConfigDir(): string {
  return join(homedir(), '.config', 'moltnet');
}

export function getConfigPath(configDir?: string): string {
  return join(configDir ?? getConfigDir(), 'moltnet.json');
}

export async function readConfig(
  configDir?: string,
): Promise<MoltNetConfig | null> {
  const dir = configDir ?? getConfigDir();
  try {
    const content = await readFile(join(dir, 'moltnet.json'), 'utf-8');
    return JSON.parse(content) as MoltNetConfig;
  } catch {
    return null;
  }
}

export async function writeConfig(
  config: MoltNetConfig,
  configDir?: string,
): Promise<string> {
  const dir = configDir ?? getConfigDir();
  await mkdir(dir, { recursive: true });
  const filePath = join(dir, 'moltnet.json');
  // Write to a sibling temp file and rename so the config is either fully
  // committed or untouched; callers rely on this when rolling back secrets.
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, JSON.stringify(config, null, 2) + '\n', {
      mode: 0o600,
    });
    await chmod(tempPath, 0o600);
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, { force: true }).catch(() => undefined);
    throw error;
  }
  return filePath;
}

export async function updateConfigSection(
  section: keyof MoltNetConfig,
  data: object,
  configDir?: string,
): Promise<void> {
  if (section === 'oauth2') {
    throw new Error(
      'OAuth2 credentials must be updated with updateOAuth2Config()',
    );
  }
  if (section === 'keys') {
    // Compatibility: a complete keys object (exactly one seed form) is still
    // accepted and routed through the validating updater; a partial merge
    // could leave both forms behind, so it is rejected.
    const keys = data as Partial<KeysConfig>;
    const complete =
      typeof keys.public_key === 'string' &&
      typeof keys.fingerprint === 'string' &&
      Boolean(keys.private_key) !== Boolean(keys.private_key_ref);
    if (!complete) {
      throw new Error(
        'Signing keys must be replaced as a whole with updateKeysConfig()',
      );
    }
    return updateKeysConfig(keys as KeysConfig, configDir);
  }
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  const existing =
    (config[section] as Record<string, unknown> | undefined) ?? {};
  Object.assign(config, {
    [section]: { ...existing, ...(data as Record<string, unknown>) },
  });
  await writeConfig(config, configDir);
}

/** Replace the OAuth2 union atomically so the opposite secret form is removed. */
export async function updateOAuth2Config(
  oauth2: OAuth2Config,
  configDir?: string,
): Promise<void> {
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  const plaintext = oauth2.client_secret?.trim();
  const reference = oauth2.client_secret_ref;
  if (!oauth2.client_id.trim() || Boolean(plaintext) === Boolean(reference)) {
    throw new Error(
      'OAuth2 config must set client_id and exactly one of client_secret or client_secret_ref',
    );
  }
  config.oauth2 = oauth2;
  await writeConfig(config, configDir);
}

/** Replace the keys union atomically so the opposite seed form is removed. */
export async function updateKeysConfig(
  keys: KeysConfig,
  configDir?: string,
): Promise<void> {
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  const plaintext = keys.private_key?.trim();
  const reference = keys.private_key_ref;
  if (!keys.public_key.trim() || Boolean(plaintext) === Boolean(reference)) {
    throw new Error(
      'Keys config must set public_key and exactly one of private_key or private_key_ref',
    );
  }
  config.keys = keys;
  await writeConfig(config, configDir);
}
