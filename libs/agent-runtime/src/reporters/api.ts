import type { TaskMessage, TaskUsage } from '@moltnet/tasks';
import type { TasksNamespace } from '@themoltnet/sdk';

import type { TaskReporter } from './types.js';

export interface ApiTaskReporterOptions {
  tasks: TasksNamespace;
  leaseTtlSec?: number;
  heartbeatIntervalMs?: number;
}

/**
 * TaskReporter backed by the Tasks API via the SDK's TasksNamespace.
 *
 * - `open()` fires an immediate heartbeat (satisfies DBOS recv('started', 300s))
 *   then starts the periodic timer
 * - `record()` appends messages via the SDK
 * - `finalize()` stops the heartbeat timer
 */
export class ApiTaskReporter implements TaskReporter {
  private taskId = '';
  private attemptN = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private finalizedUsage: TaskUsage | null = null;

  constructor(private readonly opts: ApiTaskReporterOptions) {}

  getUsage(): TaskUsage | null {
    return this.finalizedUsage;
  }

  async open(ctx: { taskId: string; attemptN: number }): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.taskId = ctx.taskId;
    this.attemptN = ctx.attemptN;

    // Send immediately so the DBOS workflow receives the 'started' signal
    // before the dispatch timeout (default 5 min). Without this, fast tasks
    // that complete before the first periodic heartbeat silently time out.
    await this.sendHeartbeat();

    const intervalMs = this.opts.heartbeatIntervalMs ?? 60_000;
    if (intervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        void this.sendHeartbeat().catch(() => {
          // Transient heartbeat failures should not crash the process from
          // inside a timer. The runtime owns terminal failure handling.
        });
      }, intervalMs);
    }
  }

  async record(
    body: Omit<TaskMessage, 'taskId' | 'attemptN' | 'seq' | 'timestamp'>,
  ): Promise<void> {
    try {
      await this.opts.tasks.appendMessages(this.taskId, this.attemptN, {
        messages: [
          {
            kind: body.kind,
            payload: body.payload,
            timestamp: new Date().toISOString(),
          },
        ],
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new Error(
        `ApiTaskReporter: append messages failed for task ${this.taskId} ` +
          `attempt ${this.attemptN}: ${detail}`,
      );
    }
  }

  async finalize(usage: TaskUsage): Promise<void> {
    this.finalizedUsage = usage;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const body = this.opts.leaseTtlSec
      ? { leaseTtlSec: this.opts.leaseTtlSec }
      : {};
    await this.opts.tasks.heartbeat(this.taskId, this.attemptN, body);
  }
}
