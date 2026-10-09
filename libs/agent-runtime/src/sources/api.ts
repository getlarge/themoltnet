import type { Task } from '@moltnet/tasks';
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
  /** Reattach to an existing valid attempt instead of creating a claim. */
  resumeAttempt?: number;
  /** Owning team context. Falls back to SDK task context when already known. */
  teamId?: string;
  projectId?: string | null;
  profileId?: string;
  /** Fingerprint of a manifest registered once for this agent. */
  executorFingerprint?: string;
  /** Legacy inline attestation hook for callers without registration support. */
  createClaimAttestation?: CreateClaimAttestation;
  /** Reject incompatible tasks before a new claim consumes an attempt. */
  assertTaskEligible?: (task: Task) => void;
}

export class ApiTaskSource implements TaskSource {
  private claimed = false;

  constructor(private readonly opts: ApiTaskSourceOptions) {}

  async claim(): Promise<ClaimedTask | null> {
    if (this.claimed) return null;

    const result =
      this.opts.resumeAttempt === undefined
        ? await this.claimNew()
        : await this.resume(this.opts.resumeAttempt);
    const { profileId } = this.opts;

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

  private async claimNew() {
    const {
      agent,
      taskId,
      profileId,
      executorFingerprint,
      createClaimAttestation,
      teamId,
    } = this.opts;
    if (this.opts.assertTaskEligible) {
      const task = teamId
        ? await agent.tasks.get(taskId, { teamId })
        : await agent.tasks.get(taskId);
      this.opts.assertTaskEligible(task);
    }
    const attestation = executorFingerprint
      ? { executorFingerprint }
      : await createClaimAttestation?.({
          taskId,
          ...(profileId ? { profileId } : {}),
        });
    const claimBody = {
      projectId: this.opts.projectId ?? null,
      ...(profileId ? { profileId } : {}),
      ...attestation,
    };
    return teamId
      ? agent.tasks.claim(taskId, claimBody, { teamId })
      : agent.tasks.claim(taskId, claimBody);
  }

  /** Reattachment never mutates a claim; the server fences the task lease. */
  private async resume(attemptN: number) {
    const { agent, taskId, teamId, profileId, executorFingerprint, projectId } =
      this.opts;
    if (
      !Number.isSafeInteger(attemptN) ||
      attemptN < 1 ||
      !teamId ||
      !profileId ||
      !executorFingerprint
    ) {
      throw new Error(
        'Resume requires a positive attempt number, team, profile, and executor fingerprint',
      );
    }
    const [identity, task, attempts] = await Promise.all([
      agent.agents.whoami(),
      agent.tasks.get(taskId, { teamId }),
      agent.tasks.listAttempts(taskId, { teamId }),
    ]);
    this.opts.assertTaskEligible?.(task);
    const attempt = attempts.find((item) => item.attemptN === attemptN);
    if (
      identity.subjectType !== 'agent' ||
      !attempt ||
      task.teamId !== teamId ||
      task.projectId !== (projectId ?? null) ||
      !['dispatched', 'running'].includes(task.status) ||
      !['claimed', 'running'].includes(attempt.status) ||
      attempt.claimedByAgentId !== identity.subjectId ||
      attempt.runtimeProfileId !== profileId ||
      attempt.claimedExecutorFingerprint !== executorFingerprint ||
      !attempt.leaseId ||
      attempts.some((item) => item.attemptN > attemptN)
    ) {
      throw new Error(
        'Resume requires this agent’s active attempt, original profile, project, and executor fingerprint',
      );
    }
    return { task, attempt, traceHeaders: {} };
  }

  async close(): Promise<void> {
    // Stateless; nothing to release.
  }
}
