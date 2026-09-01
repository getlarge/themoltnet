import type { ExecutionMode } from './compile-execution-plan.js';
import type { CredentialRequirement } from './credential-requirements.js';

export const CREDENTIAL_READINESS_STATES = [
  'ready',
  'required_binding_missing',
  'binding_absent',
  'provider_unavailable',
  'host_store_inaccessible',
] as const;
export type CredentialReadinessState =
  (typeof CREDENTIAL_READINESS_STATES)[number];

/** Value-free host readiness supplied to the portable compiler. */
export interface CredentialReadinessRecord {
  name: string;
  required: boolean;
  status: CredentialReadinessState;
  /** Digest of a non-secret local selector; never the selector or value. */
  bindingDigest?: string;
  /** Provenance label such as local-activation or deployment-config. */
  source?: string;
}

export interface ExecutionIntent {
  mode: ExecutionMode;
  profile: {
    id: string;
    revision: number;
    definitionCid: string;
  };
  authority: {
    /** Existing content-addressed effective RuntimePolicy snapshot pin. */
    policySnapshotHash: string;
    policySnapshotVersion: string;
    /**
     * Resolved portable control authority. Undefined means the authority
     * source cannot answer and therefore fails closed. No policy IDs appear.
     */
    authorizedControls?: readonly string[];
  };
  credentialRequirements: readonly CredentialRequirement[];
  requiredCapabilities: readonly string[];
  lease: {
    ttlSec: number;
    requiredControls: readonly string[];
  };
  network: {
    allowedHosts: readonly string[];
    allowedInternalHosts: readonly string[];
  };
  provenance?: {
    profile: string;
    policy: string;
    requirements: string;
  };
}
