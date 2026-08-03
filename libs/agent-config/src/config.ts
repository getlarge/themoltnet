import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
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

export interface MoltNetConfig {
  identity_id: string;
  registered_at: string;
  oauth2: OAuth2Config;
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
    // Try the legacy path below.
  }
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
  Object.assign(config, {
    [section]: { ...existing, ...(data as Record<string, unknown>) },
  });
  await writeConfig(config, configDir);
}
