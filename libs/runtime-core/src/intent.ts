import type { RequirementLevel } from './states.js';

/**
 * Reference to a stored MoltNet runtime profile. The governance core never
 * redefines the stored profile schema; it projects the fields it governs.
 */
export interface GovernanceIntentRef {
  id: string;
  /** Monotonic revision of the stored profile. */
  revision: number;
  /** Content identifier of the stored definition, when known. */
  definitionCid?: string;
}

/** Same vocabulary as the MoltNet allowed-tools response and `decideToolCall()`. */
export type ToolEnforcementMode = 'off' | 'watch' | 'enforce';

export interface ToolPolicyIntent {
  enforcement: ToolEnforcementMode;
  /** Structured tool names plus shell executable names. */
  allowedTools: readonly string[];
  /** Shell argv prefixes; each needs at least two tokens. */
  allowedShellCommands: readonly (readonly string[])[];
}

/**
 * Portable sandbox capabilities an intent can request. Trusted deployment
 * configuration selects the adapter that provides them.
 */
export type SandboxCapability =
  | 'filesystem-scope'
  | 'network-egress'
  | 'child-process-containment'
  | 'resource-limits'
  | 'host-env-isolation'
  | 'brokered-credential'
  | 'timeout-cancellation';

export const SANDBOX_CAPABILITIES: readonly SandboxCapability[] = Object.freeze(
  [
    'filesystem-scope',
    'network-egress',
    'child-process-containment',
    'resource-limits',
    'host-env-isolation',
    'brokered-credential',
    'timeout-cancellation',
  ],
);

/**
 * Host-side powers that a guest sandbox can never contain. An intent lists
 * them so the plan and session report them outside containment instead of
 * implying coverage.
 */
export type HostPower = 'host-exec' | 'host-mcp';

export interface FilesystemScopeIntent {
  workspace: 'read-write' | 'read-only';
  /** Workspace-relative paths the guest must not mutate. */
  denyPaths: readonly string[];
  /** `deny` rejects writes; `tmpfs` accepts them into guest-local memory. */
  denyMode: 'deny' | 'tmpfs';
}

/**
 * Structured destination. `host` is a hostname pattern (optionally `*.`
 * prefixed, same grammar as the stored profile); `scheme` and `port` narrow
 * it. An adapter declares which of these it can enforce (`NetworkFidelity`).
 */
export interface DestinationConstraint {
  host: string;
  scheme?: 'http' | 'https';
  port?: number;
}

export function formatDestination(d: DestinationConstraint): string {
  return `${d.scheme ? `${d.scheme}://` : ''}${d.host}${d.port !== undefined ? `:${d.port}` : ''}`;
}

/** True when `inner` is no broader than `outer` on every specified axis. */
export function destinationWithin(
  inner: DestinationConstraint,
  outer: DestinationConstraint,
): boolean {
  if (inner.host.toLowerCase() !== outer.host.toLowerCase()) return false;
  if (outer.scheme !== undefined && inner.scheme !== outer.scheme) return false;
  if (outer.port !== undefined && inner.port !== outer.port) return false;
  return true;
}

export interface NetworkPolicyIntent {
  /** Destinations allowed for egress. Empty means no requested egress. */
  allowedDestinations: readonly DestinationConstraint[];
  /** Host patterns explicitly allowed to resolve to internal/private ranges. */
  allowedInternalHosts: readonly string[];
  /**
   * Whether the intent accepts the adapter's mandatory platform egress
   * (model provider, MoltNet API, package registries). When `false` and the
   * adapter has mandatory egress, `network-egress` resolves as `degraded`.
   */
  acceptPlatformEgress: boolean;
}

export interface ResourceLimitsIntent {
  memory?: string;
  cpus?: number;
}

/**
 * Portable credential requirement. It names purpose, consumer, destinations
 * and acceptable delivery. It never carries a provider coordinate or a value.
 * The trusted binding, not this requirement, is authoritative for where the
 * value may go; resolution refuses a requirement broader than its binding.
 */
export interface CredentialRequirement {
  id: string;
  purpose: string;
  consumer: 'guest-process' | 'host-broker' | 'coding-agent';
  destinations: readonly DestinationConstraint[];
  /** `brokered-http` substitutes a placeholder at the host boundary. */
  delivery: 'brokered-http';
  /** Environment name the guest sees a stand-in under. */
  envName: string;
  required: boolean;
}

/**
 * Knowledge Factory context reference. An intent may pin a rendered context
 * input; resolution records provenance, and the coding-agent adapter injects
 * it through its native mechanism. Context informs the agent; it is not an
 * enforcement claim.
 */
export interface ContextReference {
  slug: string;
  binding: 'skill' | 'context_inline' | 'prompt_prefix' | 'user_inline';
  /** Pinned revision or content identifier, when the intent pins one. */
  pinned?: string;
}

export interface SandboxIntent {
  filesystem: FilesystemScopeIntent;
  network: NetworkPolicyIntent;
  resources?: ResourceLimitsIntent;
}

/**
 * Governance intent: editable requirements plus references projected from a
 * stored runtime profile. It says what is required, not how a particular
 * machine provides it. No adapter ids, host paths, commands, hook placement,
 * or secrets belong here.
 */
export interface GovernanceIntent {
  ref: GovernanceIntentRef;
  toolPolicy: ToolPolicyIntent;
  sandbox: SandboxIntent;
  /** Capabilities the intent needs, with how strongly it needs them. */
  capabilities: Readonly<Partial<Record<SandboxCapability, RequirementLevel>>>;
  credentials: readonly CredentialRequirement[];
  /** Named non-secret runtime inputs that must exist before launch. */
  runtimeInputs: readonly string[];
  context: readonly ContextReference[];
  /** Host powers the intent expects to use outside guest containment. */
  hostPowers: readonly HostPower[];
}

export class GovernanceIntentValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'GovernanceIntentValidationError';
  }
}

// Shared with the stored runtime-profile schema (libs/tasks
// runtime-profiles.ts): same hostname grammar, memory syntax, cpu range and
// list limits, so an intent the core accepts is one the stored schema accepts.
export const HOST_PATTERN =
  /^(?:\*\.)?(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;
export const MEMORY_PATTERN = /^[0-9]+[KMG]?$/;
export const MAX_CPUS = 32;
export const MAX_HOSTS = 50;
export const MAX_DENY_PATHS = 100;
const HOST_PATH_PATTERN = /^(?:[A-Za-z]:\\|\/|~\/)/;
const ENV_NAME_PATTERN = /^[A-Z][A-Z0-9_]*$/;

export function validateDestination(
  d: DestinationConstraint,
  label: string,
  issues: string[],
): void {
  if (d.host.length > 255 || !HOST_PATTERN.test(d.host)) {
    issues.push(`${label} host "${d.host}" is not a hostname pattern`);
  }
  if (
    d.port !== undefined &&
    (!Number.isInteger(d.port) || d.port < 1 || d.port > 65_535)
  ) {
    issues.push(`${label} port ${d.port} is out of range`);
  }
}

/**
 * Reject intents that smuggle machine-local or secret-bearing data into the
 * portable layer, and enforce the same shape limits as the stored profile.
 */
export function assertPortableGovernanceIntent(intent: GovernanceIntent): void {
  const issues: string[] = [];
  if (!Number.isInteger(intent.ref.revision) || intent.ref.revision < 1) {
    issues.push('ref.revision must be a positive integer');
  }
  for (const rule of intent.toolPolicy.allowedShellCommands) {
    if (rule.length < 2) {
      issues.push(
        `allowedShellCommands rule "${rule.join(' ')}" needs at least two tokens`,
      );
    }
  }
  const fs = intent.sandbox.filesystem;
  if (fs.denyPaths.length > MAX_DENY_PATHS) {
    issues.push(`filesystem.denyPaths exceeds ${MAX_DENY_PATHS} entries`);
  }
  for (const denyPath of fs.denyPaths) {
    if (denyPath.length === 0 || denyPath.length > 255) {
      issues.push('filesystem.denyPaths entries must be 1-255 characters');
    } else if (HOST_PATH_PATTERN.test(denyPath)) {
      issues.push(
        `filesystem.denyPaths entry "${denyPath}" is a host path; use a workspace-relative path`,
      );
    }
  }
  const net = intent.sandbox.network;
  if (net.allowedDestinations.length > MAX_HOSTS) {
    issues.push(`network.allowedDestinations exceeds ${MAX_HOSTS} entries`);
  }
  net.allowedDestinations.forEach((d, i) =>
    validateDestination(d, `network.allowedDestinations[${i}]`, issues),
  );
  if (net.allowedInternalHosts.length > MAX_HOSTS) {
    issues.push(`network.allowedInternalHosts exceeds ${MAX_HOSTS} entries`);
  }
  for (const host of net.allowedInternalHosts) {
    if (!HOST_PATTERN.test(host)) {
      issues.push(
        `network.allowedInternalHosts entry "${host}" is not a hostname pattern`,
      );
    }
  }
  const res = intent.sandbox.resources;
  if (res?.memory !== undefined && !MEMORY_PATTERN.test(res.memory)) {
    issues.push(
      `resources.memory "${res.memory}" must match ${MEMORY_PATTERN}`,
    );
  }
  if (
    res?.cpus !== undefined &&
    (!Number.isInteger(res.cpus) || res.cpus < 1 || res.cpus > MAX_CPUS)
  ) {
    issues.push(`resources.cpus must be an integer between 1 and ${MAX_CPUS}`);
  }
  const seenIds = new Set<string>();
  const seenEnv = new Set<string>();
  for (const requirement of intent.credentials) {
    if (seenIds.has(requirement.id)) {
      issues.push(`credential id "${requirement.id}" is declared twice`);
    }
    seenIds.add(requirement.id);
    if (seenEnv.has(requirement.envName)) {
      issues.push(
        `credential envName "${requirement.envName}" is used by more than one requirement`,
      );
    }
    seenEnv.add(requirement.envName);
    if (requirement.destinations.length === 0) {
      issues.push(
        `credential "${requirement.id}" must name at least one destination`,
      );
    }
    requirement.destinations.forEach((d, i) =>
      validateDestination(
        d,
        `credential "${requirement.id}" destinations[${i}]`,
        issues,
      ),
    );
    if (!ENV_NAME_PATTERN.test(requirement.envName)) {
      issues.push(
        `credential "${requirement.id}" envName "${requirement.envName}" is not an environment variable name`,
      );
    }
    if ('value' in requirement || 'providerRef' in requirement) {
      issues.push(
        `credential "${requirement.id}" carries binding or value data; requirements are value-free`,
      );
    }
  }
  if (issues.length > 0) {
    throw new GovernanceIntentValidationError(
      `governance intent ${intent.ref.id} is not portable`,
      issues,
    );
  }
}
