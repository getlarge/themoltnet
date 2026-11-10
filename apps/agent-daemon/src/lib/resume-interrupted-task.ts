import { setTimeout as delay } from 'node:timers/promises';

import { ApiTaskSource, type ClaimedTask } from '@themoltnet/agent-runtime';
import { type Agent, isTransientMoltNetError } from '@themoltnet/sdk';

/** Reattach only after the stopped executor's 30-second writer lease can expire.
 * The server still arbitrates acquisition of the next writer token. Reads never
 * claim another attempt, extend its budget, or authorize a different executor. */
export async function resumeInterruptedTask(input: {
  agent: Agent;
  claimed: ClaimedTask;
  manifest: Record<string, unknown>;
  executorFingerprint: string;
  signal: AbortSignal;
}): Promise<ClaimedTask | null> {
  const { claimed, signal } = input;
  const durability = input.manifest['durability'] as
    | { format?: string; recovery?: string; workspace?: string }
    | undefined;
  if (
    durability?.format !== 'pi-durable.v1' ||
    durability.recovery !== 'same-agent-valid-lease' ||
    durability.workspace !== 'persistent-mount' ||
    !claimed.profileId ||
    !claimed.claimAuthority?.leaseId ||
    claimed.claimAuthority.executorFingerprint !== input.executorFingerprint
  )
    return null;

  for (const waitMs of [30_000, 5_000, 10_000]) {
    await delay(waitMs, undefined, { signal });
    try {
      const source = new ApiTaskSource({
        agent: input.agent,
        taskId: claimed.task.id,
        resumeAttempt: claimed.attemptN,
        teamId: claimed.task.teamId,
        projectId: claimed.task.projectId,
        profileId: claimed.profileId,
        executorFingerprint: input.executorFingerprint,
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      const resumed = await source.claim();
      if (
        !resumed ||
        resumed.claimAuthority?.leaseId !== claimed.claimAuthority.leaseId ||
        resumed.claimAuthority.runtimeProfileRevision !==
          claimed.claimAuthority.runtimeProfileRevision ||
        resumed.claimAuthority.policySnapshotHash !==
          claimed.claimAuthority.policySnapshotHash
      )
        return null;
      return { ...resumed, traceHeaders: claimed.traceHeaders };
    } catch (error) {
      if (signal.aborted || !isTransientMoltNetError(error)) throw error;
    }
  }
  return null;
}
