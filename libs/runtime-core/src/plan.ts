import { deepFreezeClone, sha256Digest } from './digest.js';
import {
  assertPortableGovernanceIntent,
  type ContextReference,
  type DestinationConstraint,
  destinationWithin,
  formatDestination,
  type GovernanceIntent,
  type GovernanceIntentRef,
  type HostPower,
  SANDBOX_CAPABILITIES,
  type SandboxCapability,
} from './intent.js';
import {
  type BrokeredCredentialBinding,
  type CredentialReadiness,
  type CredentialReadinessCode,
  declaredCapability,
  destinationExpressible,
  type EffectiveNetworkPolicy,
  type NetworkFidelity,
  type SandboxAdapter,
  type SandboxAdapterIdentity,
  type SandboxLaunchPlan,
} from './sandbox-adapter.js';
import type {
  EnforcementLocus,
  EnforcementState,
  RequirementLevel,
} from './states.js';

/**
 * Trusted local or deployment configuration. It binds portable requirements
 * to this machine: which adapter, which workspace, which credential binding,
 * which rendered context revision. None of it is part of the intent, and
 * only value-free references from it reach the plan.
 */
export interface TrustedGovernanceBindings {
  sandbox: SandboxAdapter;
  workspace: { hostPath: string };
  /** Keyed by credential requirement id. */
  credentials: Readonly<Record<string, BrokeredCredentialBinding>>;
  /** Keyed by context slug. */
  contextInputs?: Readonly<
    Record<string, { revision: string; provenance: string }>
  >;
  /** Non-secret runtime inputs available on this machine, by name. */
  runtimeInputs?: Readonly<Record<string, string>>;
  /**
   * Policy snapshot hash issued by the MoltNet server for this profile
   * revision. When absent, the resolver digests the portable tool-policy
   * intent so evidence still binds to one exact policy.
   */
  policySnapshotHash?: string;
  now?: () => Date;
}

export interface PlannedCapability {
  capability: SandboxCapability;
  requested: RequirementLevel | 'none';
  /** Adapter declaration after fidelity and platform-egress adjustments. */
  declared: EnforcementState;
  locus: EnforcementLocus;
  reason?: string;
}

export interface PlannedCredentialBinding {
  requirementId: string;
  envName: string;
  /** Destinations as bound by trusted configuration (never wider). */
  destinations: readonly DestinationConstraint[];
  /** Non-secret binding reference. Never a value or a provider secret path. */
  bindingRef: string;
  /** Non-secret provider name, when the binding reported one. */
  provider?: string;
  /** Readiness observed at resolution; `ready` or the typed reason. */
  readiness: CredentialReadinessCode;
}

export interface PlannedContextInput extends ContextReference {
  revision?: string;
  provenance?: string;
}

export interface PlannedNetworkPolicy {
  requested: {
    allowedDestinations: readonly DestinationConstraint[];
    allowedInternalHosts: readonly string[];
    acceptPlatformEgress: boolean;
  };
  effective: {
    allowedDestinations: readonly DestinationConstraint[];
    allowedInternalHosts: readonly string[];
  };
  /** Destinations the adapter adds regardless of the intent. */
  mandatoryEgress: readonly DestinationConstraint[];
  fidelity: NetworkFidelity;
}

/**
 * Governance plan: deeply frozen, value-free record of one resolution. It
 * pins the profile revision, policy snapshot hash, adapter, per-capability
 * verdicts, requested versus effective network policy, credential binding
 * references with readiness, context provenance, and two digests: one over
 * the portable launch intent and one over this record.
 */
export interface GovernancePlan {
  readonly profile: GovernanceIntentRef;
  readonly policySnapshotHash: string;
  readonly sandboxAdapter: SandboxAdapterIdentity;
  readonly capabilities: readonly PlannedCapability[];
  readonly network: PlannedNetworkPolicy;
  readonly hostPowers: readonly {
    power: HostPower;
    locus: 'outside-containment' | 'host-broker';
  }[];
  readonly credentialBindings: readonly PlannedCredentialBinding[];
  readonly contextInputs: readonly PlannedContextInput[];
  /** Digest of the portable launch intent (no host path, no resolvers). */
  readonly launchPlanDigest: string;
  /** Digest of every other member of this record. */
  readonly planDigest: string;
  readonly resolvedAt: string;
}

export type ResolutionFailureCode =
  | 'intent_not_portable'
  | 'capability_unsupported'
  | 'capability_degraded'
  | 'credential_binding_missing'
  | 'credential_binding_mismatch'
  | 'credential_destination_not_trusted'
  | 'credential_not_ready'
  | 'runtime_input_missing'
  | 'context_input_unpinned'
  | 'preflight_failed'
  | 'preflight_warning';

export interface ResolutionFailure {
  code: ResolutionFailureCode;
  message: string;
  capability?: SandboxCapability;
  requirementId?: string;
  slug?: string;
  input?: string;
  /** Typed readiness reason for `credential_not_ready`. */
  readiness?: CredentialReadinessCode;
  setupInstruction?: string;
}

export type ResolutionResult =
  | {
      ok: true;
      plan: GovernancePlan;
      /** Executable plan for the adapter, deeply frozen. Not retained as evidence. */
      launchPlan: SandboxLaunchPlan;
      warnings: readonly ResolutionFailure[];
    }
  | { ok: false; failures: readonly ResolutionFailure[] };

function verdict(
  capability: SandboxCapability,
  requested: RequirementLevel | 'none',
  report: ReturnType<SandboxAdapter['describe']>,
): PlannedCapability {
  const declared = declaredCapability(report, capability);
  if (!declared) {
    return {
      capability,
      requested,
      declared: 'unsupported',
      locus: 'outside-containment',
      reason: 'adapter does not declare this capability',
    };
  }
  return {
    capability,
    requested,
    declared: declared.state,
    locus: declared.locus,
    ...(declared.reason ? { reason: declared.reason } : {}),
  };
}

function downgrade(
  entry: PlannedCapability,
  state: Extract<EnforcementState, 'degraded' | 'unsupported'>,
  reason: string,
): void {
  if (entry.declared === 'enforced') entry.declared = state;
  entry.reason = entry.reason ? `${entry.reason}; ${reason}` : reason;
}

/**
 * Resolve a governance intent against trusted bindings. Resolution stops
 * before any launch when a required capability is unsupported or degraded,
 * a required credential binding is missing, mismatched, broader than trusted,
 * or not ready, a runtime input is absent, or the adapter's preflight fails.
 * It reads no secret value.
 */
export async function resolveGovernanceIntent(
  intent: GovernanceIntent,
  bindings: TrustedGovernanceBindings,
): Promise<ResolutionResult> {
  const failures: ResolutionFailure[] = [];
  const warnings: ResolutionFailure[] = [];

  try {
    assertPortableGovernanceIntent(intent);
  } catch (error) {
    const issues =
      error instanceof Error && 'issues' in error
        ? (error as { issues: readonly string[] }).issues
        : [String(error)];
    return {
      ok: false,
      failures: issues.map((message) => ({
        code: 'intent_not_portable',
        message,
      })),
    };
  }

  const report = bindings.sandbox.describe();
  const fidelity = report.network.fidelity;
  const capabilities: PlannedCapability[] = SANDBOX_CAPABILITIES.map(
    (capability) =>
      verdict(capability, intent.capabilities[capability] ?? 'none', report),
  );
  const entryFor = (capability: SandboxCapability) =>
    capabilities.find((c) => c.capability === capability)!;

  // Network: effective policy = requested + mandatory; the intent must accept
  // the mandatory part, and every requested destination must be expressible.
  const requestedNet = intent.sandbox.network;
  const mandatory = report.network.mandatoryEgress;
  const network = entryFor('network-egress');
  if (mandatory.length > 0 && !requestedNet.acceptPlatformEgress) {
    downgrade(
      network,
      'degraded',
      `adapter always permits ${mandatory.map(formatDestination).join(', ')} and the intent does not accept platform egress`,
    );
  }
  const inexpressible = requestedNet.allowedDestinations.filter(
    (d) => !destinationExpressible(d, fidelity),
  );
  if (inexpressible.length > 0) {
    downgrade(
      network,
      'degraded',
      `adapter fidelity is ${fidelity}; cannot narrow ${inexpressible.map(formatDestination).join(', ')}`,
    );
  }

  // Credentials: the trusted binding is authoritative.
  const credentialPlan: BrokeredCredentialBinding[] = [];
  const credentialEvidence: PlannedCredentialBinding[] = [];
  const brokered = entryFor('brokered-credential');
  if (intent.credentials.length > 0 && brokered.requested === 'none') {
    brokered.requested = intent.credentials.some((c) => c.required)
      ? 'required'
      : 'preferred';
  }
  for (const requirement of intent.credentials) {
    const sink = requirement.required ? failures : warnings;
    const binding = bindings.credentials[requirement.id];
    if (!binding) {
      sink.push({
        code: 'credential_binding_missing',
        requirementId: requirement.id,
        message: `credential requirement "${requirement.id}" (${requirement.purpose}) has no trusted binding on this machine`,
      });
      continue;
    }
    if (
      binding.requirementId !== requirement.id ||
      binding.envName !== requirement.envName
    ) {
      sink.push({
        code: 'credential_binding_mismatch',
        requirementId: requirement.id,
        message: `trusted binding for "${requirement.id}" is bound to ${binding.requirementId}/${binding.envName}, not ${requirement.id}/${requirement.envName}`,
      });
      continue;
    }
    const untrusted = requirement.destinations.filter(
      (d) => !binding.destinations.some((b) => destinationWithin(d, b)),
    );
    if (untrusted.length > 0) {
      sink.push({
        code: 'credential_destination_not_trusted',
        requirementId: requirement.id,
        message: `credential "${requirement.id}" requests ${untrusted.map(formatDestination).join(', ')}, which the trusted binding does not cover`,
      });
      continue;
    }
    const narrowerThanFidelity = requirement.destinations.filter(
      (d) => !destinationExpressible(d, fidelity),
    );
    if (narrowerThanFidelity.length > 0) {
      downgrade(
        brokered,
        'degraded',
        `adapter fidelity is ${fidelity}; credential "${requirement.id}" needs ${narrowerThanFidelity.map(formatDestination).join(', ')}`,
      );
    }
    // Value-free readiness before any launch; no secret is read here.
    const readiness: CredentialReadiness = binding.probe
      ? await binding.probe()
      : {
          code: 'readiness_unknown',
          setupInstruction:
            'binding has no readiness probe; required credentials must be probeable before launch',
        };
    if (readiness.code !== 'ready') {
      sink.push({
        code: 'credential_not_ready',
        requirementId: requirement.id,
        readiness: readiness.code,
        message: `credential requirement "${requirement.id}" is not ready: ${readiness.code}${readiness.setupInstruction ? ` (${readiness.setupInstruction})` : ''}`,
        ...(readiness.setupInstruction
          ? { setupInstruction: readiness.setupInstruction }
          : {}),
      });
    }
    if (readiness.code === 'ready') {
      credentialPlan.push({
        requirementId: requirement.id,
        envName: requirement.envName,
        destinations: requirement.destinations,
        bindingRef: binding.bindingRef,
        resolve: () => binding.resolve(),
      });
    }
    credentialEvidence.push({
      requirementId: requirement.id,
      envName: requirement.envName,
      destinations: requirement.destinations,
      bindingRef: binding.bindingRef,
      ...(readiness.provider ? { provider: readiness.provider } : {}),
      readiness: readiness.code,
    });
  }

  for (const entry of capabilities) {
    if (entry.requested === 'none' || entry.declared === 'enforced') continue;
    const code =
      entry.declared === 'degraded'
        ? 'capability_degraded'
        : 'capability_unsupported';
    (entry.requested === 'required' ? failures : warnings).push({
      code,
      capability: entry.capability,
      message: `${entry.requested} capability "${entry.capability}" is ${entry.declared} on adapter ${report.adapter.id}${entry.reason ? `: ${entry.reason}` : ''}`,
    });
  }

  const env: Record<string, string> = {};
  for (const name of intent.runtimeInputs) {
    const value = bindings.runtimeInputs?.[name];
    if (value === undefined) {
      failures.push({
        code: 'runtime_input_missing',
        input: name,
        message: `runtime input "${name}" is not bound on this machine`,
      });
      continue;
    }
    env[name] = value;
  }

  const contextInputs: PlannedContextInput[] = intent.context.map((ref) => {
    const bound = bindings.contextInputs?.[ref.slug];
    if (!bound) {
      warnings.push({
        code: 'context_input_unpinned',
        slug: ref.slug,
        message: `context "${ref.slug}" has no recorded revision or provenance`,
      });
      return { ...ref };
    }
    return { ...ref, revision: bound.revision, provenance: bound.provenance };
  });

  if (failures.length > 0) {
    return { ok: false, failures };
  }

  const effectiveNetwork: EffectiveNetworkPolicy = {
    requested: requestedNet,
    effective: {
      allowedDestinations: [...requestedNet.allowedDestinations, ...mandatory],
      allowedInternalHosts: requestedNet.allowedInternalHosts,
    },
    fidelity,
  };

  const launchPlan: SandboxLaunchPlan = deepFreezeClone({
    workspace: {
      hostPath: bindings.workspace.hostPath,
      mode: intent.sandbox.filesystem.workspace,
    },
    filesystem: intent.sandbox.filesystem,
    network: effectiveNetwork,
    ...(intent.sandbox.resources
      ? { resources: intent.sandbox.resources }
      : {}),
    env,
    credentials: credentialPlan,
    requirements: intent.capabilities,
    label: `${intent.ref.id}@${intent.ref.revision}`,
  });

  const preflight = await bindings.sandbox.preflight(launchPlan);
  if (!preflight.ok) {
    return {
      ok: false,
      failures: preflight.issues.map((issue) => ({
        code: 'preflight_failed',
        message: issue.message,
        ...(issue.capability ? { capability: issue.capability } : {}),
        ...(issue.requirementId ? { requirementId: issue.requirementId } : {}),
      })),
    };
  }
  for (const warning of preflight.warnings) {
    warnings.push({
      code: 'preflight_warning',
      message: warning.message,
      ...(warning.capability ? { capability: warning.capability } : {}),
      ...(warning.requirementId
        ? { requirementId: warning.requirementId }
        : {}),
    });
  }

  const policySnapshotHash =
    bindings.policySnapshotHash ?? sha256Digest(intent.toolPolicy);
  const withoutDigest: Omit<GovernancePlan, 'planDigest'> = {
    profile: intent.ref,
    policySnapshotHash,
    sandboxAdapter: report.adapter,
    capabilities,
    network: {
      requested: requestedNet,
      effective: effectiveNetwork.effective,
      mandatoryEgress: mandatory,
      fidelity,
    },
    hostPowers: intent.hostPowers.map((power) => {
      const declared = report.hostPowers.find((h) => h.power === power);
      return { power, locus: declared?.locus ?? 'outside-containment' };
    }),
    credentialBindings: credentialEvidence,
    contextInputs,
    // Excludes the host path and resolvers: same intent on two machines
    // yields the same digest, and no local detail is retained.
    launchPlanDigest: sha256Digest({
      filesystem: launchPlan.filesystem,
      network: launchPlan.network,
      resources: launchPlan.resources ?? null,
      envNames: Object.keys(env).sort(),
      credentials: credentialEvidence,
      requirements: launchPlan.requirements,
      workspaceMode: launchPlan.workspace.mode,
    }),
    resolvedAt: (bindings.now?.() ?? new Date()).toISOString(),
  };
  const plan: GovernancePlan = deepFreezeClone({
    ...withoutDigest,
    planDigest: sha256Digest(withoutDigest),
  });

  return { ok: true, plan, launchPlan, warnings };
}
