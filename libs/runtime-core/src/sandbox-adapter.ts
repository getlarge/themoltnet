import type {
  FilesystemScopeIntent,
  NetworkPolicyIntent,
  ResourceLimitsIntent,
  SandboxCapability,
} from './profile.js';
import type {
  EnforcementLocus,
  EnforcementState,
  RequirementLevel,
} from './states.js';

export interface SandboxAdapterIdentity {
  /** Stable adapter id, e.g. `gondolin` or `docker-sandbox`. */
  id: string;
  /** Adapter implementation version. */
  version: string;
}

export interface DeclaredCapability {
  capability: SandboxCapability;
  state: Extract<EnforcementState, 'enforced' | 'unsupported' | 'degraded'>;
  locus: EnforcementLocus;
  /** Why the adapter cannot fully provide the capability, when it cannot. */
  reason?: string;
}

/**
 * Static description of what an adapter can truthfully apply. Host powers are
 * always reported outside containment: an adapter must never claim it
 * contains host exec or host MCP.
 */
export interface SandboxCapabilityReport {
  adapter: SandboxAdapterIdentity;
  capabilities: readonly DeclaredCapability[];
  hostPowers: readonly {
    power: 'host-exec' | 'host-mcp';
    locus: 'outside-containment' | 'host-broker';
  }[];
}

/**
 * Trusted, host-side resolver for one credential requirement. The plan carries
 * the resolver function, never the value; adapters call it as late as possible
 * and deliver the value only to the declared destinations.
 */
/**
 * Value-free readiness of one trusted binding. The codes keep distinct
 * failures distinct, as the #1890 safe-launch probe requires: an absent
 * binding value, an unavailable provider, and an inaccessible host store are
 * different setup problems with different instructions.
 */
export type CredentialReadinessCode =
  | 'ready'
  | 'binding_absent'
  | 'provider_unavailable'
  | 'host_store_inaccessible';

export interface CredentialReadiness {
  code: CredentialReadinessCode;
  /** Non-secret provider name (e.g. `os-keyring`, `file`, `oauth`). */
  provider?: string;
  /** Actionable next step when not ready. Never contains a value or key. */
  setupInstruction?: string;
}

export interface BrokeredCredentialBinding {
  requirementId: string;
  /** Environment name under which the guest sees a stand-in value. */
  envName: string;
  destinationHosts: readonly string[];
  /** Non-secret reference describing the trusted binding (for evidence). */
  bindingRef: string;
  /**
   * Value-free readiness check run at resolution, before any launch or
   * secret read. Optional: a binding without it is assumed ready and any
   * failure surfaces at launch as `failed`.
   */
  probe?(): Promise<CredentialReadiness>;
  /** Host-side just-in-time read. Called only by the adapter at launch. */
  resolve(): Promise<string>;
}

/**
 * Value-free launch plan handed to an adapter. The workspace host path is a
 * trusted local binding supplied at launch; it is never part of the portable
 * profile or the retained resolved profile.
 */
export interface SandboxLaunchPlan {
  workspace: { hostPath: string; mode: 'read-write' | 'read-only' };
  filesystem: FilesystemScopeIntent;
  network: NetworkPolicyIntent;
  resources?: ResourceLimitsIntent;
  /** Explicit non-secret guest environment. Nothing else is inherited. */
  env: Readonly<Record<string, string>>;
  credentials: readonly BrokeredCredentialBinding[];
  requirements: Readonly<Partial<Record<SandboxCapability, RequirementLevel>>>;
  /** Opaque label adapters may use for logging and cleanup scoping. */
  label?: string;
}

export interface PreflightIssue {
  code:
    | 'capability_unsupported'
    | 'credential_binding_missing'
    | 'workspace_unavailable'
    | 'adapter_unavailable'
    | 'plan_invalid';
  message: string;
  capability?: SandboxCapability;
  requirementId?: string;
}

export type PreflightResult =
  | { ok: true; warnings: readonly PreflightIssue[] }
  | { ok: false; issues: readonly PreflightIssue[] };

export interface SandboxExecOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Extra explicit environment for this command only. */
  env?: Readonly<Record<string, string>>;
  cwd?: string;
}

export interface SandboxExecResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  cancelled: boolean;
}

export interface EnforcementRecord {
  control: SandboxCapability | 'host-exec' | 'host-mcp' | 'tool-policy';
  locus: EnforcementLocus;
  intended: RequirementLevel | 'none';
  state: EnforcementState;
  reason?: string;
  observedAt: string;
}

export interface SandboxCleanupReport {
  cleaned: boolean;
  /** Human-readable descriptions of anything the adapter could not remove. */
  residue: readonly string[];
}

export interface SandboxHandle {
  readonly adapter: SandboxAdapterIdentity;
  /** Guest-visible path of the mounted workspace. */
  readonly guestWorkspace: string;
  exec(
    command: string,
    options?: SandboxExecOptions,
  ): Promise<SandboxExecResult>;
  /** What the adapter can truthfully claim it applied for this launch. */
  observe(): readonly EnforcementRecord[];
  close(): Promise<SandboxCleanupReport>;
}

export interface SandboxLaunchOptions {
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export interface SandboxAdapter {
  readonly id: string;
  readonly version: string;
  describe(): SandboxCapabilityReport;
  /** Readiness only: no launch, no secret read, no host mutation. */
  preflight(plan: SandboxLaunchPlan): Promise<PreflightResult>;
  launch(
    plan: SandboxLaunchPlan,
    options?: SandboxLaunchOptions,
  ): Promise<SandboxHandle>;
}

export function declaredCapability(
  report: SandboxCapabilityReport,
  capability: SandboxCapability,
): DeclaredCapability | undefined {
  return report.capabilities.find((entry) => entry.capability === capability);
}

export class SandboxLaunchRefusedError extends Error {
  constructor(
    message: string,
    readonly issues: readonly PreflightIssue[],
  ) {
    super(message);
    this.name = 'SandboxLaunchRefusedError';
  }
}
