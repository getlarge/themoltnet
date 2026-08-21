import { sha256Digest } from './digest.js';
import {
  assertPortableRuntimeProfile,
  type ContextReference,
  type HostPower,
  type RuntimeProfile,
  type RuntimeProfileRef,
  SANDBOX_CAPABILITIES,
  type SandboxCapability,
} from './profile.js';
import {
  type BrokeredCredentialBinding,
  type DeclaredCapability,
  declaredCapability,
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
 * to this machine: which adapter, which workspace, which credential resolver,
 * which rendered context revision. None of it is part of the profile, and
 * only value-free references from it reach the resolved profile.
 */
export interface TrustedRuntimeBindings {
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

export interface ResolvedCapability {
  capability: SandboxCapability;
  requested: RequirementLevel | 'none';
  declared: EnforcementState;
  locus: EnforcementLocus;
  reason?: string;
}

export interface ResolvedCredentialBinding {
  requirementId: string;
  envName: string;
  destinationHosts: readonly string[];
  /** Non-secret binding reference. Never a value or a provider secret path. */
  bindingRef: string;
}

export interface ResolvedContextInput extends ContextReference {
  revision?: string;
  provenance?: string;
}

/**
 * Resolved runtime profile: immutable, value-free launch plan. It pins the
 * profile revision, policy snapshot hash, selected adapter, capability
 * verdicts, credential binding references, context provenance, and a digest
 * of the launch plan. It contains no host path, no resolver, no value.
 */
export interface ResolvedRuntimeProfile {
  readonly profile: RuntimeProfileRef;
  readonly policySnapshotHash: string;
  readonly sandboxAdapter: SandboxAdapterIdentity;
  readonly capabilities: readonly ResolvedCapability[];
  readonly hostPowers: readonly {
    power: HostPower;
    locus: 'outside-containment' | 'host-broker';
  }[];
  readonly credentialBindings: readonly ResolvedCredentialBinding[];
  readonly contextInputs: readonly ResolvedContextInput[];
  readonly launchPlanDigest: string;
  readonly resolvedAt: string;
}

export interface ResolutionFailure {
  code:
    | 'profile_not_portable'
    | 'capability_unsupported'
    | 'credential_binding_missing'
    | 'runtime_input_missing'
    | 'context_input_unpinned'
    | 'preflight_failed';
  message: string;
  capability?: SandboxCapability;
  requirementId?: string;
  slug?: string;
  input?: string;
}

export type ResolutionResult =
  | {
      ok: true;
      resolved: ResolvedRuntimeProfile;
      /** Executable plan for the adapter. Not retained as evidence. */
      launchPlan: SandboxLaunchPlan;
      warnings: readonly ResolutionFailure[];
    }
  | { ok: false; failures: readonly ResolutionFailure[] };

function capabilityVerdict(
  capability: SandboxCapability,
  requested: RequirementLevel | 'none',
  declared: DeclaredCapability | undefined,
): ResolvedCapability {
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

/**
 * Resolve a portable profile against trusted bindings. Resolution stops
 * before any launch when a required capability is unsupported, a required
 * credential binding is missing, a runtime input is absent, or the adapter's
 * preflight fails. It reads no secret value.
 */
export async function resolveRuntimeProfile(
  profile: RuntimeProfile,
  bindings: TrustedRuntimeBindings,
): Promise<ResolutionResult> {
  const failures: ResolutionFailure[] = [];
  const warnings: ResolutionFailure[] = [];

  try {
    assertPortableRuntimeProfile(profile);
  } catch (error) {
    const issues =
      error instanceof Error && 'issues' in error
        ? (error as { issues: readonly string[] }).issues
        : [String(error)];
    return {
      ok: false,
      failures: issues.map((message) => ({
        code: 'profile_not_portable',
        message,
      })),
    };
  }

  const report = bindings.sandbox.describe();
  const capabilities: ResolvedCapability[] = SANDBOX_CAPABILITIES.map(
    (capability) =>
      capabilityVerdict(
        capability,
        profile.capabilities[capability] ?? 'none',
        declaredCapability(report, capability),
      ),
  );
  if (profile.credentials.length > 0) {
    const requested = profile.credentials.some((c) => c.required)
      ? 'required'
      : 'preferred';
    const entry = capabilities.find(
      (c) => c.capability === 'brokered-credential',
    );
    if (entry && entry.requested === 'none') entry.requested = requested;
  }
  for (const entry of capabilities) {
    if (entry.requested === 'required' && entry.declared !== 'enforced') {
      failures.push({
        code: 'capability_unsupported',
        capability: entry.capability,
        message: `required capability "${entry.capability}" is ${entry.declared} on adapter ${report.adapter.id}`,
      });
    } else if (
      entry.requested === 'preferred' &&
      entry.declared !== 'enforced'
    ) {
      warnings.push({
        code: 'capability_unsupported',
        capability: entry.capability,
        message: `preferred capability "${entry.capability}" is ${entry.declared} on adapter ${report.adapter.id}`,
      });
    }
  }

  const credentialPlan: BrokeredCredentialBinding[] = [];
  const credentialEvidence: ResolvedCredentialBinding[] = [];
  for (const requirement of profile.credentials) {
    const binding = bindings.credentials[requirement.id];
    if (!binding) {
      const failure: ResolutionFailure = {
        code: 'credential_binding_missing',
        requirementId: requirement.id,
        message: `credential requirement "${requirement.id}" (${requirement.purpose}) has no trusted binding on this machine`,
      };
      (requirement.required ? failures : warnings).push(failure);
      continue;
    }
    const destinationHosts = requirement.destinationHosts;
    credentialPlan.push({
      requirementId: requirement.id,
      envName: requirement.envName,
      destinationHosts,
      bindingRef: binding.bindingRef,
      resolve: () => binding.resolve(),
    });
    credentialEvidence.push({
      requirementId: requirement.id,
      envName: requirement.envName,
      destinationHosts,
      bindingRef: binding.bindingRef,
    });
  }

  const env: Record<string, string> = {};
  for (const name of profile.runtimeInputs) {
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

  const contextInputs: ResolvedContextInput[] = profile.context.map((ref) => {
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

  const launchPlan: SandboxLaunchPlan = {
    workspace: {
      hostPath: bindings.workspace.hostPath,
      mode: profile.sandbox.filesystem.workspace,
    },
    filesystem: profile.sandbox.filesystem,
    network: profile.sandbox.network,
    ...(profile.sandbox.resources
      ? { resources: profile.sandbox.resources }
      : {}),
    env,
    credentials: credentialPlan,
    requirements: profile.capabilities,
    label: `${profile.ref.id}@${profile.ref.revision}`,
  };

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

  const policySnapshotHash =
    bindings.policySnapshotHash ?? sha256Digest(profile.toolPolicy);
  const resolved: ResolvedRuntimeProfile = Object.freeze({
    profile: { ...profile.ref },
    policySnapshotHash,
    sandboxAdapter: { ...report.adapter },
    capabilities,
    hostPowers: profile.hostPowers.map((power) => {
      const declared = report.hostPowers.find((h) => h.power === power);
      return { power, locus: declared?.locus ?? 'outside-containment' };
    }),
    credentialBindings: credentialEvidence,
    contextInputs,
    // Digest excludes the host path and resolvers: same intent on two
    // machines yields the same digest, and no local detail is retained.
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
  });

  return { ok: true, resolved, launchPlan, warnings };
}
