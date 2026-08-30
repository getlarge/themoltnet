import { execFileSync } from 'node:child_process';
import path from 'node:path';

import type {
  HttpIpAllowInfo,
  SecretDefinition,
  VM,
} from '@earendil-works/gondolin';
import {
  createHttpHooks,
  createShadowPathPredicate,
  isWriteFlag,
  MemoryProvider,
  RealFSProvider,
  ShadowProvider,
  VmCheckpoint,
} from '@earendil-works/gondolin';

import { abortableResource, delay, throwIfAborted } from './abort-utils.js';
import {
  canonicalizeCredentialHostPattern,
  canonicalizeHostname,
  credentialHostMatches,
  networkPatternCoversCredentialPattern,
  normalizeNetworkHostPattern,
} from './canonical-host.js';
import {
  createHostOriginsOnRequest,
  type HostOriginHandler,
  hostOriginHostnames,
} from './host-origins.js';
import type { ResumeCommand, SandboxConfig } from './snapshot.js';

/**
 * Memory-backed VFS mount used by the daemon to inject task context
 * (#943 slice 1.5). This is a separate top-level mount because Gondolin
 * mounts can't nest. The agent's Gondolin-bound Read tool accepts paths
 * under this prefix (see toGuestPath in tool-operations.ts).
 *
 * Why MemoryProvider rather than a path under the workspace mount:
 *   - Injected task context is ephemeral by intent: per-task-attempt input
 *     scoped to the VM lifetime. MemoryProvider models that exactly —
 *     in-memory, per-VM-instance, zero host artefacts, automatic
 *     cleanup on VM close.
 *   - Writing under the workspace mount fails in worktrees because we symlink
 *     `.moltnet/` to the main repo (so credentials are reachable from
 *     worktrees), and Gondolin's RealFSProvider correctly refuses to
 *     create paths whose ancestors' realpath escapes the mount root.
 *     That refusal is a deliberate sandbox-escape protection, not a
 *     bug. See diary semantic entry cd27d9d3-efdc-4aec-ac0d-5fd8ce258d1f
 *     and episodic 7affbfeb-18a2-4963-aeac-c177eb2afa2d for the full
 *     investigation and the alternatives we rejected.
 */
export const GUEST_TASK_CONTEXT_MOUNT = '/moltnet-task-context';
/** Guest directory holding one PID file per projected service. */
export const GUEST_SERVICE_PID_DIR = '/run/moltnet/services';
const GUEST_SERVICE_ID_RE = /^[a-z][a-z0-9-]{0,62}$/;

function assertGuestServiceId(id: string): void {
  if (!GUEST_SERVICE_ID_RE.test(id)) {
    throw new Error(
      `Invalid guest service id "${id}": expected ${GUEST_SERVICE_ID_RE}`,
    );
  }
}
/** @deprecated Use GUEST_TASK_CONTEXT_MOUNT. */
export const GUEST_TASK_SKILLS_MOUNT = GUEST_TASK_CONTEXT_MOUNT;

/**
 * Value-free declaration of one HTTP credential delivered by the Gondolin
 * host proxy. This is an adapter contract, not a persisted runtime-profile
 * schema: trusted host code resolves the matching value for each attempt.
 */
export interface BrokeredHttpSecretDescriptor {
  /** Stable, evidence-safe logical requirement id. */
  id: string;
  /** Guest variable that receives an opaque Gondolin placeholder. */
  guestEnv: string;
  /** Hostname patterns to which the proxy may send the resolved value. */
  hosts: readonly string[];
  /** Attested upstream transport. Defaults to HTTPS. */
  protocol?: 'https' | 'http';
  /** Attested upstream ports. Defaults to 443 for HTTPS and 80 for HTTP. */
  ports?: readonly number[];
  /** Missing values fail preflight unless explicitly optional. */
  required?: boolean;
}

/** Per-attempt host binding. The value must never be persisted or evidenced. */
export interface BrokeredHttpSecretBinding extends BrokeredHttpSecretDescriptor {
  /** Resolved only by trusted host code immediately before VM resume. */
  value?: string;
}

/** Host-only capabilities that cannot widen a validated destination grant. */
export interface BrokeredHttpSecretManager {
  /** Rotate a configured secret value without changing its destination set. */
  rotateSecret(guestEnv: string, value: string): void;
  /** Revoke a configured secret for the remainder of this VM lifetime. */
  revokeSecret(guestEnv: string): void;
}

export interface VmDiagnostic {
  event:
    | 'vm.credentials.mode'
    | 'vm.http_secrets.bound'
    | 'vm.host_origins.bound'
    | 'vm.guest_projection.applied'
    | 'vm.guest_service.not_ready'
    | 'vm.network.policy_bound'
    | 'vm.network.origin_checked'
    | 'vm.network.origin_denied';
  level: 'info' | 'warning';
  message: string;
  /** Present only for the value-free broker summary event. */
  brokeredSecretCount?: number;
  /** Present only for the host-origins summary event. */
  hostOriginCount?: number;
  /** Present only for the guest-projection summary event. */
  projectedFileCount?: number;
  projectedServiceCount?: number;
  /** Complete value-free hostname inputs passed to Gondolin. */
  hostnamePolicy?: {
    allowedHosts: readonly string[];
    allowedInternalHosts: readonly string[];
  };
  /** Canonical, value-free decision for an origin check or denial. */
  origin?: {
    hostname: string;
    protocol: string;
    port: number;
    phase: 'request' | 'ip';
    allowed: boolean;
  };
}

/** Declarative, trusted-host guest projection (env, files, services). */
export interface GuestProjectionInput {
  env?: Record<string, string>;
  files?: { path: string; content: string | Uint8Array; mode?: number }[];
  services?: {
    id: string;
    command: readonly string[];
    env?: Record<string, string>;
    /** Guest path to wait for before the session starts. */
    readiness?: { path: string; timeoutMs?: number; required?: boolean };
  }[];
}

/** Lifecycle handle for projected guest services. */
export interface GuestServices {
  stop(): Promise<void>;
}

export interface VmConfig {
  /** Absolute path to the qcow2 checkpoint. */
  checkpointPath: string;
  /** MoltNet agent name (used to resolve credentials). */
  agentName: string;
  /**
   * Host root that owns `.moltnet/<agentName>/`.
   *
   * Defaults to the main git worktree for backwards compatibility. Daemon
   * callers pass the sandbox root so non-git scratch/shared tasks can boot.
   */
  agentRootDir?: string;
  /** Host directory to mount into the VM. */
  mountPath: string;
  /** Effective workspace shape selected by the caller. */
  workspaceMode?: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  /** Additional hosts to allow in egress policy. */
  extraAllowedHosts?: string[];
  /** Full sandbox config (vfs shadows, env overrides). */
  sandboxConfig?: SandboxConfig;
  /**
   * Host environment variable names to copy into the VM process.
   *
   * Runtime profiles use this for provider API keys: `requiredEnv` proves the
   * daemon host has the secret, and this allowlist forwards only those names
   * into the guest without storing secret values in the profile.
   */
  forwardEnv?: string[];
  /**
   * Trusted-host, per-attempt HTTP secret bindings. These are deliberately
   * outside SandboxConfig so remotely stored runtime profiles cannot carry
   * raw values or select host secret-provider coordinates.
   */
  brokeredSecrets?: readonly BrokeredHttpSecretBinding[];
  /**
   * Trusted-host origins answered in-process by the proxy. Keys are full
   * origins (`https://name.moltnet.internal`). Like brokered secrets these are
   * outside SandboxConfig: a remotely stored profile cannot register one.
   */
  hostOrigins?: Record<string, HostOriginHandler>;
  /**
   * Trusted-host guest projection: env merged last (after broker
   * placeholders), files written before the session starts, services run in
   * the guest for the session's lifetime. Not subject to the profile env
   * reserved-name guard — the runtime, not the profile, declares it.
   */
  guestProjection?: GuestProjectionInput;
  /** Structured credential-boundary diagnostics for daemon loggers. */
  onDiagnostic?: (diagnostic: VmDiagnostic) => void;
  /** Abort resume/setup work, closing any live VM owned by resumeVm. */
  signal?: AbortSignal;
}

export interface VmCredentials {
  /**
   * Guest env carried across the boundary. Always empty: the guest receives no
   * MoltNet credential material. Retained for API stability and because
   * consumers read (empty) provider/diary/team hints from it.
   */
  agentEnv: Record<string, string | undefined>;
}

export interface ManagedVm {
  vm: VM;
  credentials: VmCredentials;
  /** Host-only rotation and revocation handle. It cannot widen destinations. */
  secretManager: BrokeredHttpSecretManager;
  /** Projected guest services; `stop()` before closing the VM. Always present. */
  services: GuestServices;
  mountPath: string;
  guestWorkspace: string;
  agentDir: string;
}

export function resolveVfsShadowConfig(
  config: SandboxConfig | undefined,
):
  | { mode: 'none'; patterns: [] }
  | { mode: 'deny' | 'tmpfs'; patterns: string[] } {
  const patterns = config?.vfs?.shadow ?? [];
  if (patterns.length === 0) {
    return { mode: 'none', patterns: [] };
  }
  return {
    mode: config?.vfs?.shadowMode ?? 'tmpfs',
    patterns,
  };
}

export function shouldRunResumeCommand(
  entry: string | ResumeCommand,
  ctx: {
    workspaceMode: 'shared_mount' | 'dedicated_worktree' | 'scratch_mount';
  },
): boolean {
  if (typeof entry === 'string') {
    return true;
  }
  const workspaceModes = entry.when?.workspaceMode;
  if (workspaceModes && !workspaceModes.includes(ctx.workspaceMode)) {
    return false;
  }
  return true;
}

export function shouldShadowNodeModulesPath(pathname: string): boolean {
  const normalized = path.posix.normalize(pathname);
  return (
    normalized === '/node_modules' ||
    normalized.startsWith('/node_modules/') ||
    normalized.endsWith('/node_modules') ||
    normalized.includes('/node_modules/')
  );
}

function isNodeModulesBinPath(pathname: string): boolean {
  const normalized = path.posix.normalize(pathname);
  return (
    normalized.includes('/node_modules/.bin/') ||
    normalized.startsWith('/node_modules/.bin/')
  );
}

export class AutoParentMemoryProvider extends MemoryProvider {
  private ensureParentDir(pathname: string): void {
    const parent = path.posix.dirname(path.posix.normalize(pathname));
    if (!parent || parent === '/' || parent === '.') return;
    this.mkdirSync(parent, { recursive: true });
  }

  override async mkdir(
    pathname: string,
    options?: object,
  ): Promise<void | string> {
    this.ensureParentDir(pathname);
    return super.mkdir(pathname, options);
  }

  override mkdirSync(pathname: string, options?: object): void | string {
    this.ensureParentDir(pathname);
    return super.mkdirSync(pathname, options);
  }

  override async open(pathname: string, flags: string, mode?: number) {
    if (isWriteFlag(flags)) this.ensureParentDir(pathname);
    return super.open(
      pathname,
      flags,
      isWriteFlag(flags) && isNodeModulesBinPath(pathname)
        ? (mode ?? 0o755) | 0o111
        : mode,
    );
  }

  override openSync(pathname: string, flags: string, mode?: number) {
    if (isWriteFlag(flags)) this.ensureParentDir(pathname);
    return super.openSync(
      pathname,
      flags,
      isWriteFlag(flags) && isNodeModulesBinPath(pathname)
        ? (mode ?? 0o755) | 0o111
        : mode,
    );
  }
}

/**
 * Resolve the main worktree root (where .moltnet/ lives — it's untracked,
 * only exists in the main worktree, not in git worktrees).
 */
export function findMainWorktree(startPath = process.cwd()): string {
  let output: string;
  try {
    output = execFileSync(
      'git',
      ['-C', startPath, 'worktree', 'list', '--porcelain'],
      {
        encoding: 'utf8',
        stdio: 'pipe',
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Git worktree discovery requires a git repository: ${message}`,
    );
  }
  for (const block of output.split('\n\n')) {
    const lines = block.split('\n');
    const wt = lines.find((l) => l.startsWith('worktree '));
    if (wt && !lines.some((l) => l === 'bare'))
      return wt.replace('worktree ', '');
  }
  throw new Error('Could not find main git worktree');
}

export function resolveVmAgentDir(config: {
  agentName: string;
  agentRootDir?: string;
}): string {
  const rootDir = config.agentRootDir ?? findMainWorktree();
  return path.join(rootDir, '.moltnet', config.agentName);
}

export function loadCredentials(): VmCredentials {
  // Host-authenticated is the only credential boundary. The guest receives no
  // MoltNet credential files: diary/commit signing goes through the
  // `agent-signing` host capability (#1957) and HTTP credentials are brokered
  // (#1959).
  return { agentEnv: {} };
}
/**
 * Apply agent env vars to the host process, mirroring `moltnet start`.
 * Resolves relative paths (e.g. GIT_CONFIG_GLOBAL) against the repo root.
 */
export function activateAgentEnv(
  agentEnv: Record<string, string | undefined>,
  repoRoot: string,
): void {
  for (const [k, v] of Object.entries(agentEnv)) {
    if (v === undefined || v === null || v === '') continue;

    let resolved = v;
    // Resolve relative GIT_CONFIG_GLOBAL against repo root (same as Go CLI)
    if (k === 'GIT_CONFIG_GLOBAL' && !path.isAbsolute(v)) {
      resolved = path.join(repoRoot, v);
    }

    process.env[k] = resolved;
  }
}

const BASE_ALLOWED_HOSTS = [
  'api.openai.com',
  '*.openai.com',
  'chat.openai.com',
  'chatgpt.com',
  '*.chatgpt.com',
  'registry.npmjs.org',
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  // Go module proxy + storage backend
  'proxy.golang.org',
  'sum.golang.org',
  'golang.org',
  'storage.googleapis.com',
  '*.googlesource.com',
];
const DEFAULT_MOLTNET_API_URL = 'https://api.themolt.net';

/**
 * Host environment names that may intentionally cross into a
 * host-authenticated guest. This local list is the authority boundary;
 * server-supplied runtime-profile `requiredEnv` cannot widen it.
 */
const HOST_AUTHENTICATED_GUEST_ENV_ALLOWLIST = new Set([
  'ANTHROPIC_API_KEY',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_VERSION',
  'GOOGLE_API_KEY',
  'GEMINI_API_KEY',
  'MISTRAL_API_KEY',
  'GROQ_API_KEY',
  'OPENROUTER_API_KEY',
  'XAI_API_KEY',
  'CEREBRAS_API_KEY',
  'DEEPSEEK_API_KEY',
  'OLLAMA_API_KEY',
  'OLLAMA_BASE_URL',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'LINEAR_API_KEY',
]);

const RESERVED_GUEST_ENVIRONMENT_NAMES = new Set([
  'PATH',
  'HOME',
  'NODE_EXTRA_CA_CERTS',
  'MOLTNET_GUEST_WORKSPACE',
  'GIT_SSH',
  'GIT_SSH_COMMAND',
  'SSH_AUTH_SOCK',
]);

function isReservedGuestEnvironmentName(name: string): boolean {
  return (
    name.startsWith('MOLTNET_') ||
    name.startsWith('GIT_CONFIG_') ||
    RESERVED_GUEST_ENVIRONMENT_NAMES.has(name)
  );
}

export class GuestEnvironmentBoundaryError extends Error {
  constructor(public readonly refusedNames: readonly string[]) {
    super(
      'Guest credential boundary refuses runtime-controlled environment ' +
        `variables: ${refusedNames.join(', ')}. Remove them from the runtime ` +
        'profile; MoltNet operations use the trusted host-side Agent.',
    );
    this.name = 'GuestEnvironmentBoundaryError';
  }
}

export class BrokeredHttpSecretBoundaryError extends Error {
  constructor(public readonly issues: readonly string[]) {
    super(
      'Brokered HTTP secret boundary refused the resolved bindings: ' +
        issues.join('; '),
    );
    this.name = 'BrokeredHttpSecretBoundaryError';
  }
}

const BROKERED_SECRET_ID_REGEXP = /^[a-z][a-z0-9._-]{0,63}$/;
const GUEST_ENV_NAME_REGEXP = /^[A-Za-z_][A-Za-z0-9_]*$/;
const OBJECT_META_PROPERTY_NAMES = new Set([
  '__proto__',
  'constructor',
  'prototype',
]);

/**
 * Canonicalize and validate the value-free portion of a brokered binding.
 * Runtime attestation and Gondolin enforcement both consume this function so
 * the evidenced destination set cannot drift from the enforced one.
 */
export function canonicalizeBrokeredHttpSecretDescriptor(
  descriptor: BrokeredHttpSecretDescriptor,
): Required<BrokeredHttpSecretDescriptor> {
  const issues: string[] = [];
  const id = descriptor.id.trim();
  const guestEnv = descriptor.guestEnv.trim();
  const hosts: string[] = [];
  const protocolInput: unknown = descriptor.protocol ?? 'https';
  const protocol = protocolInput === 'http' ? 'http' : 'https';
  const ports = [
    ...new Set(descriptor.ports ?? [protocol === 'https' ? 443 : 80]),
  ].sort((left, right) => left - right);

  if (!BROKERED_SECRET_ID_REGEXP.test(id)) {
    issues.push(`invalid requirement id "${id || '<empty>'}"`);
  }
  if (!GUEST_ENV_NAME_REGEXP.test(guestEnv)) {
    issues.push(`requirement "${id}" has invalid guest env "${guestEnv}"`);
  } else if (
    isReservedGuestEnvironmentName(guestEnv) ||
    OBJECT_META_PROPERTY_NAMES.has(guestEnv)
  ) {
    issues.push(`requirement "${id}" uses reserved guest env "${guestEnv}"`);
  }
  for (const hostInput of descriptor.hosts) {
    try {
      hosts.push(canonicalizeCredentialHostPattern(hostInput));
    } catch {
      issues.push(
        `requirement "${id}" has invalid host pattern "${hostInput.trim()}"`,
      );
    }
  }
  const uniqueHosts = [...new Set(hosts)].sort();
  if (descriptor.hosts.length === 0) {
    issues.push(`requirement "${id}" has no destination hosts`);
  }
  if (protocolInput !== 'https' && protocolInput !== 'http') {
    issues.push(
      `requirement "${id}" has invalid protocol "${String(protocolInput)}"`,
    );
  }
  if (ports.length === 0) {
    issues.push(`requirement "${id}" has no destination ports`);
  }
  for (const port of ports) {
    if (!Number.isInteger(port) || port < 1 || port > 65_535) {
      issues.push(`requirement "${id}" has invalid port "${port}"`);
    }
  }

  if (issues.length > 0) {
    throw new BrokeredHttpSecretBoundaryError(issues);
  }
  return Object.freeze({
    id,
    guestEnv,
    hosts: Object.freeze(uniqueHosts),
    protocol,
    ports: Object.freeze(ports),
    required: descriptor.required !== false,
  });
}

/**
 * Conservative subset check for Gondolin hostname globs. Exact secret hosts
 * may sit below a broader network wildcard. A wildcard secret destination must
 * be repeated exactly (or covered by `*`) so a credential grant cannot widen
 * through an ambiguous glob comparison.
 */
function networkPatternCoversSecretPattern(
  networkPattern: string,
  secretPattern: string,
): boolean {
  return networkPatternCoversCredentialPattern(networkPattern, secretPattern);
}

/**
 * Validate value-free descriptors, host-local bindings, environment
 * collisions, and destination coverage before Gondolin creates any VM.
 */
export function prepareBrokeredHttpSecrets(options: {
  bindings?: readonly BrokeredHttpSecretBinding[];
  allowedHosts: readonly string[];
  occupiedGuestEnvNames?: readonly string[];
}): Record<string, SecretDefinition> {
  const issues: string[] = [];
  const ids = new Set<string>();
  const guestEnvNames = new Set<string>();
  const occupiedGuestEnvNames = new Set(options.occupiedGuestEnvNames ?? []);
  const allowedHosts = [
    ...new Set(options.allowedHosts.map(normalizeNetworkHostPattern)),
  ];
  const secrets = Object.create(null) as Record<string, SecretDefinition>;

  for (const binding of options.bindings ?? []) {
    let descriptor: Required<BrokeredHttpSecretDescriptor>;
    try {
      descriptor = canonicalizeBrokeredHttpSecretDescriptor(binding);
    } catch (error) {
      if (error instanceof BrokeredHttpSecretBoundaryError) {
        issues.push(...error.issues);
        continue;
      }
      throw error;
    }
    const { id, guestEnv, hosts } = descriptor;

    if (ids.has(id)) {
      issues.push(`duplicate requirement id "${id}"`);
    }
    ids.add(id);

    if (guestEnvNames.has(guestEnv)) {
      issues.push(`duplicate guest env "${guestEnv}"`);
    } else if (occupiedGuestEnvNames.has(guestEnv)) {
      issues.push(
        `guest env "${guestEnv}" is already supplied by another source`,
      );
    }
    guestEnvNames.add(guestEnv);

    for (const host of hosts) {
      if (
        !allowedHosts.some((allowedHost) =>
          networkPatternCoversSecretPattern(allowedHost, host),
        )
      ) {
        issues.push(
          `requirement "${id}" host "${host}" is outside the effective network policy`,
        );
      }
    }

    const value = binding.value;
    if (value === undefined || value === '') {
      if (descriptor.required) {
        issues.push(`required binding "${id}" has no resolved value`);
      }
      continue;
    }

    secrets[guestEnv] = { hosts: [...hosts], value };
  }

  if (issues.length > 0) {
    throw new BrokeredHttpSecretBoundaryError(issues);
  }
  return secrets;
}

interface BrokeredHttpSecretOriginPolicyEntry {
  readonly guestEnv: string;
  readonly hosts: readonly string[];
  readonly protocol: 'https' | 'http';
  readonly ports: readonly number[];
  value: string;
  deleted: boolean;
}

function decodeBasicAuthorization(value: string): string | undefined {
  const match = /^Basic\s+([^\s]+)$/i.exec(value);
  if (!match) return undefined;
  try {
    return Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return undefined;
  }
}

function headersContainSecretValue(headers: Headers, value: string): boolean {
  if (value === '') return false;
  for (const [name, headerValue] of headers.entries()) {
    if (headerValue.includes(value)) return true;
    if (
      /^(authorization|proxy-authorization)$/i.test(name) &&
      decodeBasicAuthorization(headerValue)?.includes(value)
    ) {
      return true;
    }
  }
  return false;
}

interface RequestOrigin {
  hostname: string;
  protocol: string;
  port: number;
}

function parseRequestOrigin(url: string): RequestOrigin | null {
  try {
    const parsed = new URL(url);
    const protocol = parsed.protocol.slice(0, -1);
    return {
      hostname: canonicalizeHostname(parsed.hostname),
      protocol,
      port: parsed.port ? Number(parsed.port) : protocol === 'https' ? 443 : 80,
    };
  } catch {
    return null;
  }
}

function createBrokeredHttpSecretOriginPolicy(
  bindings: readonly BrokeredHttpSecretBinding[],
): {
  isRequestAllowed: (request: Request) => boolean;
  rotateSecret: (guestEnv: string, value: string) => void;
  revokeSecret: (guestEnv: string) => void;
} {
  const entries = new Map<string, BrokeredHttpSecretOriginPolicyEntry>();
  for (const binding of bindings) {
    if (binding.value === undefined || binding.value === '') continue;
    const descriptor = canonicalizeBrokeredHttpSecretDescriptor(binding);
    entries.set(descriptor.guestEnv, {
      guestEnv: descriptor.guestEnv,
      hosts: descriptor.hosts,
      protocol: descriptor.protocol,
      ports: descriptor.ports,
      value: binding.value,
      deleted: false,
    });
  }

  return {
    isRequestAllowed(request) {
      const requestOrigin = parseRequestOrigin(request.url);
      if (!requestOrigin) return false;
      for (const entry of entries.values()) {
        if (
          entry.deleted ||
          !headersContainSecretValue(request.headers, entry.value)
        ) {
          continue;
        }
        if (
          requestOrigin.protocol !== entry.protocol ||
          !entry.ports.includes(requestOrigin.port) ||
          !entry.hosts.some((host) =>
            credentialHostMatches(requestOrigin.hostname, host),
          )
        ) {
          return false;
        }
      }
      return true;
    },
    rotateSecret(guestEnv, value) {
      const entry = entries.get(guestEnv);
      if (!entry) throw new Error(`unknown brokered secret: ${guestEnv}`);
      if (entry.deleted) {
        throw new Error(`brokered secret revoked: ${guestEnv}`);
      }
      entry.value = value;
    },
    revokeSecret(guestEnv) {
      const entry = entries.get(guestEnv);
      if (!entry) throw new Error(`unknown brokered secret: ${guestEnv}`);
      entry.deleted = true;
    },
  };
}

/**
 * Refine Gondolin's hostname allowlist for hosts carrying brokered
 * credentials. The built-in allowlist is hostname-granular; these callbacks
 * enforce the descriptor protocol and port before request or IP dispatch.
 */
export function createBrokeredHttpNetworkOriginPolicy(
  bindings: readonly BrokeredHttpSecretDescriptor[],
  options: {
    onDecision?: (
      decision: RequestOrigin & {
        phase: 'request' | 'ip';
        allowed: boolean;
      },
    ) => void;
  } = {},
): {
  isRequestAllowed: (request: Request) => boolean;
  isIpAllowed: (info: HttpIpAllowInfo) => boolean;
} {
  const origins = bindings.map(canonicalizeBrokeredHttpSecretDescriptor);
  const isAllowed = (input: {
    hostname: string;
    protocol: string;
    port: number;
    phase: 'request' | 'ip';
  }): boolean => {
    let hostname: string;
    try {
      hostname = canonicalizeHostname(input.hostname);
    } catch {
      return false;
    }
    const matching = origins.filter((origin) =>
      origin.hosts.some((host) => credentialHostMatches(hostname, host)),
    );
    if (matching.length === 0) return true;
    const allowed = matching.some(
      (origin) =>
        origin.protocol === input.protocol && origin.ports.includes(input.port),
    );
    options.onDecision?.({
      hostname,
      protocol: input.protocol,
      port: input.port,
      phase: input.phase,
      allowed,
    });
    return allowed;
  };

  return {
    isRequestAllowed(request) {
      const requestOrigin = parseRequestOrigin(request.url);
      return requestOrigin
        ? isAllowed({ ...requestOrigin, phase: 'request' })
        : false;
    },
    isIpAllowed(info) {
      return isAllowed({ ...info, phase: 'ip' });
    },
  };
}

export function assertGuestEnvironmentBoundary(options: {
  forwardEnv?: readonly string[];
  sandboxEnv?: Readonly<Record<string, string>>;
}): void {
  // Host-authenticated is the only boundary: refuse any forwarded name outside
  // the provider allowlist so a profile cannot forward arbitrary host env.
  const refusedForwardEnv = (options.forwardEnv ?? []).filter(
    (name) =>
      isReservedGuestEnvironmentName(name) ||
      !HOST_AUTHENTICATED_GUEST_ENV_ALLOWLIST.has(name),
  );
  const refusedSandboxEnv = Object.keys(options.sandboxEnv ?? {}).filter(
    isReservedGuestEnvironmentName,
  );
  const refused = [
    ...new Set([...refusedForwardEnv, ...refusedSandboxEnv]),
  ].sort();
  if (refused.length > 0) {
    throw new GuestEnvironmentBoundaryError(refused);
  }
}

/** @deprecated Alias of assertGuestEnvironmentBoundary (a single boundary). */
export function assertHostAuthenticatedGuestEnvironment(options: {
  forwardEnv?: readonly string[];
  sandboxEnv?: Readonly<Record<string, string>>;
}): void {
  assertGuestEnvironmentBoundary(options);
}

/**
 * Return whether two Gondolin hostname globs can match at least one common
 * string. Each `*` is an arbitrary substring, so this walks the product of the
 * two small glob automata instead of relying on exact-string comparisons.
 */
function hostnamePatternsOverlap(left: string, right: string): boolean {
  const a = left.trim().toLowerCase();
  const b = right.trim().toLowerCase();
  if (!a || !b) return false;

  const pending: Array<[number, number]> = [[0, 0]];
  const visited = new Set<string>();

  while (pending.length > 0) {
    const next = pending.pop();
    if (!next) continue;
    const [aIndex, bIndex] = next;
    const state = `${aIndex}:${bIndex}`;
    if (visited.has(state)) continue;
    visited.add(state);

    if (aIndex === a.length && bIndex === b.length) return true;

    const aChar = a[aIndex];
    const bChar = b[bIndex];

    // A glob star may consume no characters.
    if (aChar === '*') pending.push([aIndex + 1, bIndex]);
    if (bChar === '*') pending.push([aIndex, bIndex + 1]);

    // Or both patterns may consume one compatible character. A star remains
    // at its current state so it can consume an arbitrary-length substring.
    if (
      aChar !== undefined &&
      bChar !== undefined &&
      (aChar === '*' || bChar === '*' || aChar === bChar)
    ) {
      pending.push([
        aChar === '*' ? aIndex : aIndex + 1,
        bChar === '*' ? bIndex : bIndex + 1,
      ]);
    }
  }

  return false;
}

function assertInternalHostsDoNotOverlapProtectedHosts(
  internalHosts: string[],
  protectedHosts: string[],
): void {
  for (const internalHost of internalHosts) {
    const protectedHost = protectedHosts.find((candidate) =>
      hostnamePatternsOverlap(internalHost, candidate),
    );
    if (protectedHost) {
      throw new Error(
        `sandbox.network.allowedInternalHosts pattern "${internalHost}" overlaps external-only host pattern "${protectedHost}"`,
      );
    }
  }
}

/**
 * Run a shell command in the guest and throw if it fails. Mirror of
 * `run()` in `snapshot.ts` for the resume-side hook chain — every
 * setup step is essential to a healthy session, so a silent non-zero
 * exit (e.g. a mount that fails into the FUSE write path, or a
 * consumer-provided resume command that fails to install pnpm) must
 * surface immediately rather than fall through to cryptic agent
 * errors later.
 */
/** Single-quote a POSIX shell argument (paths/ids are pre-validated). */
function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

async function vmRun(
  vm: VM,
  label: string,
  command: string,
  signal?: AbortSignal,
): Promise<void> {
  // Wrap with `set -o pipefail` inside the script (not on the sh command
  // line, which busybox ash on Alpine doesn't accept as a flag). This
  // ensures pipelines like `foo | tail` propagate foo's non-zero exit
  // instead of masking it behind tail's success.
  const wrapped = `set -eu\nset -o pipefail\n${command}`;
  throwIfAborted(signal, `resume step "${label}"`);
  const r = await vm.exec(['sh', '-c', wrapped], { signal });
  if (r.exitCode !== 0) {
    const tail = [r.stderr, r.stdout].filter(Boolean).join('\n').slice(-800);
    throw new Error(
      `resume step "${label}" failed (exit ${r.exitCode}):\n${tail}`,
    );
  }
}

function nonErrorMessage(err: unknown): string {
  if (typeof err === 'string') return err;
  try {
    return JSON.stringify(err) ?? 'unknown error';
  } catch {
    return 'unknown error';
  }
}

/**
 * Resume a VM from a checkpoint, inject credentials, configure egress +
 * TLS. Returns the managed VM handle.
 */
export async function resumeVm(config: VmConfig): Promise<ManagedVm> {
  throwIfAborted(config.signal, 'VM resume');
  const agentDir = resolveVmAgentDir(config);
  const guestWorkspace = path.resolve(config.mountPath);

  assertGuestEnvironmentBoundary({
    forwardEnv: config.forwardEnv,
    sandboxEnv: config.sandboxConfig?.env,
  });
  config.onDiagnostic?.({
    event: 'vm.credentials.mode',
    level: 'info',
    message:
      'MoltNet agent files and non-allowlisted host environment variables are withheld from the guest',
  });

  const creds = loadCredentials();
  const apiHost = new URL(
    process.env.MOLTNET_API_URL ?? DEFAULT_MOLTNET_API_URL,
  ).hostname;

  const runtimeAllowedHosts = config.sandboxConfig?.network?.allowedHosts ?? [];
  const runtimeAllowedInternalHosts =
    config.sandboxConfig?.network?.allowedInternalHosts ?? [];
  const protectedExternalHosts = [
    ...new Set([
      ...BASE_ALLOWED_HOSTS,
      apiHost,
      ...(config.extraAllowedHosts ?? []),
    ]),
  ];
  assertInternalHostsDoNotOverlapProtectedHosts(
    runtimeAllowedInternalHosts,
    protectedExternalHosts,
  );
  const allowedHosts = [
    ...new Set([...protectedExternalHosts, ...runtimeAllowedHosts]),
  ];
  const hostOrigins = config.hostOrigins ?? {};
  const hostOriginHosts = hostOriginHostnames(hostOrigins);
  assertInternalHostsDoNotOverlapProtectedHosts(
    hostOriginHosts,
    protectedExternalHosts,
  );
  const allowedInternalHosts = [
    ...new Set([...runtimeAllowedInternalHosts, ...hostOriginHosts]),
  ];
  const requestedHostnamePolicy = Object.freeze({
    allowedHosts: Object.freeze([...allowedHosts].sort()),
    allowedInternalHosts: Object.freeze([...allowedInternalHosts].sort()),
  });
  config.onDiagnostic?.({
    event: 'vm.network.policy_bound',
    level: 'info',
    message: 'Passed the complete requested hostname policy to Gondolin',
    hostnamePolicy: requestedHostnamePolicy,
  });
  const projectedEnv = config.guestProjection?.env ?? {};

  const brokeredSecrets = prepareBrokeredHttpSecrets({
    bindings: config.brokeredSecrets,
    allowedHosts: [...allowedHosts, ...allowedInternalHosts],
    occupiedGuestEnvNames: [
      'PATH',
      'HOME',
      'NODE_NO_WARNINGS',
      'NODE_EXTRA_CA_CERTS',
      'MOLTNET_GUEST_WORKSPACE',
      ...(config.forwardEnv ?? []),
      ...Object.keys(creds.agentEnv),
      ...Object.keys(config.sandboxConfig?.env ?? {}),
      ...Object.keys(projectedEnv),
    ],
  });
  const brokeredSecretOriginPolicy = createBrokeredHttpSecretOriginPolicy(
    config.brokeredSecrets ?? [],
  );
  const brokeredNetworkOriginPolicy = createBrokeredHttpNetworkOriginPolicy(
    config.brokeredSecrets ?? [],
    {
      onDecision(decision) {
        config.onDiagnostic?.({
          event: 'vm.network.origin_checked',
          level: 'info',
          message: 'Checked a canonical brokered credential origin',
          origin: decision,
        });
        if (!decision.allowed) {
          config.onDiagnostic?.({
            event: 'vm.network.origin_denied',
            level: 'warning',
            message: 'Denied a request outside a brokered credential origin',
            origin: decision,
          });
        }
      },
    },
  );

  const {
    httpHooks,
    env: secretEnv,
    secretManager: gondolinSecretManager,
  } = createHttpHooks({
    allowedHosts,
    allowedInternalHosts,
    ...(Object.keys(brokeredSecrets).length > 0 && {
      secrets: brokeredSecrets,
      isRequestAllowed: (request: Request) =>
        brokeredNetworkOriginPolicy.isRequestAllowed(request) &&
        brokeredSecretOriginPolicy.isRequestAllowed(request),
      isIpAllowed: brokeredNetworkOriginPolicy.isIpAllowed,
    }),
    ...(hostOriginHosts.length > 0 && {
      onRequest: createHostOriginsOnRequest(hostOrigins),
    }),
  });
  const secretManager: BrokeredHttpSecretManager = Object.freeze({
    rotateSecret(guestEnv: string, value: string) {
      gondolinSecretManager.updateSecret(guestEnv, { value });
      brokeredSecretOriginPolicy.rotateSecret(guestEnv, value);
    },
    revokeSecret(guestEnv: string) {
      gondolinSecretManager.deleteSecret(guestEnv);
      brokeredSecretOriginPolicy.revokeSecret(guestEnv);
    },
  });
  const brokeredSecretCount = Object.keys(brokeredSecrets).length;
  if (brokeredSecretCount > 0) {
    config.onDiagnostic?.({
      event: 'vm.http_secrets.bound',
      level: 'info',
      brokeredSecretCount,
      message:
        `Bound ${brokeredSecretCount} HTTP secret placeholder` +
        `${brokeredSecretCount === 1 ? '' : 's'} to the host proxy`,
    });
  }
  if (hostOriginHosts.length > 0) {
    config.onDiagnostic?.({
      event: 'vm.host_origins.bound',
      level: 'info',
      hostOriginCount: hostOriginHosts.length,
      message:
        `Bound ${hostOriginHosts.length} host origin` +
        `${hostOriginHosts.length === 1 ? '' : 's'} to the host proxy`,
    });
  }

  // Build workspace VFS provider.
  //
  // `node_modules` is always shadowed into guest-local memory because host
  // dependencies are platform-specific and slow through the mounted workspace
  // bridge. Keep this layer closest to RealFSProvider so stricter caller
  // shadows, such as read-only `shadowMode: 'deny'` workspace attachments,
  // still wrap it and remain authoritative.
  const vfsConfig = resolveVfsShadowConfig(config.sandboxConfig);
  let workspaceProvider: RealFSProvider | ShadowProvider = new RealFSProvider(
    config.mountPath,
  );
  workspaceProvider = new ShadowProvider(workspaceProvider, {
    shouldShadow: ({ path: shadowPath }) =>
      shouldShadowNodeModulesPath(shadowPath),
    denySymlinkBypass: false,
    tmpfs: new AutoParentMemoryProvider(),
    writeMode: 'tmpfs',
  });
  if (vfsConfig.mode !== 'none') {
    const predicate = createShadowPathPredicate(vfsConfig.patterns);
    workspaceProvider = new ShadowProvider(workspaceProvider, {
      shouldShadow: predicate,
      writeMode: vfsConfig.mode,
    });
  }
  // The mounted workspace may expose `.moltnet/<agent>` trees; deny the guest
  // any read of them unconditionally (there is no guest-config mode that would
  // legitimately inject them).
  workspaceProvider = new ShadowProvider(workspaceProvider, {
    shouldShadow: ({ path: shadowPath }) =>
      shadowPath.split('/').includes('.moltnet'),
    denySymlinkBypass: true,
    writeMode: 'deny',
  });

  const forwardedEnv: Record<string, string> = {};
  for (const name of config.forwardEnv ?? []) {
    const value = process.env[name];
    if (value === undefined || value === '') continue;
    forwardedEnv[name] = value;
  }

  // Merge env: defaults < forwarded host env < sandbox config overrides <
  // broker placeholders. Collision validation above ensures a placeholder can
  // never silently replace another guest environment source.
  const envOverrides = config.sandboxConfig?.env ?? {};
  const vmEnv = {
    ...forwardedEnv,
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin:/usr/lib/go/bin',
    HOME: '/home/agent',
    NODE_NO_WARNINGS: '1',
    NODE_EXTRA_CA_CERTS: '/etc/ssl/certs/ca-certificates.crt',
    ...envOverrides,
    MOLTNET_GUEST_WORKSPACE: guestWorkspace,
    ...secretEnv,
    // Trusted runtime projection: declared by host code, never by a profile.
    ...projectedEnv,
  };

  const resources = config.sandboxConfig?.resources;
  const workspaceMode = config.workspaceMode ?? 'shared_mount';
  const cp = VmCheckpoint.load(config.checkpointPath);
  const vm = await abortableResource({
    promise: cp.resume({
      httpHooks,
      env: vmEnv,
      ...(resources?.memory && { memory: resources.memory }),
      ...(resources?.cpus && { cpus: resources.cpus }),
      vfs: {
        mounts: {
          [guestWorkspace]: workspaceProvider,
          // Memory-backed mount for task-context injection (#943).
          // Per-VM-instance, never persisted, never shared.
          [GUEST_TASK_CONTEXT_MOUNT]: new MemoryProvider(),
        },
      },
    }),
    signal: config.signal,
    label: 'VM resume',
    cleanup: (resumedVm) => resumedVm.close(),
    onCleanupError: (err) => {
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(
        `[vm] aborted resume late vm.close() failed: ${message}\n`,
      );
    },
  });

  // Everything past cp.resume() owns the live VM. Any throw between
  // here and the final `return { vm, ... }` must close the VM, or the
  // qemu child process (visible in `process.getActiveResourcesInfo()`
  // as `ProcessWrap` + ~12 `PipeWrap` for its stdio fds) keeps the
  // Node event loop alive, and `executePiTask`'s own finally block
  // never runs because it depends on the resolved `managed` handle
  // we're about to return.
  // Projected guest services are tracked so they can be stopped before the VM
  // closes (setup failure or normal teardown). Declared before `try` so the
  // catch path can abort them as well.
  const servicesAbort = new AbortController();
  const serviceHandles: Promise<unknown>[] = [];
  const serviceIds: string[] = [];
  const services: GuestServices = {
    async stop() {
      if (serviceIds.length > 0) {
        const pidFiles = serviceIds
          .map((id) => `${GUEST_SERVICE_PID_DIR}/${id}.pid`)
          .join(' ');
        try {
          await vm.exec(
            [
              'sh',
              '-c',
              `for f in ${pidFiles}; do [ -f "$f" ] || continue; pid=$(cat "$f"); ` +
                'kill -TERM -- "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true; done; sleep 0.2; ' +
                `for f in ${pidFiles}; do [ -f "$f" ] || continue; pid=$(cat "$f"); ` +
                'kill -KILL -- "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null || true; rm -f "$f"; done',
            ],
            { stdout: 'ignore', stderr: 'ignore' },
          );
        } catch {
          // The VM may already be gone; aborting the handles below is enough.
        }
        serviceIds.length = 0;
      }
      servicesAbort.abort();
      await Promise.allSettled(serviceHandles);
    },
  };

  try {
    // Fix TLS: append Gondolin MITM CA to system trust store.
    // Unofficial-builds Node ships its own OpenSSL which can't load
    // NODE_EXTRA_CA_CERTS from /etc/gondolin/mitm/ca.crt (error 8000000D).
    await vmRun(
      vm,
      'TLS certificates',
      `
    cp /etc/gondolin/mitm/ca.crt /usr/local/share/ca-certificates/gondolin-mitm.crt
    update-ca-certificates 2>/dev/null
    cat /etc/gondolin/mitm/ca.crt >> /etc/ssl/certs/ca-certificates.crt
  `,
      config.signal,
    );

    // Fix DNS: ensure working resolvers (VM gateway DNS may not forward
    // correctly) and wait for resolution to actually work before downstream
    // resumeCommands run. Without the wait we've observed EAI_AGAIN errors
    // on pnpm fetch when the resolver isn't ready yet at the moment of
    // first lookup — Gondolin's resumed VM is a fresh overlay so any
    // resolv.conf baked into the snapshot is replaced, and there's a brief
    // race between our write here and DHCP/udhcpc finishing.
    // Fix DNS: ensure working resolvers. Note Gondolin's MITM proxy returns
    // RFC 5737 placeholder IPs (192.0.2.1 IPv4, 2001:db8::1 IPv6) for every
    // hostname — actual routing happens transparently in the proxy. Node's
    // default dual-stack behavior can attempt the unreachable IPv6 first
    // and fail with EAI_AGAIN; consumers needing reliable resolution
    // should set NODE_OPTIONS=--dns-result-order=ipv4first via
    // sandbox.json#env (and curl --4 / similar for shell tools).
    await vmRun(
      vm,
      'DNS resolvers',
      `printf 'nameserver 8.8.8.8\\nnameserver 1.1.1.1\\n' > /etc/resolv.conf`,
      config.signal,
    );

    // Tell git that the workspace mount is trusted regardless of UID. The host
    // workspace is bind-mounted into the VM via Gondolin's RealFSProvider,
    // so the on-disk owner is the host's UID (typically 501) — not the guest's
    // 'agent' user (also UID 501 by happy coincidence, but git checks against
    // file ownership at the filesystem level). Without this, every git command
    // inside the VM emits 'detected dubious ownership' and exits 128. Setting
    // this system-wide rather than per-user covers both root (post-resume
    // setup) and agent (task workload) callers.
    await vmRun(
      vm,
      'git safe.directory',
      `git config --system --add safe.directory '*'`,
      config.signal,
    );

    // Consumer-provided per-resume commands. Repo-specific bootstrap
    // (corepack-install a pinned pnpm, `pnpm fetch`, lightweight repo-local
    // setup) belongs here, not in vm-manager. pi-extension stays
    // package-manager-agnostic.
    // Sequential, first failure aborts resume via vmRun. Per-step opt-in
    // retries (object form: `{ run, retries, retryBackoffMs }`) cover
    // network-bound idempotent steps that race DHCP/registry availability
    // on a fresh resume (e.g. pnpm install, go mod download).
    for (const [i, entry] of (
      config.sandboxConfig?.resumeCommands ?? []
    ).entries()) {
      if (!shouldRunResumeCommand(entry, { workspaceMode })) {
        continue;
      }
      const { run, retries, backoffMs } =
        typeof entry === 'string'
          ? { run: entry, retries: 0, backoffMs: 2000 }
          : {
              run: entry.run,
              retries: entry.retries ?? 0,
              backoffMs: entry.retryBackoffMs ?? 2000,
            };
      const label = `resumeCommands[${i}]`;
      let lastErr: unknown;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          await vmRun(vm, label, run, config.signal);
          lastErr = undefined;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt === retries) break;
          await delay((attempt + 1) * backoffMs, config.signal, label);
        }
      }
      if (lastErr) {
        throw lastErr instanceof Error
          ? lastErr
          : new Error(nonErrorMessage(lastErr));
      }
    }

    // Host-authenticated guests never receive a `/home/agent/.moltnet` tree.
    const projectedFiles = config.guestProjection?.files ?? [];
    const projectedDirs = [
      ...new Set(projectedFiles.map((file) => path.posix.dirname(file.path))),
    ];
    const guestDirs = [...projectedDirs];
    if (guestDirs.length > 0) {
      await vmRun(
        vm,
        'create guest directories',
        `mkdir -p ${guestDirs.map(shellQuote).join(' ')}`,
        config.signal,
      );
    }

    for (const file of projectedFiles) {
      await vm.fs.writeFile(file.path, file.content, {
        mode: file.mode ?? 0o644,
        signal: config.signal,
      });
      // The VFS write does not reliably apply `mode` (an executable projected
      // as 0o755 landed as 0o644); set it explicitly so services can start.
      if (file.mode !== undefined) {
        await vmRun(
          vm,
          `chmod projected file ${file.path}`,
          `chmod ${file.mode.toString(8)} ${shellQuote(file.path)}`,
          config.signal,
        );
      }
    }

    // Chown the actual projected directories under the agent home (not a fixed
    // `.config`) so e.g. `/home/agent/bin/...` is owned by the agent. `.pi` is
    // optional: host-authenticated and env-only sessions never create it, so
    // each target is existence-guarded — a missing optional dir is skipped
    // while a real chown failure on a present dir still aborts (set -e).
    const chownTargets = projectedDirs.filter((dir) =>
      dir.startsWith('/home/agent/'),
    );
    await vmRun(
      vm,
      'chown guest directories',
      `set -e; for d in ${chownTargets
        .map(shellQuote)
        .join(
          ' ',
        )}; do if [ -e "$d" ]; then chown -R agent:agent "$d"; fi; done`,
      config.signal,
    );

    // Projected services run for the session; they are never awaited here.
    // Each one records its guest PID so `services.stop()` can terminate the
    // process: aborting the exec handle only detaches the host side.
    const projectedServices = config.guestProjection?.services ?? [];
    if (projectedServices.length > 0) {
      await vmRun(
        vm,
        'create service pid directory',
        `mkdir -p ${GUEST_SERVICE_PID_DIR}`,
        config.signal,
      );
    }
    for (const service of projectedServices) {
      assertGuestServiceId(service.id);
      // setsid makes the wrapper a session/process-group leader (pgid == pid)
      // so stop() can kill the whole tree, not just the leader.
      const handle = vm.exec(
        [
          'setsid',
          'sh',
          '-c',
          `echo $$ > ${GUEST_SERVICE_PID_DIR}/${service.id}.pid && exec "$@"`,
          'moltnet-service',
          ...service.command,
        ],
        {
          stdout: 'ignore',
          stderr: 'ignore',
          ...(service.env && { env: service.env }),
          signal: servicesAbort.signal,
        },
      );
      serviceHandles.push(Promise.resolve(handle).catch(() => undefined));
      serviceIds.push(service.id);
    }
    // Readiness: probe every service that declares a path concurrently under
    // its own deadline. A missing best-effort service degrades with a
    // diagnostic; a `required` one fails the session.
    async function awaitServiceReady(service: {
      id: string;
      readiness?: { path: string; timeoutMs?: number; required?: boolean };
    }): Promise<void> {
      if (!service.readiness) return;
      const deadline = Date.now() + (service.readiness.timeoutMs ?? 10_000);
      const pidFile = `${GUEST_SERVICE_PID_DIR}/${service.id}.pid`;
      let ready = false;
      while (Date.now() < deadline) {
        throwIfAborted(config.signal, `service "${service.id}" readiness`);
        // Readiness requires BOTH the declared path AND the recorded process
        // still running: a bare path check accepts a stale socket left by a
        // prior crashed service, and misses a service that created its socket
        // then exited. `kill -0 <pid>` closes both gaps.
        const probe = await vm.exec(
          [
            'sh',
            '-c',
            '[ -e "$1" ] && [ -r "$2" ] && kill -0 "$(cat "$2" 2>/dev/null)" 2>/dev/null',
            'moltnet-readiness',
            service.readiness.path,
            pidFile,
          ],
          { stdout: 'ignore', stderr: 'ignore', signal: config.signal },
        );
        if (probe.exitCode === 0) {
          ready = true;
          break;
        }
        await new Promise((resolve) => {
          setTimeout(resolve, 200);
        });
      }
      if (!ready) {
        if (service.readiness.required) {
          throw new Error(
            `Projected guest service "${service.id}" did not become ready: ${service.readiness.path} absent or its process exited`,
          );
        }
        // Best-effort service (e.g. a signing socket whose guest CLI may
        // predate the subcommand): degrade rather than fail the task. The
        // capability's own operations surface a clear error if used.
        config.onDiagnostic?.({
          event: 'vm.guest_service.not_ready',
          level: 'warning',
          message:
            `Projected guest service "${service.id}" did not become ready ` +
            `(${service.readiness.path} absent or its process exited); continuing without it`,
        });
      }
    }
    await Promise.all(
      projectedServices.map((service) => awaitServiceReady(service)),
    );
    if (projectedFiles.length > 0 || projectedServices.length > 0) {
      config.onDiagnostic?.({
        event: 'vm.guest_projection.applied',
        level: 'info',
        projectedFileCount: projectedFiles.length,
        projectedServiceCount: projectedServices.length,
        message:
          `Applied guest projection: ${projectedFiles.length} file(s), ` +
          `${projectedServices.length} service(s)`,
      });
    }

    // Git push/pull auth over HTTPS comes entirely from the injected gitconfig
    // the non-secret gitconfig projected by the agent-signing capability:
    // the tokenless `moltnet github
    // credential-helper` plus the `insteadOf` SSH→HTTPS rewrite that
    // `moltnet github setup` writes into the agent gitconfig. No hand-rolled
    // credential script and no imperative `git config --global` here — that
    // parallel mechanism could drift from the CLI source of truth and was the
    // shape that leaked tokens into git config (#1396). Agents whose gitconfig
    // predates `github setup` writing the helper should re-run
    // `moltnet github setup` or `moltnet config repair`.

    return {
      vm,
      credentials: creds,
      secretManager,
      services,
      mountPath: config.mountPath,
      guestWorkspace,
      agentDir,
    };
  } catch (err) {
    servicesAbort.abort();
    // Anything after cp.resume() owns the live VM. If setup throws
    // (TLS, DNS, safe.directory, tmpfs mounts, resumeCommands, …),
    // close the qemu process before rethrowing — otherwise the
    // ProcessWrap + ~12 PipeWrap handles leak and Node's event
    // loop sticks around forever after the daemon's main() resolves.
    try {
      await vm.close();
    } catch (closeErr) {
      const m = closeErr instanceof Error ? closeErr.message : String(closeErr);
      process.stderr.write(`[vm] post-throw vm.close() failed: ${m}\n`);
    }
    throw err;
  }
}
