import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

import { loadUpdateEnvConfig } from '../config.js';

/**
 * `npm install -g @themoltnet/agent-daemon@latest` resolves the registry's own
 * dist-tag, so for an npm install the registry is the precise answer — the
 * manifest serves the themolt.net pin, which gates the bundle installer's
 * default and says nothing about what npm already has. It is also the origin an
 * npm install already talks to, so this adds no new dependency in CI, where the
 * daemon runs as `npx @themoltnet/agent-daemon` and would otherwise reach for
 * api.github.com from shared runner IPs.
 *
 * Bundle and direct installs ask the release listing, and their upgrade command
 * passes `MOLTNET_AGENT_VERSION=latest` so the installer resolves the same thing
 * rather than falling back to its own pinned default. Reporting the pin here
 * would hide releases that are already downloadable; reporting the release
 * without the sentinel would advertise a version the command could not deliver.
 * The pin still governs a fresh `curl .../install/agent | sh`.
 */
export const UPDATE_RELEASES_URL =
  'https://api.github.com/repos/getlarge/themoltnet/releases?per_page=100';
const RELEASE_TAG_PREFIX = 'agent-daemon-v';
export const UPDATE_NPM_REGISTRY_URL =
  'https://registry.npmjs.org/@themoltnet/agent-daemon/latest';
export const UPDATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const UPDATE_ERROR_CACHE_TTL_MS = 5 * 60 * 1000;
export type DaemonInstallMethod = 'bundle' | 'npm' | 'direct';
export interface UpdateResult {
  currentVersion: string;
  latestVersion?: string;
  updateAvailable: boolean;
  installMethod: DaemonInstallMethod;
  releaseUrl: string;
  command: string;
}
interface UpdateCache {
  checkedAt: string;
  latest?: string;
  error?: string;
}

/**
 * Node does not resolve `process.argv[1]`: invoked through npm's bin shim it
 * reports `/usr/local/bin/moltnet-agent`, not the `node_modules` path this
 * matches on. Every global npm install therefore looked like `direct` and was
 * offered the bundle installer, which would drop a bundle on top of an npm
 * install. Resolve first; a missing path falls back to the input.
 */
export function resolveDaemonExecutable(executable: string): string {
  if (!executable) return executable;
  try {
    return realpathSync(executable);
  } catch {
    return executable;
  }
}

export function detectDaemonInstallMethod(
  executable = process.argv[1] ?? '',
): DaemonInstallMethod {
  const path = resolveDaemonExecutable(executable).replaceAll('\\', '/');
  if (path.includes('/node_modules/@themoltnet/agent-daemon/')) return 'npm';
  if (path.includes('/.local/share/moltnet/') || path.includes('/opt/moltnet/'))
    return 'bundle';
  return 'direct';
}
export function daemonUpdateCommand(method: DaemonInstallMethod): string {
  if (method === 'npm') return 'npm install -g @themoltnet/agent-daemon@latest';
  // Without the sentinel the installer would fall back to the version it was
  // pinned with, reinstalling what the user already has while the check keeps
  // reporting an update. `latest` re-resolves on every run, so the command
  // stays a stable string rather than embedding a number that goes stale.
  return 'curl -fsSL https://themolt.net/install/agent | MOLTNET_AGENT_VERSION=latest sh';
}
export async function checkDaemonUpdate(input: {
  currentVersion: string;
  force?: boolean;
  executable?: string;
  fetchFn?: typeof fetch;
  now?: Date;
}): Promise<UpdateResult> {
  const executable = input.executable ?? process.argv[1] ?? 'moltnet-agent';
  const installMethod = detectDaemonInstallMethod(executable);
  const result: UpdateResult = {
    currentVersion: normalizeVersion(input.currentVersion),
    updateAvailable: false,
    installMethod,
    releaseUrl: 'https://themolt.net/download',
    command: daemonUpdateCommand(installMethod),
  };
  const now = input.now ?? new Date();
  if (!input.force) {
    const cached = await readCache();
    const ttl = cached?.latest
      ? UPDATE_CACHE_TTL_MS
      : UPDATE_ERROR_CACHE_TTL_MS;
    if (cached && now.getTime() - Date.parse(cached.checkedAt) < ttl) {
      result.latestVersion = cached.latest;
      result.updateAvailable =
        compareVersions(cached.latest, result.currentVersion) > 0;
      return result;
    }
  }
  const viaNpm = installMethod === 'npm';
  const source = viaNpm ? UPDATE_NPM_REGISTRY_URL : UPDATE_RELEASES_URL;
  const label = viaNpm ? 'npm registry' : 'release listing';
  try {
    const response = await (input.fetchFn ?? fetch)(source, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error(`${label} returned HTTP ${response.status}`);
    const body: unknown = await response.json();
    const latest = viaNpm ? distTagVersion(body) : newestReleaseVersion(body);
    if (!latest) throw new Error(`${label} has no valid agent version`);
    await writeCache({ checkedAt: now.toISOString(), latest }).catch(
      () => undefined,
    );
    result.latestVersion = latest;
    result.updateAvailable = compareVersions(latest, result.currentVersion) > 0;
    return result;
  } catch (error) {
    await writeCache({
      checkedAt: now.toISOString(),
      error: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw new Error(
      `could not check for MoltNet agent updates: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
function distTagVersion(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const version = (value as { version?: unknown }).version;
  return typeof version === 'string' && validVersion(version)
    ? normalizeVersion(version)
    : undefined;
}
/**
 * The listing is ordered by creation date, not version, so compare every
 * candidate rather than trusting position. Drafts are filtered explicitly:
 * unauthenticated callers never see them, but a token would, and this
 * repository carries stuck drafts that would otherwise look newest.
 */
function newestReleaseVersion(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  let newest: string | undefined;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const {
      tag_name: tag,
      draft,
      prerelease,
    } = entry as Record<string, unknown>;
    if (draft === true || prerelease === true) continue;
    if (typeof tag !== 'string' || !tag.startsWith(RELEASE_TAG_PREFIX))
      continue;
    const candidate = tag.slice(RELEASE_TAG_PREFIX.length);
    if (!validVersion(candidate)) continue;
    if (!newest || compareVersions(candidate, newest) > 0)
      newest = normalizeVersion(candidate);
  }
  return newest;
}
function normalizeVersion(value: string): string {
  return value.trim().replace(/^v/, '');
}
function validVersion(value: string): boolean {
  return /^v?\d+\.\d+\.\d+$/.test(value);
}
export function compareVersions(a: string | undefined, b: string): number {
  if (!a || !validVersion(a) || !validVersion(b)) return 0;
  const left = normalizeVersion(a).split('.').map(Number);
  const right = normalizeVersion(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const leftPart = left[i] ?? 0;
    const rightPart = right[i] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }
  return 0;
}
function cachePath(): string {
  const env = loadUpdateEnvConfig();
  return join(
    env.xdgCacheHome ||
      (platform() === 'win32'
        ? env.localAppData || join(homedir(), 'AppData', 'Local')
        : join(homedir(), '.cache')),
    'moltnet',
    'updates',
    'agent.json',
  );
}
async function readCache(): Promise<UpdateCache | undefined> {
  try {
    return JSON.parse(await readFile(cachePath(), 'utf8')) as UpdateCache;
  } catch {
    return undefined;
  }
}
async function writeCache(cache: UpdateCache): Promise<void> {
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, JSON.stringify(cache), { mode: 0o600 });
}
