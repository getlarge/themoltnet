import type {
  CredentialRequirement,
  ExecutionIntent,
  ExecutionMode,
} from '@moltnet/execution-plan';
import type { EffectivePolicySnapshotV1 } from '@moltnet/runtime-policy-service';
import type { ResolvedRuntimeProfile } from '@themoltnet/agent-runtime';

export const CURRENT_EFFECTIVE_POLICY_SNAPSHOT_VERSION: EffectivePolicySnapshotV1['version'] =
  'effective-policy:v1';

/** An already-composed, content-addressed authority result. */
export interface ResolvedPolicyAuthority {
  hash: string;
  snapshot: Pick<EffectivePolicySnapshotV1, 'version' | 'runtimeKind'>;
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
      ttlSec: input.profile.leaseTtlSec,
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
