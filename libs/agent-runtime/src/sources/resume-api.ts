import type { Agent } from '@themoltnet/sdk';

import { claimAuthorityFromAttempt } from './claim-authority.js';
import type { ClaimedTask, TaskSource } from './types.js';

/** Reattach only; writer acquisition/heartbeat enforce the still-valid server lease. */
export class ResumeApiTaskSource implements TaskSource {
  private yielded = false;
  constructor(
    private readonly options: {
      agent: Agent;
      taskId: string;
      attemptN: number;
      teamId: string;
      profileId: string;
      executorFingerprint: string;
      projectId: string | null;
    },
  ) {}
  async claim(): Promise<ClaimedTask | null> {
    if (this.yielded) return null;
    const {
      agent,
      taskId,
      attemptN,
      teamId,
      profileId,
      executorFingerprint,
      projectId,
    } = this.options;
    const [identity, task, attempts] = await Promise.all([
      agent.agents.whoami(),
      agent.tasks.get(taskId, { teamId }),
      agent.tasks.listAttempts(taskId, { teamId }),
    ]);
    const attempt = attempts.find((item) => item.attemptN === attemptN);
    if (
      identity.subjectType !== 'agent' ||
      !attempt ||
      task.teamId !== teamId ||
      task.projectId !== projectId ||
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
    this.yielded = true;
    return {
      task,
      attemptN,
      profileId,
      claimAuthority: claimAuthorityFromAttempt(attempt),
      traceHeaders: {},
    };
  }
  async close(): Promise<void> {}
}
