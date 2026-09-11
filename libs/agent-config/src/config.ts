import { readFileSync } from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, sep } from 'node:path';

import { AGENT_ALIAS_PATTERN } from '@moltnet/models';

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

export type AgentSubjectType = 'agent';

export function oauth2SecretKey(subjectId: string, clientId: string): string {
  return `oauth2/${subjectId}/${clientId}`;
}

export function identitySeedKey(fingerprint: string): string {
  return `identity/${fingerprint}/seed`;
}

export function agentKeyKey(subjectId: string): string {
  return `agent-key/${subjectId}`;
}

interface MoltNetConfigBase {
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
 * The durable local anchor. Canonical documents use the MoltNet subject;
 * identity_id is accepted only while the explicit compatibility reader ships.
 */
export interface CanonicalMoltNetConfigAnchor {
  subject_id: string;
  subject_type: AgentSubjectType;
  identity_id?: never;
}

export interface LegacyMoltNetConfigAnchor {
  subject_id?: never;
  subject_type?: never;
  identity_id: string;
}

export type MoltNetConfigAnchor =
  | CanonicalMoltNetConfigAnchor
  | LegacyMoltNetConfigAnchor;

/**
 * A canonical profile must contain at least one authentication mechanism.
 * Profiles may contain both during credential transitions.
 */
type MoltNetAuthenticationConfig =
  | { agent_key_ref: SecretReference; oauth2?: OAuth2Config }
  | { agent_key_ref?: SecretReference; oauth2: OAuth2Config };

export type MoltNetConfig = MoltNetConfigBase &
  CanonicalMoltNetConfigAnchor &
  MoltNetAuthenticationConfig;

export type CanonicalMoltNetConfig = MoltNetConfig;

export type LegacyMoltNetConfig = MoltNetConfigBase &
  LegacyMoltNetConfigAnchor &
  MoltNetAuthenticationConfig;

/** Temporary compatibility shape returned by readers during the migration release. */
type ReadMoltNetConfig = MoltNetConfig | LegacyMoltNetConfig;

export function isCanonicalConfig(
  config: ReadMoltNetConfig,
): config is MoltNetConfig {
  return Boolean(config.subject_id?.trim()) && config.subject_type === 'agent';
}

export function assertCanonicalConfig(
  config: ReadMoltNetConfig,
): asserts config is MoltNetConfig {
  if (!isCanonicalConfig(config)) {
    throw new Error(
      'legacy config is read-only; run `moltnet config migrate` before writing',
    );
  }
}

export function getConfigDir(): string {
  // One root, shared with the Go CLI's GetConfigDir and the daemon's
  // resolveAgentServerRoot. Deliberately does NOT honour XDG_CONFIG_HOME:
  // following it here would silently relocate the store for every existing
  // install that has the variable set. The daemon used to honour it and now
  // does not, adopting any state left at the old location on startup.
  return join(homedir(), '.config', 'moltnet');
}

export interface IdentitySelector {
  version: 1;
  default_identity?: string;
}

/**
 * The one identity-alias grammar, shared with the REST `AgentAliasSchema`
 * through `AGENT_ALIAS_PATTERN` in `@moltnet/models`. Must stay identical to
 * agentNamePattern in apps/moltnet-cli (Go); the daemon's AgentServerStore
 * reuses this constant directly. An alias is a directory name in a store all
 * of them write and the value the CLI publishes as the network alias, so a
 * value one accepts and another rejects makes an identity unreadable by half
 * the system or unpublishable. `identity-alias.test.ts` pins the Go copy.
 */
const identitiesDirName = 'identities';

export const IDENTITY_ALIAS_PATTERN = new RegExp(AGENT_ALIAS_PATTERN);

export function assertIdentityAlias(alias: string): string {
  if (!IDENTITY_ALIAS_PATTERN.test(alias)) {
    throw new Error(`invalid identity alias: ${alias}`);
  }
  return alias;
}

export function getIdentityDir(alias: string): string {
  return join(getConfigDir(), identitiesDirName, assertIdentityAlias(alias));
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

/**
 * Synchronous best-effort path resolution.
 *
 * Deliberately total: this function is re-exported from @themoltnet/sdk with an
 * unchanged signature, so throwing here breaks every downstream caller at
 * runtime with nothing for TypeScript to flag. It is also used inside error
 * messages, where throwing replaces the real failure with a misleading one.
 *
 * It reads the selector synchronously so it agrees with resolveConfigDir's
 * ladder — explicit -> MOLTNET_ACTIVE_IDENTITY -> selector — instead of
 * answering the same question differently. Falls back to the legacy path so an
 * install that predates the central store still resolves.
 */
export function getConfigPath(configDir?: string): string {
  if (configDir) return join(configDir, 'moltnet.json');
  const alias =
    process.env.MOLTNET_ACTIVE_IDENTITY?.trim() ||
    readIdentitySelectorSync()?.default_identity?.trim();
  if (alias) return join(getIdentityDir(alias), 'moltnet.json');
  // No identity resolves, so there is no real document. The contract is still a
  // FILE path — it is publicly re-exported and a caller may hand it to
  // readFile, where a directory would surface as a baffling EISDIR instead of
  // a plain "not found". The runtime never reads this location; it exists so
  // diagnostics have something concrete to name. Callers that need the truth
  // should use resolveConfigPath, which can say "none".
  return join(getConfigDir(), 'moltnet.json');
}

/**
 * The active identity's document, or null when no identity resolves.
 *
 * The honest counterpart to getConfigPath: a `string` return cannot express
 * "there is no active identity", which is why that function has to invent a
 * path. Prefer this wherever the absence matters.
 */
/** Idempotent: an existing default is never overwritten. */
async function seedIdentitySelectorIfUnset(identityDir: string): Promise<void> {
  const alias = identityDir.split(sep).pop();
  if (!alias || !IDENTITY_ALIAS_PATTERN.test(alias)) return;
  const selectorPath = join(getConfigDir(), 'identity-selector.json');
  try {
    const existing = JSON.parse(
      await readFile(selectorPath, 'utf-8'),
    ) as IdentitySelector;
    if (existing.default_identity?.trim()) return;
  } catch {
    // Absent or unreadable: write a fresh one below.
  }
  await mkdir(getConfigDir(), { recursive: true, mode: 0o700 });
  await writeFile(
    selectorPath,
    JSON.stringify({ version: 1, default_identity: alias }, null, 2) + '\n',
    { mode: 0o600 },
  );
}

export async function resolveConfigPath(
  configDir?: string,
): Promise<string | null> {
  const dir = await resolveConfigDir(configDir);
  return dir ? join(dir, 'moltnet.json') : null;
}

function readIdentitySelectorSync(): IdentitySelector | null {
  try {
    const selector = JSON.parse(
      readFileSync(join(getConfigDir(), 'identity-selector.json'), 'utf-8'),
    ) as IdentitySelector;
    return selector.version === 1 ? selector : null;
  } catch {
    return null;
  }
}

export async function readConfig(
  configDir?: string,
): Promise<ReadMoltNetConfig | null> {
  // Deliberately no fallback to the pre-central-store `<config>/moltnet.json`.
  // The Go CLI never reads it, so a fallback here gave one contract two
  // behaviours: the CLI reported no identity while the SDK and daemon silently
  // used the retired document. Support for that shape is being retired, not
  // migrated, so nothing here should look for it.
  const dir = await resolveConfigDir(configDir);
  if (!dir) return null;
  return readConfigFile(join(dir, 'moltnet.json'));
}

async function readConfigFile(path: string): Promise<ReadMoltNetConfig | null> {
  try {
    return JSON.parse(await readFile(path, 'utf-8')) as ReadMoltNetConfig;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new Error(`Unable to read MoltNet config at ${path}.`, {
      cause: error,
    });
  }
}

export async function writeConfig(
  config: MoltNetConfig,
  configDir?: string,
): Promise<string> {
  assertCanonicalConfig(config);
  const dir = await resolveConfigDir(configDir);
  if (!dir) {
    throw new Error(
      'no active identity selected; set MOLTNET_ACTIVE_IDENTITY before writing config',
    );
  }
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const filePath = join(dir, 'moltnet.json');
  // Seed the selector when none is set, as the Go CLI and the daemon store both
  // do. Without it a first identity created from JS is unreachable by every
  // other consumer unless the operator exports MOLTNET_ACTIVE_IDENTITY by hand.
  await seedIdentitySelectorIfUnset(dir);
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
  assertCanonicalConfig(config);
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
  assertCanonicalConfig(config);
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
  assertCanonicalConfig(config);
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
  assertCanonicalConfig(config);
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
