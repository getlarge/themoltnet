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

/** Exactly one of `private_key_path` (legacy PEM file) or `private_key_ref`. */
export type GitHubConfig =
  | {
      app_id: string;
      app_slug?: string;
      installation_id: string;
      org?: string;
      private_key_path: string;
      private_key_ref?: never;
    }
  | {
      app_id: string;
      app_slug?: string;
      installation_id: string;
      org?: string;
      private_key_path?: never;
      private_key_ref: SecretReference;
    };

interface MoltNetConfigBase {
  identity_id: string;
  registered_at: string;
  keys: KeysConfig;
  endpoints: { api: string; mcp: string };
  ssh?: { private_key_path: string; public_key_path: string };
  git?: {
    name: string;
    email: string;
    signing: boolean;
    config_path: string;
  };
  github?: GitHubConfig;
}

/**
 * A canonical profile must contain at least one authentication mechanism.
 * Profiles may contain both during credential transitions.
 */
export type MoltNetConfig = MoltNetConfigBase &
  (
    | { agent_key_ref: SecretReference; oauth2?: OAuth2Config }
    | { agent_key_ref?: SecretReference; oauth2: OAuth2Config }
  );

export function getConfigDir(): string {
  return join(homedir(), '.config', 'moltnet');
}

export interface IdentitySelector {
  version: 1;
  default_identity?: string;
}

const identityAliasPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

export function getIdentityDir(alias: string): string {
  if (!identityAliasPattern.test(alias)) {
    throw new Error(`invalid identity alias: ${alias}`);
  }
  return join(getConfigDir(), 'identities', alias);
}

/** Resolve an explicit credentials directory, active identity, or default. */
export async function resolveConfigDir(
  configDir?: string,
): Promise<string | null> {
  if (configDir) return configDir;
  let alias = process.env.MOLTNET_ACTIVE_IDENTITY?.trim();
  if (!alias) {
    try {
      const content = await readFile(
        join(getConfigDir(), 'identity-selector.json'),
        'utf-8',
      );
      const selector = JSON.parse(content) as IdentitySelector;
      if (selector.version !== 1) {
        throw new Error(
          `identity selector version ${String(selector.version)} is not supported`,
        );
      }
      alias = selector.default_identity?.trim();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }
  return alias ? getIdentityDir(alias) : null;
}

export function getConfigPath(configDir?: string): string {
  if (configDir) return join(configDir, 'moltnet.json');
  const alias = process.env.MOLTNET_ACTIVE_IDENTITY?.trim();
  if (!alias) {
    throw new Error(
      'no active identity selected; set MOLTNET_ACTIVE_IDENTITY or use an explicit credentials directory',
    );
  }
  return join(getIdentityDir(alias), 'moltnet.json');
}

export async function readConfig(
  configDir?: string,
): Promise<MoltNetConfig | null> {
  const dir = await resolveConfigDir(configDir);
  if (!dir) return null;
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
  const dir = await resolveConfigDir(configDir);
  if (!dir) {
    throw new Error(
      'no active identity selected; set MOLTNET_ACTIVE_IDENTITY before writing config',
    );
  }
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
  if (section === 'github') {
    // Compatibility: a complete github object (exactly one PEM form) is still
    // accepted and routed through the validating updater; a partial merge
    // could leave both forms behind, so it is rejected.
    const github = data as Partial<GitHubConfig>;
    const complete =
      typeof github.app_id === 'string' &&
      typeof github.installation_id === 'string' &&
      Boolean(github.private_key_path) !== Boolean(github.private_key_ref);
    if (!complete) {
      throw new Error(
        'GitHub App settings must be replaced as a whole with updateGitHubConfig()',
      );
    }
    return updateGitHubConfig(github as GitHubConfig, configDir);
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

/** Replace the GitHub union atomically so the opposite PEM form is removed. */
export async function updateGitHubConfig(
  github: GitHubConfig,
  configDir?: string,
): Promise<void> {
  const config = await readConfig(configDir);
  if (!config) {
    throw new Error('No config found — run `moltnet register` first');
  }
  const path = github.private_key_path?.trim();
  const reference = github.private_key_ref;
  if (!github.app_id.trim() || Boolean(path) === Boolean(reference)) {
    throw new Error(
      'GitHub config must set app_id and exactly one of private_key_path or private_key_ref',
    );
  }
  config.github = github;
  await writeConfig(config, configDir);
}
