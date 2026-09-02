/**
 * ServeStore — the user-level configuration store behind `moltnet-agent
 * serve` (#2061). Holds secret REFERENCES and public metadata only; secret
 * values live in the sibling `secrets/` FileSecretProvider root (or, later,
 * the OS keyring under the same canonical keys). Shaped as an embryo of the
 * #1834 portable agent profile store:
 *
 *   - managed `agents/<alias>.json` files are exact `MoltNetConfig` documents;
 *   - `serve.json` activations keep aliases and external paths separate;
 *   - secret keys follow the canonical `libs/sdk` naming
 *     (`agent-key/<identityId>`, `identity/<fingerprint>/seed`);
 *   - the index is derived state — identity is re-verified against the API
 *     on activation, never trusted from local metadata alone.
 */
import { randomBytes } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

import type { MoltNetConfig } from '@themoltnet/sdk';

export const SERVE_STATE_VERSION = 1;

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const PROVIDER_ID_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertStoreName(kind: string, value: string): string {
  if (!NAME_RE.test(value)) {
    throw new ServeStoreError(
      'invalid_name',
      `${kind} must match ${NAME_RE.source}`,
    );
  }
  return value;
}

export function assertProviderId(value: string): string {
  if (!PROVIDER_ID_RE.test(value)) {
    throw new ServeStoreError(
      'invalid_name',
      `provider id must match ${PROVIDER_ID_RE.source}`,
    );
  }
  return value;
}

export class ServeStoreError extends Error {
  override name = 'ServeStoreError';
  constructor(
    readonly code:
      | 'invalid_name'
      | 'not_found'
      | 'already_exists'
      | 'invalid_state'
      | 'io_error',
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

/** `MOLTNET_SERVE_ROOT` override, else `$XDG_CONFIG_HOME/moltnet`, else `~/.config/moltnet`. */
export function resolveServeRoot(input: {
  root?: string;
  xdgConfigHome?: string;
}): string {
  const override = input.root?.trim();
  if (override) return override;
  const xdg = input.xdgConfigHome?.trim();
  return join(xdg || join(homedir(), '.config'), 'moltnet');
}

export interface ServeState {
  version: typeof SERVE_STATE_VERSION;
  /** Durable alias reservations written before remote registration starts. */
  pendingRegistrations: Record<string, PendingRegistration>;
  /** Alias/profile activations; external configs remain at `configPath`. */
  activations: Record<string, AgentActivation>;
}

export interface PendingRegistration {
  apiUrl: string;
  createdAt: string;
}

interface ActivationIdentity {
  alias: string;
  /** Identity material pinned after authenticated `whoami`. */
  identityId: string;
  publicKey: string;
  fingerprint: string;
  createdAt: string;
}

export interface ManagedAgentActivation extends ActivationIdentity {
  source: 'managed';
  /** Registration endpoint pinned with the managed identity. */
  apiUrl: string;
  configPath?: never;
  configApiUrl?: never;
}

export interface ExternalAgentActivation extends ActivationIdentity {
  source: 'external';
  /** Exact external `moltnet.json` path. Absent for managed activations. */
  configPath: string;
  /** Config endpoint pinned at attach time. */
  configApiUrl: string;
  /** Operator override used when authenticating an external config. */
  apiUrl?: string;
}

export type AgentActivation = ManagedAgentActivation | ExternalAgentActivation;

export interface ProviderEntry {
  /** Pi provider API kind, e.g. `openai-completions`. */
  api: string;
  baseUrl: string;
  /** Env var name the generated models.json references (e.g. OLLAMA_API_KEY). */
  envName: string;
  /** Model ids offered by this provider (fed by discovery later, #2064). */
  models: string[];
  /** `file:<key>` reference to the API key value; absent for keyless providers. */
  apiKeyRef?: string;
}

export type ProvidersState = Record<string, ProviderEntry>;

export function providerEnvName(providerId: string): string {
  const id = assertProviderId(providerId);
  return `MOLTNET_PROVIDER_${id.replaceAll('-', '_').toUpperCase()}_API_KEY`;
}

export function assertProviderEnvName(
  providerId: string,
  value: string,
): string {
  const expected = providerEnvName(providerId);
  if (value !== expected) {
    throw new ServeStoreError(
      'invalid_state',
      `provider envName must be ${expected}`,
    );
  }
  return value;
}

export interface RunSpec {
  agent: string;
  teamId: string;
  profiles: string[];
  taskTypes: string[];
  mode: 'poll' | 'drain';
}

export interface RunRecord extends RunSpec {
  id: string;
  status: 'running' | 'exited' | 'stopped' | 'failed';
  pid?: number;
  exitCode?: number | null;
  startedAt: string;
  endedAt?: string;
}

function readJson<T>(path: string): T | null {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw new ServeStoreError('io_error', `could not read state at ${path}`, {
      cause,
    });
  }
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new ServeStoreError('invalid_state', `corrupt JSON at ${path}`, {
      cause,
    });
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    renameSync(temp, path);
  } catch (cause) {
    try {
      rmSync(temp, { force: true });
    } catch {
      // Preserve the write failure; the unique temporary file is harmless.
    }
    throw cause;
  }
}

export class ServeStore {
  readonly root: string;
  readonly agentsDir: string;
  readonly runsDir: string;
  readonly secretsDir: string;

  constructor(root: string) {
    this.root = root;
    this.agentsDir = join(root, 'agents');
    this.runsDir = join(root, 'runs');
    this.secretsDir = join(root, 'secrets');
  }

  /** Create the directory layout (0700) if missing. Idempotent. */
  ensure(): this {
    for (const dir of [
      this.root,
      this.agentsDir,
      this.runsDir,
      this.secretsDir,
    ]) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }
    return this;
  }

  // ── serve.json ─────────────────────────────────────────────────────────

  private get servePath(): string {
    return join(this.root, 'serve.json');
  }

  readServeState(): ServeState {
    const state = readJson<unknown>(this.servePath);
    if (!state) {
      return {
        version: SERVE_STATE_VERSION,
        pendingRegistrations: {},
        activations: {},
      };
    }
    if (!isRecord(state) || state.version !== SERVE_STATE_VERSION) {
      throw new ServeStoreError(
        'invalid_state',
        `serve.json version ${String(isRecord(state) ? state.version : undefined)} is not supported`,
      );
    }
    if ('pairedOrigins' in state) {
      throw new ServeStoreError(
        'invalid_state',
        'serve.json uses the obsolete pairing format; clear the unreleased serve store and reconfigure it',
      );
    }
    if (!isRecord(state.pendingRegistrations) || !isRecord(state.activations)) {
      throw new ServeStoreError(
        'invalid_state',
        'serve.json is missing the version 1 activation map; clear the unreleased serve store and reconfigure it',
      );
    }
    for (const [alias, activation] of Object.entries(state.activations)) {
      validateActivation(alias, activation);
    }
    for (const [alias, registration] of Object.entries(
      state.pendingRegistrations,
    )) {
      assertStoreName('agent name', alias);
      if (
        !isRecord(registration) ||
        typeof registration.apiUrl !== 'string' ||
        registration.apiUrl.length === 0 ||
        typeof registration.createdAt !== 'string' ||
        registration.createdAt.length === 0
      ) {
        throw new ServeStoreError(
          'invalid_state',
          `pending registration "${alias}" is not valid`,
        );
      }
    }
    return {
      version: SERVE_STATE_VERSION,
      pendingRegistrations: state.pendingRegistrations as Record<
        string,
        PendingRegistration
      >,
      activations: state.activations as Record<string, AgentActivation>,
    };
  }

  writeServeState(state: ServeState): void {
    writeJsonAtomic(this.servePath, state);
  }

  // ── agents ─────────────────────────────────────────────────────────────

  agentPath(name: string): string {
    return storeChildPath(this.agentsDir, 'agent name', name, '.json');
  }

  readAgentConfig(alias: string): MoltNetConfig | null {
    return readJson<MoltNetConfig>(this.agentPath(alias));
  }

  writeAgentConfig(alias: string, config: MoltNetConfig): void {
    writeJsonAtomic(this.agentPath(alias), config);
  }

  removeAgentConfig(alias: string): void {
    rmSync(this.agentPath(alias), { force: true });
  }

  readActivation(alias: string): AgentActivation | null {
    return (
      this.readServeState().activations[assertStoreName('agent name', alias)] ??
      null
    );
  }

  hasPendingRegistration(alias: string): boolean {
    return Boolean(
      this.readServeState().pendingRegistrations[
        assertStoreName('agent name', alias)
      ],
    );
  }

  reserveRegistration(alias: string, apiUrl: string): void {
    const name = assertStoreName('agent name', alias);
    const state = this.readServeState();
    if (state.activations[name] || state.pendingRegistrations[name]) {
      throw new ServeStoreError(
        'already_exists',
        `agent "${name}" already exists in the serve store`,
      );
    }
    state.pendingRegistrations[name] = {
      apiUrl,
      createdAt: new Date().toISOString(),
    };
    this.writeServeState(state);
  }

  clearPendingRegistration(alias: string): void {
    const name = assertStoreName('agent name', alias);
    const state = this.readServeState();
    delete state.pendingRegistrations[name];
    this.writeServeState(state);
  }

  writeActivation(activation: AgentActivation): void {
    const alias = assertStoreName('agent name', activation.alias);
    validateActivation(alias, activation);
    const state = this.readServeState();
    state.activations[alias] = activation;
    if (activation.source === 'managed') {
      delete state.pendingRegistrations[alias];
    }
    this.writeServeState(state);
  }

  listActivations(): AgentActivation[] {
    return Object.values(this.readServeState().activations).sort((a, b) =>
      a.alias.localeCompare(b.alias),
    );
  }

  // ── providers ──────────────────────────────────────────────────────────

  private get providersPath(): string {
    return join(this.root, 'providers.json');
  }

  readProviders(): ProvidersState {
    const state = readJson<ProvidersState>(this.providersPath) ?? {};
    this.validateProviders(state);
    return state;
  }

  writeProviders(state: ProvidersState): void {
    this.validateProviders(state);
    writeJsonAtomic(this.providersPath, state);
  }

  private validateProviders(state: ProvidersState): void {
    for (const [id, provider] of Object.entries(state)) {
      assertProviderId(id);
      assertProviderEnvName(id, provider.envName);
    }
  }

  // ── runs ───────────────────────────────────────────────────────────────

  runDir(id: string): string {
    return storeChildPath(this.runsDir, 'run id', id);
  }

  resolveRunLogPath(id: string): string {
    let root: string;
    let runDir: string;
    try {
      root = realpathSync(this.runsDir);
      runDir = realpathSync(this.runDir(id));
    } catch (cause) {
      throw new ServeStoreError('io_error', 'could not resolve run directory', {
        cause,
      });
    }
    if (!isStrictDescendant(root, runDir)) {
      throw new ServeStoreError(
        'invalid_state',
        'run directory escapes its store',
      );
    }
    const logPath = join(runDir, 'daemon.log');
    try {
      const info = lstatSync(logPath);
      if (info.isSymbolicLink()) {
        throw new ServeStoreError(
          'invalid_state',
          'run log must not be a symbolic link',
        );
      }
      const resolvedLog = realpathSync(logPath);
      if (!isStrictDescendant(runDir, resolvedLog)) {
        throw new ServeStoreError('invalid_state', 'run log escapes its store');
      }
    } catch (cause) {
      if (cause instanceof ServeStoreError) throw cause;
      if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new ServeStoreError('io_error', 'could not resolve run log', {
          cause,
        });
      }
    }
    return logPath;
  }

  createRunDir(id: string): { dir: string; piDir: string; logPath: string } {
    const dir = this.runDir(id);
    const piDir = join(dir, 'pi');
    mkdirSync(piDir, { recursive: true, mode: 0o700 });
    return { dir, piDir, logPath: join(dir, 'daemon.log') };
  }

  readRun(id: string): RunRecord | null {
    return readJson<RunRecord>(join(this.runDir(id), 'run.json'));
  }

  writeRun(record: RunRecord): void {
    writeJsonAtomic(join(this.runDir(record.id), 'run.json'), record);
  }

  listRuns(limit = Number.POSITIVE_INFINITY): RunRecord[] {
    let ids: string[];
    try {
      ids = readdirSync(this.runsDir);
    } catch {
      return [];
    }
    const sortedIds = ids
      .filter((id) => NAME_RE.test(id))
      .sort()
      .reverse();
    const selectedIds = Number.isFinite(limit)
      ? sortedIds.slice(0, Math.max(0, limit))
      : sortedIds;
    const records: RunRecord[] = [];
    for (const id of selectedIds) {
      const record = this.readRun(id);
      if (record) records.push(record);
    }
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /** Remove only completed run directories outside the configured budget. */
  pruneCompletedRuns(options: {
    maxCount: number;
    maxAgeMs: number;
    maxBytes: number;
    now?: Date;
  }): string[] {
    const now = (options.now ?? new Date()).getTime();
    let retainedBytes = 0;
    let retainedCount = 0;
    const removed: string[] = [];
    for (const record of this.listRuns()) {
      if (record.status === 'running') continue;
      const dir = this.runDir(record.id);
      const bytes = directoryBytes(dir);
      const endedAt = Date.parse(record.endedAt ?? record.startedAt);
      const expired =
        !Number.isFinite(endedAt) || now - endedAt > options.maxAgeMs;
      const overCount = retainedCount >= options.maxCount;
      const overBytes = retainedBytes + bytes > options.maxBytes;
      if (expired || overCount || overBytes) {
        rmSync(dir, { recursive: true, force: true });
        removed.push(record.id);
        continue;
      }
      retainedCount += 1;
      retainedBytes += bytes;
    }
    return removed;
  }
}

function directoryBytes(path: string): number {
  let info;
  try {
    info = lstatSync(path);
  } catch {
    return 0;
  }
  if (info.isSymbolicLink()) return 0;
  if (!info.isDirectory()) return info.size;
  let total = 0;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    total += directoryBytes(join(path, entry.name));
  }
  return total;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function storeChildPath(
  root: string,
  kind: string,
  value: string,
  suffix = '',
): string {
  const name = assertStoreName(kind, value);
  const normalizedRoot = resolve(root);
  const candidate = resolve(normalizedRoot, `${name}${suffix}`);
  if (!isStrictDescendant(normalizedRoot, candidate)) {
    throw new ServeStoreError('invalid_name', `${kind} escapes its store`);
  }
  return candidate;
}

function isStrictDescendant(root: string, candidate: string): boolean {
  const rootPrefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return candidate !== root && candidate.startsWith(rootPrefix);
}

function validateActivation(alias: string, value: unknown): void {
  const invalid = (): never => {
    throw new ServeStoreError(
      'invalid_state',
      `activation "${alias}" is not a valid version 1 activation`,
    );
  };
  if (!isRecord(value)) invalid();
  const activation = value as Record<string, unknown>;
  if (activation.alias !== alias) invalid();
  if (
    !['identityId', 'publicKey', 'fingerprint', 'createdAt'].every(
      (field) =>
        typeof activation[field] === 'string' && activation[field].length > 0,
    )
  ) {
    invalid();
  }
  if (activation.source === 'managed') {
    if (
      typeof activation.apiUrl !== 'string' ||
      activation.apiUrl.length === 0 ||
      activation.configPath !== undefined ||
      activation.configApiUrl !== undefined
    )
      invalid();
    return;
  }
  if (
    activation.source !== 'external' ||
    typeof activation.configPath !== 'string' ||
    activation.configPath.length === 0 ||
    typeof activation.configApiUrl !== 'string' ||
    activation.configApiUrl.length === 0 ||
    (activation.apiUrl !== undefined && typeof activation.apiUrl !== 'string')
  ) {
    invalid();
  }
}
