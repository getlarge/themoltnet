import type { TaskAttempt } from '@moltnet/tasks';

import type { ClaimAuthority } from './types.js';

type ClaimAuthorityAttempt = Partial<
  Pick<
    TaskAttempt,
    | 'claimedByAgentId'
    | 'leaseId'
    | 'runtimeProfileId'
    | 'runtimeProfileRevision'
    | 'policySnapshotHash'
    | 'claimedExecutorFingerprint'
  >
>;

/** Preserve only authority values echoed by the claim response. */
export function claimAuthorityFromAttempt(
  attempt: ClaimAuthorityAttempt,
): ClaimAuthority | undefined {
  const authority: ClaimAuthority = {
    ...(attempt.claimedByAgentId
      ? { claimantAgentId: attempt.claimedByAgentId }
      : {}),
    ...(attempt.leaseId ? { leaseId: attempt.leaseId } : {}),
    ...(attempt.runtimeProfileId
      ? { runtimeProfileId: attempt.runtimeProfileId }
      : {}),
    ...(typeof attempt.runtimeProfileRevision === 'number'
      ? { runtimeProfileRevision: attempt.runtimeProfileRevision }
      : {}),
    ...(attempt.policySnapshotHash
      ? { policySnapshotHash: attempt.policySnapshotHash }
      : {}),
    ...(attempt.claimedExecutorFingerprint
      ? { executorFingerprint: attempt.claimedExecutorFingerprint }
      : {}),
  };
  return Object.keys(authority).length > 0 ? authority : undefined;
}
