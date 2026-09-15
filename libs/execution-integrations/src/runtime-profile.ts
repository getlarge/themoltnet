import type {
  CredentialRequirement,
  ExecutionIntent,
  ExecutionMode,
} from '@moltnet/execution-plan';
import type {
  EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION,
  EffectivePolicySnapshot,
} from '@moltnet/runtime-policy-service';
import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';

// Type-checked against the service constant without a runtime import.
export const CURRENT_EFFECTIVE_POLICY_SNAPSHOT_VERSION: typeof EFFECTIVE_POLICY_SNAPSHOT_SCHEMA_VERSION =
  'effective-policy:v2';
const DEFAULT_EXECUTION_LEASE_TTL_SEC = 300;

/** An already-composed, content-addressed authority result. */
export interface ResolvedPolicyAuthority {
  hash: string;
  snapshot: Pick<EffectivePolicySnapshot, 'version' | 'runtimeKind'>;
  /** Undefined until the authority source can answer portable controls. */
  authorizedControls?: readonly string[];
}

export interface RuntimeProfileIntentInput {
  mode: ExecutionMode;
  profile: ResolvedRuntimeProfile;
  profileRevision: number;
  policy: ResolvedPolicyAuthority;
  credentialRequirements: readonly CredentialRequirement[];
  requiredCapabilities?: readonly string[];
  requiredLeaseControls?: readonly string[];
  requirementsProvenance: string;
}

/**
 * Maps resolved product authority into portable intent. Policy composition is
 * deliberately upstream: this boundary accepts no policy IDs and performs no
 * union, lookup, or precedence handling.
 */
export function executionIntentFromRuntimeProfile(
  input: RuntimeProfileIntentInput,
): ExecutionIntent {
  if (input.policy.snapshot.runtimeKind !== input.profile.runtimeKind) {
    throw new Error('resolved policy authority does not match runtime profile');
  }
  const network = input.profile.sandboxConfig.network;
  return {
    mode: input.mode,
    profile: {
      id: input.profile.id,
      revision: input.profileRevision,
      definitionCid: input.profile.definitionCid,
    },
    authority: {
      policySnapshotHash: input.policy.hash,
      policySnapshotVersion: input.policy.snapshot.version,
      ...(input.policy.authorizedControls !== undefined && {
        authorizedControls: [...input.policy.authorizedControls],
      }),
    },
    credentialRequirements: structuredClone(input.credentialRequirements),
    requiredCapabilities: [...(input.requiredCapabilities ?? [])],
    lease: {
      ttlSec: DEFAULT_EXECUTION_LEASE_TTL_SEC,
      requiredControls: [...(input.requiredLeaseControls ?? [])],
    },
    network: {
      allowedHosts: [...(network?.allowedHosts ?? [])],
      allowedInternalHosts: [...(network?.allowedInternalHosts ?? [])],
    },
    provenance: {
      profile: input.profile.source,
      policy: `runtime-policy-snapshot:${input.policy.hash}`,
      requirements: input.requirementsProvenance,
    },
  };
}
