/**
 * ServeStore — the user-level configuration store behind `moltnet-agent
 * serve` (#2061). Holds secret REFERENCES and public metadata only; secret
 * values live in the sibling `secrets/` FileSecretProvider root (or, later,
 * the OS keyring under the same canonical keys). Shaped as an embryo of the
 * #1834 portable agent profile store:
 *
 *   - agent entries carry `moltnet.json`-compatible public fields;
 *   - secret keys follow the canonical `libs/sdk` naming
 *     (`agent-key/<identityId>`, `identity/<fingerprint>/seed`);
 *   - the index is derived state — identity is re-verified against the API
 *     on activation, never trusted from local metadata alone.
 */
import { randomBytes } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const SERVE_STATE_VERSION = 1;

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

export function assertStoreName(kind: string, value: string): string {
  if (!NAME_RE.test(value)) {
    throw new ServeStoreError(
      'invalid_name',
      `${kind} must match ${NAME_RE.source}`,
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
      | 'invalid_state',
    message: string,
  ) {
    super(message);
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

export interface PairedOriginRecord {
  tokenHash: string;
  createdAt: string;
}

export interface ServeState {
  version: typeof SERVE_STATE_VERSION;
  /** Console origins approved via the pairing ceremony, token hashes at rest. */
  pairedOrigins: Record<string, PairedOriginRecord>;
}

export interface ManagedAgentEntry {
  version: 1;
  kind: 'managed';
  agentName: string;
  identityId: string;
  publicKey: string;
  fingerprint: string;
  apiUrl: string;
  /** `<provider>:<key>` secret references — values never live here. */
  agentKeyRef: string;
  privateKeyRef: string;
  createdAt: string;
}

export interface ExternalAgentEntry {
  version: 1;
  kind: 'external';
  agentName: string;
  /** Absolute path to an existing `.moltnet/<agent>` directory. */
  configDir: string;
  apiUrl?: string;
  identityId?: string;
  fingerprint?: string;
  createdAt: string;
}

export type AgentEntry = ManagedAgentEntry | ExternalAgentEntry;

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
  } catch {
    return null;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (cause) {
    throw new ServeStoreError(
      'invalid_state',
      `corrupt JSON at ${path}: ${(cause as Error).message}`,
    );
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  const temp = `${path}.${randomBytes(6).toString('hex')}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
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
    const state = readJson<ServeState>(this.servePath);
    if (!state) return { version: SERVE_STATE_VERSION, pairedOrigins: {} };
    if (state.version !== SERVE_STATE_VERSION) {
      throw new ServeStoreError(
        'invalid_state',
        `serve.json version ${String(state.version)} is not supported`,
      );
    }
    return state;
  }

  writeServeState(state: ServeState): void {
    writeJsonAtomic(this.servePath, state);
  }

  // ── agents ─────────────────────────────────────────────────────────────

  agentPath(name: string): string {
    return join(this.agentsDir, `${assertStoreName('agent name', name)}.json`);
  }

  readAgent(name: string): AgentEntry | null {
    return readJson<AgentEntry>(this.agentPath(name));
  }

  writeAgent(entry: AgentEntry): void {
    writeJsonAtomic(this.agentPath(entry.agentName), entry);
  }

  listAgents(): AgentEntry[] {
    let files: string[];
    try {
      files = readdirSync(this.agentsDir);
    } catch {
      return [];
    }
    const entries: AgentEntry[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const entry = readJson<AgentEntry>(join(this.agentsDir, file));
      if (entry) entries.push(entry);
    }
    return entries.sort((a, b) => a.agentName.localeCompare(b.agentName));
  }

  // ── providers ──────────────────────────────────────────────────────────

  private get providersPath(): string {
    return join(this.root, 'providers.json');
  }

  readProviders(): ProvidersState {
    return readJson<ProvidersState>(this.providersPath) ?? {};
  }

  writeProviders(state: ProvidersState): void {
    for (const id of Object.keys(state)) assertStoreName('provider id', id);
    writeJsonAtomic(this.providersPath, state);
  }

  // ── runs ───────────────────────────────────────────────────────────────

  runDir(id: string): string {
    return join(this.runsDir, assertStoreName('run id', id));
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

  listRuns(): RunRecord[] {
    let ids: string[];
    try {
      ids = readdirSync(this.runsDir);
    } catch {
      return [];
    }
    const records: RunRecord[] = [];
    for (const id of ids) {
      if (!NAME_RE.test(id)) continue;
      const record = this.readRun(id);
      if (record) records.push(record);
    }
    return records.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
}
