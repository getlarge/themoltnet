import type { Agent } from '@themoltnet/sdk';

import type { ClaimedTask, TaskSource } from './types.js';

export interface ApiTaskSourceOptions {
  agent: Agent;
  taskId: string;
  leaseTtlSec?: number;
  profileId?: string;
}

export class ApiTaskSource implements TaskSource {
  private claimed = false;

  constructor(private readonly opts: ApiTaskSourceOptions) {}

  async claim(): Promise<ClaimedTask | null> {
    if (this.claimed) return null;

    const { agent, taskId, leaseTtlSec, profileId } = this.opts;
    const result = await agent.tasks.claim(taskId, {
      ...(leaseTtlSec ? { leaseTtlSec } : {}),
      ...(profileId ? { profileId } : {}),
    });

    this.claimed = true;

    return {
      task: result.task,
      attemptN: result.attempt.attemptN,
      ...(profileId ? { profileId } : {}),
      traceHeaders: result.traceHeaders,
    };
  }

  async close(): Promise<void> {
    // Stateless; nothing to release.
  }
}
