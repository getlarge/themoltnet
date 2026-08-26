import { type Static, Type } from 'typebox';

export const ENFORCEMENT_STATES = [
  'enforced',
  'unsupported',
  'degraded',
  'failed-open',
  'failed',
] as const;

export type EnforcementState = (typeof ENFORCEMENT_STATES)[number];

export const EVIDENCE_BASES = [
  'declared',
  'applied',
  'verified',
  'harness-observed',
] as const;

export type EvidenceBasis = (typeof EVIDENCE_BASES)[number];

export const UNSUPPORTED_KINDS = [
  'backend-capability',
  'fixture-limitation',
  'not-measured',
] as const;

export type UnsupportedKind = (typeof UNSUPPORTED_KINDS)[number];

export const CONTROL_DOMAINS = [
  'filesystem',
  'network',
  'credential',
  'lifecycle',
  'resource',
  'topology',
] as const;

export type ControlDomain = (typeof CONTROL_DOMAINS)[number];

const ControlDomainSchema = Type.Union([
  Type.Literal('filesystem'),
  Type.Literal('network'),
  Type.Literal('credential'),
  Type.Literal('lifecycle'),
  Type.Literal('resource'),
  Type.Literal('topology'),
]);

export const ENFORCEMENT_LOCI = [
  'research-harness',
  'fixture',
  'docker-sandbox-adapter',
  'docker-sandbox-control-plane',
  'docker-sandbox-guest',
  'gondolin-adapter',
  'gondolin-host-hooks',
  'gondolin-microvm',
] as const;

export type EnforcementLocus = (typeof ENFORCEMENT_LOCI)[number];

const COMMON_REASON_CODES = [
  'adapter_cleanup_error',
  'adapter_host_capabilities_error',
  'adapter_inspect_error',
  'adapter_scenario_error',
  'adapter_scenario_timeout',
  'evidence_validation_error',
  'fixture_unsupported',
  'scenario_not_implemented_by_adapter',
] as const;

export const REASON_CODES_BY_DOMAIN = {
  filesystem: [
    'host_credential_path_absent',
    'outside_mount_boundary_observed',
    'readonly_mount_observed',
    'readonly_secondary_mount_unsupported',
    'scoped_cleanup_idempotence_observed',
    'vfs_symlink_boundary_observed',
    'workspace_write_observed',
  ],
  network: [
    'adjacent_origin_blocked',
    'allowed_hostname_observed',
    'credential_protocol_binding_recorded',
    'exact_port_probe_observed',
    'exact_destination_allow_observed',
    'effective_hostname_policy_unverified',
    'fixture_does_not_claim_protocol_or_dns_control',
    'host_gateway_binding_recorded',
    'internal_hostname_binding_recorded',
    'internal_network_enforcement_unverified',
    'network_port_fidelity_observed',
    'no_controlled_dns_rebinding_fixture',
    'redirect_origin_not_allowed',
    'redirect_revalidation_probe_observed',
    'redirect_target_blocked',
    'unlisted_destination_blocked',
    'unlisted_hostname_blocked',
    'unlisted_hostname_probe_observed',
    'protocol_origin_probe_observed',
    'positive_fixture_transport_unavailable',
  ],
  credential: [
    'adapter_preflight_rejected_missing_binding',
    'adjacent_origin_secret_not_substituted',
    'adjacent_origin_secret_probe_observed',
    'adjacent_origin_secret_delivery_observed',
    'allowed_origin_secret_substitution_observed',
    'allowed_origin_substitution_observed',
    'explicit_rebinding_after_restart_observed',
    'evidence_persistence_validation_failed',
    'evidence_persistence_validation_deferred',
    'required_binding_preflight_observed',
    'required_binding_preflight_unverified',
    'positive_fixture_transport_unavailable',
    'resume_rebinding_observed',
    'revocation_observed',
    'revocation_unverified_without_prior_delivery',
    'revoked_binding_not_delivered',
    'rotated_binding_observed',
    'rotation_observed',
    'value_free_evidence_only',
  ],
  lifecycle: [
    'backend_retirement_observed',
    'broker_preflight_unverified',
    'managed_sandbox_retirement_observed',
    'preflight_failure_left_no_backend_resource',
    'preflight_failure_left_no_live_vm',
    'partial_launch_cleanup_unverified',
    'repeated_adapter_close_left_residue',
    'repeated_adapter_close_observed',
    'repeated_adapter_close_unverified',
    'restart_surfaces_observed',
    'sandbox_removal_detached_child_observed',
  ],
  resource: ['guest_cpu_limit_observed', 'guest_memory_limit_observed'],
  topology: ['capability_boundary_recorded'],
} as const satisfies Record<ControlDomain, readonly string[]>;

type DomainReasonCode = {
  [Domain in ControlDomain]: (typeof REASON_CODES_BY_DOMAIN)[Domain][number];
}[ControlDomain];

export type ReasonCode =
  | (typeof COMMON_REASON_CODES)[number]
  | DomainReasonCode;

export function isReasonCodeForDomain(
  domain: ControlDomain,
  reasonCode: string,
): reasonCode is ReasonCode {
  return (
    (COMMON_REASON_CODES as readonly string[]).includes(reasonCode) ||
    (REASON_CODES_BY_DOMAIN[domain] as readonly string[]).includes(reasonCode)
  );
}

export const ScenarioParametersSchema = Type.Object(
  {
    cpuCount: Type.Optional(Type.Integer({ minimum: 1 })),
    delayedMarkerMs: Type.Optional(Type.Integer({ minimum: 1 })),
    memoryKiB: Type.Optional(Type.Integer({ minimum: 1 })),
    observationWindowMs: Type.Optional(Type.Integer({ minimum: 1 })),
    tolerancePercent: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
  },
  { additionalProperties: false },
);

export type ScenarioParameters = Static<typeof ScenarioParametersSchema>;

export const SandboxScenarioSchema = Type.Object(
  {
    id: Type.String({ pattern: '^[a-z]+\\.[a-z0-9-]+$' }),
    domain: ControlDomainSchema,
    control: Type.String({ minLength: 1 }),
    purpose: Type.String({ minLength: 1 }),
    required: Type.Boolean(),
    oracle: Type.String({ minLength: 1 }),
    parameters: Type.Optional(ScenarioParametersSchema),
  },
  { additionalProperties: false },
);

export type SandboxScenario = Static<typeof SandboxScenarioSchema>;

export const ScenarioCatalogSchema = Type.Object(
  {
    schemaVersion: Type.Literal(1),
    catalogVersion: Type.String({ minLength: 1 }),
    notice: Type.String({ minLength: 1 }),
    scenarios: Type.Array(SandboxScenarioSchema, { minItems: 1 }),
  },
  { additionalProperties: false },
);

export type ScenarioCatalog = Static<typeof ScenarioCatalogSchema>;

/** Portable, value-free containment intent exercised by one scenario. */
export interface ContainmentIntent {
  scenarioId: string;
  domain: ControlDomain;
  control: string;
  required: boolean;
  parameters?: ScenarioParameters;
}

/** Backend-specific resolution. Values must remain credential-free. */
export interface AdapterResolution {
  backendId: string;
  requested: ContainmentIntent;
  effective: Record<string, unknown>;
  binding?: Record<string, unknown>;
  fidelity?: string;
  mandatoryEffects?: string[];
}

export interface BackendInventory {
  id: string;
  version: string;
  runtime?: string;
  runtimeVersion?: string;
  os: string;
  architecture: string;
  topology: string[];
}

export interface ControlOracle {
  attestedBy: 'adapter' | 'harness';
  kind: string;
  expected: unknown;
  observed: unknown;
  passed: boolean;
  /** Required when a degraded state claims that a weaker control held. */
  weakerControl?: {
    attestedBy: 'adapter' | 'harness';
    kind: string;
    expected: unknown;
    observed: unknown;
    passed: true;
  };
}

export interface PersistentMutationEvidence {
  kind: string;
  resource: string;
  cleanup: 'pending' | 'cleaned' | 'residue';
  reason?: string;
}

export interface ControlEvidence {
  scenarioId: string;
  requestedIntent: ContainmentIntent;
  resolvedAdapterConfig: AdapterResolution | null;
  backend: Pick<BackendInventory, 'id' | 'version'>;
  enforcementLocus: EnforcementLocus[];
  state: EnforcementState;
  /** Required only when state is unsupported. */
  unsupportedKind?: UnsupportedKind;
  basis: EvidenceBasis;
  oracle: ControlOracle | null;
  reasonCode: ReasonCode;
  recordedAt: string;
  persistentMutations: PersistentMutationEvidence[];
  notes?: string[];
}

export interface HostCapabilityEvidence {
  id: string;
  locus: 'host' | 'control-plane';
  relationship: 'outside-containment' | 'mediates-containment';
  basis: Exclude<EvidenceBasis, 'harness-observed'>;
  description: string;
}

export interface ProbeViolation {
  code:
    | 'adapter_cleanup_error'
    | 'adapter_host_capabilities_error'
    | 'adapter_inspect_error'
    | 'evidence_validation_error';
  message: string;
  scenarioId?: string;
}

export interface SandboxProbeRun {
  schemaVersion: 1;
  catalogVersion: string;
  runId: string;
  sourceRevision: string;
  recordedAt: string;
  backend: BackendInventory;
  controls: ControlEvidence[];
  hostCapabilities: HostCapabilityEvidence[];
  cleanup: PersistentMutationEvidence[];
  cleanupComplete: boolean;
  /** Sensitive diagnostics are redacted before they enter the run. */
  sensitiveDiagnosticRedactions: number;
  violations: ProbeViolation[];
}

export interface ProbeContext {
  runId: string;
  recordedAt: () => string;
  probeRoot: string;
  deadline: string;
  signal: AbortSignal;
}

export interface ResearchSandboxAdapter {
  inspect(): Promise<BackendInventory>;
  runScenario(
    scenario: SandboxScenario,
    context: ProbeContext,
  ): Promise<ControlEvidence>;
  hostCapabilities(): Promise<HostCapabilityEvidence[]>;
  /** Synthetic values that must be redacted from harness diagnostics. */
  sensitiveValues?(): string[];
  close(): Promise<PersistentMutationEvidence[]>;
}
