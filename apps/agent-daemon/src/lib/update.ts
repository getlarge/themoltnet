import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join } from 'node:path';

import { loadUpdateEnvConfig } from '../config.js';

export const UPDATE_MANIFEST_URL = 'https://themolt.net/download/manifest.json';
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

export function detectDaemonInstallMethod(
  executable = process.argv[1] ?? '',
): DaemonInstallMethod {
  const path = executable.replaceAll('\\', '/');
  if (path.includes('/node_modules/@themoltnet/agent-daemon/')) return 'npm';
  if (path.includes('/.local/share/moltnet/') || path.includes('/opt/moltnet/'))
    return 'bundle';
  return 'direct';
}
export function daemonUpdateCommand(
  method: DaemonInstallMethod,
): string {
  if (method === 'npm') return 'npm install -g @themoltnet/agent-daemon@latest';
  return 'curl -fsSL https://themolt.net/install/agent | sh';
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
  try {
    const response = await (input.fetchFn ?? fetch)(UPDATE_MANIFEST_URL, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      throw new Error(`manifest returned HTTP ${response.status}`);
    const latest = manifestVersion(await response.json());
    if (!latest) throw new Error('manifest has no valid agent version');
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
function manifestVersion(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const agent = (value as { agent?: unknown }).agent;
  if (!agent || typeof agent !== 'object') return undefined;
  const version = (agent as { version?: unknown }).version;
  return typeof version === 'string' && validVersion(version)
    ? normalizeVersion(version)
    : undefined;
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
