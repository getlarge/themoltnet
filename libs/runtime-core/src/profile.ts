import type { RequirementLevel } from './states.js';

/**
 * Reference to a stored MoltNet runtime profile. The portable core never
 * redefines the stored profile schema; it projects the fields it governs.
 */
export interface RuntimeProfileRef {
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
 * Portable sandbox capabilities a profile can request. Trusted deployment
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
 * Host-side powers that a guest sandbox can never contain. A profile lists
 * them so the resolved profile and session report them outside containment
 * instead of implying coverage.
 */
export type HostPower = 'host-exec' | 'host-mcp';

export interface FilesystemScopeIntent {
  workspace: 'read-write' | 'read-only';
  /** Workspace-relative paths the guest must not mutate. */
  denyPaths: readonly string[];
  /** `deny` rejects writes; `tmpfs` accepts them into guest-local memory. */
  denyMode: 'deny' | 'tmpfs';
}

export interface NetworkPolicyIntent {
  /** Host patterns allowed for egress. Empty means deny all runtime egress. */
  allowedHosts: readonly string[];
  /** Host patterns explicitly allowed to resolve to internal/private ranges. */
  allowedInternalHosts: readonly string[];
}

export interface ResourceLimitsIntent {
  memory?: string;
  cpus?: number;
}

/**
 * Portable credential requirement. It names purpose, consumer, destination and
 * acceptable delivery. It never carries a provider coordinate or a value.
 */
export interface CredentialRequirement {
  id: string;
  purpose: string;
  consumer: 'guest-process' | 'host-broker' | 'coding-agent';
  /** Symbolic destination host patterns the credential may reach. */
  destinationHosts: readonly string[];
  /** `brokered-http` substitutes a placeholder at the host boundary. */
  delivery: 'brokered-http';
  /** Environment name the guest sees a stand-in under. */
  envName: string;
  required: boolean;
}

/**
 * Knowledge Factory context reference. A profile may pin a rendered context
 * input; resolution records provenance, and the coding-agent adapter injects
 * it through its native mechanism. Context informs the agent; it is not an
 * enforcement claim.
 */
export interface ContextReference {
  slug: string;
  binding: 'skill' | 'context_inline' | 'prompt_prefix' | 'user_inline';
  /** Pinned revision or content identifier, when the profile pins one. */
  pinned?: string;
}

export interface SandboxIntent {
  filesystem: FilesystemScopeIntent;
  network: NetworkPolicyIntent;
  resources?: ResourceLimitsIntent;
}

/**
 * Runtime profile: editable intent plus references. It says what is required,
 * not how a particular machine provides it. No adapter ids, host paths,
 * commands, hook placement, or secrets belong here.
 */
export interface RuntimeProfile {
  ref: RuntimeProfileRef;
  toolPolicy: ToolPolicyIntent;
  sandbox: SandboxIntent;
  /** Capabilities the profile needs, with how strongly it needs them. */
  capabilities: Readonly<Partial<Record<SandboxCapability, RequirementLevel>>>;
  credentials: readonly CredentialRequirement[];
  /** Named non-secret runtime inputs that must exist before launch. */
  runtimeInputs: readonly string[];
  context: readonly ContextReference[];
  /** Host powers the profile expects to use outside guest containment. */
  hostPowers: readonly HostPower[];
}

export class RuntimeProfileValidationError extends Error {
  constructor(
    message: string,
    readonly issues: readonly string[],
  ) {
    super(message);
    this.name = 'RuntimeProfileValidationError';
  }
}

const HOST_PATH_PATTERN = /^(?:[A-Za-z]:\\|\/|~\/)/;

/**
 * Reject profiles that smuggle machine-local or secret-bearing data into the
 * portable layer. This is intentionally small: the stored profile schema in
 * MoltNet already validates shapes; this checks the portability boundary.
 */
export function assertPortableRuntimeProfile(profile: RuntimeProfile): void {
  const issues: string[] = [];
  if (!Number.isInteger(profile.ref.revision) || profile.ref.revision < 1) {
    issues.push('ref.revision must be a positive integer');
  }
  for (const rule of profile.toolPolicy.allowedShellCommands) {
    if (rule.length < 2) {
      issues.push(
        `allowedShellCommands rule "${rule.join(' ')}" needs at least two tokens`,
      );
    }
  }
  for (const denyPath of profile.sandbox.filesystem.denyPaths) {
    if (HOST_PATH_PATTERN.test(denyPath)) {
      issues.push(
        `filesystem.denyPaths entry "${denyPath}" is a host path; use a workspace-relative path`,
      );
    }
  }
  for (const requirement of profile.credentials) {
    if (requirement.destinationHosts.length === 0) {
      issues.push(
        `credential "${requirement.id}" must name at least one destination host`,
      );
    }
    if (!/^[A-Z][A-Z0-9_]*$/.test(requirement.envName)) {
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
    throw new RuntimeProfileValidationError(
      `runtime profile ${profile.ref.id} is not portable`,
      issues,
    );
  }
}
