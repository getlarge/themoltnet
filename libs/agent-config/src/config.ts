import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  chmod,
  link,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, dirname, join, sep } from 'node:path';

import { withConfigLock } from './config-lock.js';

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

export function agentKeyKey(subjectId: string, teamId?: string): string {
  return `agent-key/${subjectId}${teamId ? `/${teamId}` : ''}`;
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
export interface AgentKeyConfiguration {
  agent_key_ref?: SecretReference;
  agent_key_refs?: Record<string, SecretReference>;
}

type MoltNetAuthenticationConfig = AgentKeyConfiguration &
  (
    | { agent_key_ref: SecretReference; oauth2?: OAuth2Config }
    | { agent_key_refs: Record<string, SecretReference>; oauth2?: OAuth2Config }
    | { oauth2: OAuth2Config }
  );

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
 * The one identity-alias grammar. Must stay identical to `AGENT_ALIAS_PATTERN`
 * in `@moltnet/models` (the REST `AgentAliasSchema`) and agentNamePattern in
 * apps/moltnet-cli (Go); the daemon's AgentServerStore reuses this constant
 * directly. An alias is a directory name in a store all of them write and the
 * value the CLI publishes as the network alias, so a value one accepts and
 * another rejects makes an identity unreadable by half the system or
 * unpublishable. The literal is repeated rather than imported because this
 * package is bundled into published packages that must not pick up models'
 * typebox dependency; `identity-alias.test.ts` pins all three copies.
 */
const identitiesDirName = 'identities';

export const IDENTITY_ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;

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
 * Idempotent: an existing default is never overwritten. The selector lives
 * beside the `identities` directory the config is written into, so a store
 * with a custom root (the daemon's agent server) seeds its own selector
 * instead of the default one under the home directory.
 */
async function seedIdentitySelectorIfUnset(identityDir: string): Promise<void> {
  const alias = identityDir.split(sep).pop();
  if (!alias || !IDENTITY_ALIAS_PATTERN.test(alias)) return;
  const parent = dirname(identityDir);
  const root =
    basename(parent) === identitiesDirName
      ? dirname(parent)
      : // Not under an `identities` directory, so no store root can be
        // inferred from the path: fall back to the default store root.
        getConfigDir();
  const selectorPath = join(root, 'identity-selector.json');
  try {
    const existing = JSON.parse(
      await readFile(selectorPath, 'utf-8'),
    ) as IdentitySelector;
    if (existing.default_identity?.trim()) return;
  } catch {
    // Absent or unreadable: write a fresh one below.
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
  await writeFile(
    selectorPath,
    JSON.stringify({ version: 1, default_identity: alias }, null, 2) + '\n',
    { mode: 0o600 },
  );
}

/**
 * The active identity's document, or null when no identity resolves.
 *
 * The honest counterpart to getConfigPath: a `string` return cannot express
 * "there is no active identity", which is why that function has to invent a
 * path. Prefer this wherever the absence matters.
 */
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

export interface WriteConfigOptions {
  /**
   * Create the config only if none exists; otherwise reject with an `EEXIST`
   * error and leave the existing file untouched. The check and the write are
   * one atomic link, so two concurrent writers cannot both succeed.
   */
  exclusive?: boolean;
}

export async function writeConfig(
  config: MoltNetConfig,
  configDir?: string,
  options: WriteConfigOptions = {},
): Promise<string> {
  const path = await resolveConfigPath(configDir);
  if (!path)
    throw new Error('no active identity selected before writing config');
  return withConfigLock(path, () =>
    writeConfigUnlocked(config, dirname(path), options),
  );
}

async function writeConfigUnlocked(
  config: MoltNetConfig,
  configDir?: string,
  options: WriteConfigOptions = {},
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
  const contents = JSON.stringify(config, null, 2) + '\n';
  // Write to a sibling temp file, then commit it so the config is either fully
  // committed or untouched; callers rely on this when rolling back secrets.
  // An exclusive write commits with link(), which fails if the target exists;
  // a normal write replaces the target with rename().
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempPath, contents, { mode: 0o600 });
    await chmod(tempPath, 0o600);
    if (options.exclusive) {
      await linkExclusive(tempPath, filePath, contents);
    } else {
      await rename(tempPath, filePath);
    }
  } finally {
    await rm(tempPath, { force: true }).catch(() => undefined);
  }
  // Seed the selector when none is set, as the Go CLI and the daemon store both
  // do. Without it a first identity created from JS is unreachable by every
  // other consumer unless the operator exports MOLTNET_ACTIVE_IDENTITY by hand.
  // Only after the commit, so a writer that lost an exclusive race never
  // points the selector at a config it did not write.
  await seedIdentitySelectorIfUnset(dir);
  return filePath;
}

/** Error codes of a filesystem that cannot create hard links. */
const HARD_LINK_UNSUPPORTED = new Set([
  'ENOTSUP',
  'EOPNOTSUPP',
  'ENOSYS',
  'EPERM',
  'EXDEV',
]);

/**
 * Create `filePath` from `tempPath` only if nothing is there. Without hard
 * links, an exclusive open keeps the create-once guarantee; a reader may then
 * briefly see a partial file, and a failed write removes what it created.
 */
async function linkExclusive(
  tempPath: string,
  filePath: string,
  contents: string,
): Promise<void> {
  try {
    await link(tempPath, filePath);
    return;
  } catch (error) {
    if (
      !HARD_LINK_UNSUPPORTED.has((error as NodeJS.ErrnoException).code ?? '')
    ) {
      throw error;
    }
  }
  const handle = await open(filePath, 'wx', 0o600);
  try {
    await handle.writeFile(contents);
  } catch (error) {
    await handle.close();
    await rm(filePath, { force: true });
    throw error;
  }
  await handle.close();
}

/** Reload and mutate inside the shared writer lock; unknown fields survive. */
export async function updateConfig(
  mutate: (config: MoltNetConfig) => void | Promise<void>,
  configDir?: string,
): Promise<void> {
  const path = await resolveConfigPath(configDir);
  if (!path) throw new Error('No config found — run `moltnet register` first');
  const dir = dirname(path);
  await withConfigLock(path, async () => {
    const config = await readConfig(dir);
    if (!config)
      throw new Error('No config found — run `moltnet register` first');
    assertCanonicalConfig(config);
    await mutate(config);
    await writeConfigUnlocked(config, dir);
  });
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
  await updateConfig((config) => {
    const existing =
      (config[section] as Record<string, unknown> | undefined) ?? {};
    Object.assign(config, { [section]: { ...existing, ...data } });
  }, configDir);
}

/** Replace the OAuth2 union atomically so the opposite secret form is removed. */
export async function updateOAuth2Config(
  oauth2: OAuth2Config,
  configDir?: string,
): Promise<void> {
  const plaintext = oauth2.client_secret?.trim();
  const reference = oauth2.client_secret_ref;
  if (!oauth2.client_id.trim() || Boolean(plaintext) === Boolean(reference)) {
    throw new Error(
      'OAuth2 config must set client_id and exactly one of client_secret or client_secret_ref',
    );
  }
  await updateConfig((config) => {
    config.oauth2 = oauth2;
  }, configDir);
}

/** Replace the keys union atomically so the opposite seed form is removed. */
export async function updateKeysConfig(
  keys: KeysConfig,
  configDir?: string,
): Promise<void> {
  const plaintext = keys.private_key?.trim();
  const reference = keys.private_key_ref;
  if (!keys.public_key.trim() || Boolean(plaintext) === Boolean(reference)) {
    throw new Error(
      'Keys config must set public_key and exactly one of private_key or private_key_ref',
    );
  }
  await updateConfig((config) => {
    config.keys = keys;
  }, configDir);
}

/** Replace the GitHub union atomically so the opposite PEM form is removed. */
export async function updateGitHubConfig(
  github: GitHubConfig,
  configDir?: string,
): Promise<void> {
  const path = github.private_key_path?.trim();
  const reference = github.private_key_ref;
  if (!github.app_id.trim() || Boolean(path) === Boolean(reference)) {
    throw new Error(
      'GitHub config must set app_id and exactly one of private_key_path or private_key_ref',
    );
  }
  await updateConfig((config) => {
    config.github = github;
  }, configDir);
}
