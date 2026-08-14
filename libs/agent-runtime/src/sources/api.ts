import type { Agent } from '@themoltnet/sdk';

import { claimAuthorityFromAttempt } from './claim-authority.js';
import type {
  ClaimedTask,
  CreateClaimAttestation,
  TaskSource,
} from './types.js';

export interface ApiTaskSourceOptions {
  agent: Agent;
  taskId: string;
  leaseTtlSec?: number;
  profileId?: string;
  /** Fingerprint of a manifest registered once for this agent. */
  executorFingerprint?: string;
  /** Legacy inline attestation hook for callers without registration support. */
  createClaimAttestation?: CreateClaimAttestation;
}

export class ApiTaskSource implements TaskSource {
  private claimed = false;

  constructor(private readonly opts: ApiTaskSourceOptions) {}

  async claim(): Promise<ClaimedTask | null> {
    if (this.claimed) return null;

    const {
      agent,
      taskId,
      leaseTtlSec,
      profileId,
      executorFingerprint,
      createClaimAttestation,
    } = this.opts;
    const attestation = executorFingerprint
      ? { executorFingerprint }
      : await createClaimAttestation?.({
          taskId,
          ...(profileId ? { profileId } : {}),
        });
    const result = await agent.tasks.claim(taskId, {
      ...(leaseTtlSec ? { leaseTtlSec } : {}),
      ...(profileId ? { profileId } : {}),
      ...attestation,
    });

    this.claimed = true;
    const claimAuthority = claimAuthorityFromAttempt(result.attempt);

    return {
      task: result.task,
      attemptN: result.attempt.attemptN,
      ...(profileId ? { profileId } : {}),
      ...(claimAuthority ? { claimAuthority } : {}),
      traceHeaders: result.traceHeaders,
    };
  }

  async close(): Promise<void> {
    // Stateless; nothing to release.
  }
}
