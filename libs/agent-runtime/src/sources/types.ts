import type { Task } from '@moltnet/tasks';

export interface ExecutorAttestationFields {
  executorManifest?: Record<string, unknown>;
  executorFingerprint: string;
  executorSignature?: string;
}

export type CreateClaimAttestation = (input: {
  taskId: string;
  profileId?: string;
}) => Promise<ExecutorAttestationFields>;

/**
 * Immutable authority evidence returned by an API-backed task claim.
 *
 * The field is optional on {@link ClaimedTask} so local files and older task
 * sources remain valid. It records what the server accepted at claim time; it
 * does not replace the runtime policy resolved for a later Pi session.
 */
export interface ClaimAuthority {
  claimantAgentId?: string;
  leaseId?: string;
  runtimeProfileId?: string;
  runtimeProfileRevision?: number;
  policySnapshotHash?: string;
  executorFingerprint?: string;
}

export interface ClaimAttemptAuthorityFields {
  claimedByAgentId?: string | null;
  leaseId?: string | null;
  runtimeProfileId?: string | null;
  runtimeProfileRevision?: number | null;
  policySnapshotHash?: string | null;
  claimedExecutorFingerprint?: string | null;
}

/** Preserve the claim response without manufacturing evidence for legacy APIs. */
export function claimAuthorityFromAttempt(
  attempt: ClaimAttemptAuthorityFields,
  fallback?: {
    runtimeProfileId?: string;
    executorFingerprint?: string;
  },
): ClaimAuthority | undefined {
  const authority: ClaimAuthority = {
    ...(attempt.claimedByAgentId
      ? { claimantAgentId: attempt.claimedByAgentId }
      : {}),
    ...(attempt.leaseId ? { leaseId: attempt.leaseId } : {}),
    ...((attempt.runtimeProfileId ?? fallback?.runtimeProfileId)
      ? {
          runtimeProfileId:
            attempt.runtimeProfileId ?? fallback?.runtimeProfileId,
        }
      : {}),
    ...(typeof attempt.runtimeProfileRevision === 'number'
      ? { runtimeProfileRevision: attempt.runtimeProfileRevision }
      : {}),
    ...(attempt.policySnapshotHash
      ? { policySnapshotHash: attempt.policySnapshotHash }
      : {}),
    ...((attempt.claimedExecutorFingerprint ?? fallback?.executorFingerprint)
      ? {
          executorFingerprint:
            attempt.claimedExecutorFingerprint ?? fallback?.executorFingerprint,
        }
      : {}),
  };
  return Object.keys(authority).length > 0 ? authority : undefined;
}

export interface ClaimedTask {
  /** The claimed task payload itself. */
  task: Task;
  /** Attempt number assigned by the source/queue. */
  attemptN: number;
  /** Runtime profile id selected by the source when claim routing is profile-scoped. */
  profileId?: string;
  /** Claim-time authority and attestation evidence from API-backed sources. */
  claimAuthority?: ClaimAuthority;
  /** W3C trace headers from the claim response for OTel context propagation. */
  traceHeaders: Record<string, string>;
}

/**
 * A pull-based queue of tasks ready to execute.
 *
 * Contract: `TaskSource` is the ONLY way `AgentRuntime` learns about work.
 * Whether tasks come from a local JSON file, stdin, or an HTTP
 * `POST /agent-runtimes/:id/tasks/claim` call is the source's concern — so
 * `AgentRuntime` is identical in local and API modes (the other half of the
 * PR 0 ↔ PR 7 swap, alongside `TaskReporter`).
 *
 * Sources are single-use unless documented otherwise: PR 0 sources yield
 * one task then return `null`. PR 7's `ApiTaskSource` may long-poll and
 * return an API-assigned attempt number.
 */
export interface TaskSource {
  /**
   * Claim the next task, or resolve `null` when the source is exhausted.
   * Implementations MAY block (e.g. long-polling); callers drive the loop.
   */
  claim(): Promise<ClaimedTask | null>;

  /**
   * Release resources (file handles, HTTP clients). Called once by the
   * runtime after the loop exits. Idempotent.
   */
  close(): Promise<void>;
}
