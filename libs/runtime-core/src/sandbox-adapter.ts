import type {
  DestinationConstraint,
  FilesystemScopeIntent,
  NetworkPolicyIntent,
  ResourceLimitsIntent,
  SandboxCapability,
} from './intent.js';
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

/**
 * Which destination axes an adapter's network and credential controls can
 * distinguish. `host` means any scheme or port on a permitted hostname is
 * reachable; an intent that needs a narrower destination than the adapter
 * can express resolves as `degraded`, never as `enforced`.
 */
export type NetworkFidelity = 'origin' | 'host-port' | 'host';

export interface DeclaredCapability {
  capability: SandboxCapability;
  state: Extract<EnforcementState, 'enforced' | 'unsupported' | 'degraded'>;
  locus: EnforcementLocus;
  /** Why the adapter cannot fully provide the capability, when it cannot. */
  reason?: string;
}

/**
 * Static description of what an adapter can truthfully apply. It is a
 * declaration, not evidence: sessions record it with basis `declared`.
 */
export interface SandboxCapabilityReport {
  adapter: SandboxAdapterIdentity;
  capabilities: readonly DeclaredCapability[];
  network: {
    fidelity: NetworkFidelity;
    /**
     * Egress the adapter always permits regardless of the intent (model
     * provider, MoltNet API, registries). Resolution merges it into the
     * effective policy and requires the intent to accept it.
     */
    mandatoryEgress: readonly DestinationConstraint[];
  };
  hostPowers: readonly {
    power: 'host-exec' | 'host-mcp';
    locus: 'outside-containment' | 'host-broker';
  }[];
}

/**
 * Value-free readiness of one trusted binding. Distinct failures stay
 * distinct: an absent binding value, an unavailable provider, and an
 * inaccessible host store are different setup problems.
 */
export type CredentialReadinessCode =
  | 'ready'
  | 'binding_absent'
  | 'provider_unavailable'
  | 'host_store_inaccessible'
  | 'readiness_unknown';

export interface CredentialReadiness {
  code: CredentialReadinessCode;
  /** Non-secret provider name (e.g. `os-keyring`, `file`, `oauth`). */
  provider?: string;
  /** Actionable next step when not ready. Never contains a value or key. */
  setupInstruction?: string;
}

/**
 * Trusted, host-side binding for one credential requirement. The binding is
 * authoritative for identity (`requirementId`, `envName`) and destinations:
 * resolution refuses a requirement that names a destination the binding does
 * not cover. The plan carries `resolve`, never the value; adapters call it
 * only at launch, after readiness and cancellation checks.
 */
export interface BrokeredCredentialBinding {
  requirementId: string;
  envName: string;
  destinations: readonly DestinationConstraint[];
  /** Non-secret reference describing the trusted binding (for evidence). */
  bindingRef: string;
  /**
   * Value-free readiness check, run at resolution before any launch or
   * secret read. Required for `required` credentials; a binding without it
   * resolves as `readiness_unknown`.
   */
  probe?(): Promise<CredentialReadiness>;
  /** Host-side just-in-time read. Called only by the adapter at launch. */
  resolve(): Promise<string>;
}

export interface EffectiveNetworkPolicy {
  /** What the intent asked for. */
  requested: NetworkPolicyIntent;
  /** Requested plus the adapter's mandatory egress. */
  effective: {
    allowedDestinations: readonly DestinationConstraint[];
    allowedInternalHosts: readonly string[];
  };
  fidelity: NetworkFidelity;
}

/**
 * Launch plan handed to an adapter. Portable except for the workspace host
 * path, which is a trusted local binding supplied at launch. It is deeply
 * frozen by the resolver; mutate nothing.
 */
export interface SandboxLaunchPlan {
  workspace: { hostPath: string; mode: 'read-write' | 'read-only' };
  filesystem: FilesystemScopeIntent;
  network: EffectiveNetworkPolicy;
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
    | 'credential_binding_duplicate'
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
  /**
   * After a timeout or cancellation: whether the adapter confirmed that the
   * guest process group is gone. `false` means the command may still run.
   */
  terminationConfirmed?: boolean;
}

/**
 * How a record came to be: `declared` is the adapter's static claim,
 * `applied` means the adapter configured the control for this launch,
 * `verified` means an independent oracle confirmed the behaviour.
 */
export type EvidenceBasis = 'declared' | 'applied' | 'verified';

export interface EnforcementRecord {
  control: SandboxCapability | 'host-exec' | 'host-mcp' | 'tool-policy';
  locus: EnforcementLocus;
  intended: RequirementLevel | 'none';
  state: EnforcementState;
  basis: EvidenceBasis;
  reason?: string;
  recordedAt: string;
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
  /** What the adapter applied for this launch, with evidence basis. */
  observe(): readonly EnforcementRecord[];
  /** Idempotent: repeated calls return the same report, residue retained. */
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

/** Whether a destination's narrowing axes are within the adapter's fidelity. */
export function destinationExpressible(
  d: DestinationConstraint,
  fidelity: NetworkFidelity,
): boolean {
  if (fidelity === 'origin') return true;
  if (fidelity === 'host-port') return d.scheme === undefined;
  return d.scheme === undefined && d.port === undefined;
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
