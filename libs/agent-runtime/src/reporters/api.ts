import type { TaskMessage, TaskUsage } from '@moltnet/tasks';

import type { TaskReporter } from './types.js';

export interface ApiTaskReporterOptions {
  baseUrl: string;
  auth: () => Promise<string>;
  leaseTtlSec?: number;
  heartbeatIntervalMs?: number;
  fetch?: typeof fetch;
}

/**
 * TaskReporter backed by the Tasks API.
 *
 * - `record()` appends messages through `/messages`
 * - `open()` starts a heartbeat loop so long-running attempts keep their lease
 * - `finalize()` stops heartbeats and stores final usage locally for callers
 */
export class ApiTaskReporter implements TaskReporter {
  private taskId = '';
  private attemptN = 0;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private finalizedUsage: TaskUsage | null = null;

  constructor(private readonly opts: ApiTaskReporterOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.fetchImpl = opts.fetch ?? fetch;
  }

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
          // The executor/runtime owns terminal failure handling. A transient
          // heartbeat blip should not crash the process from inside a timer.
        });
      }, intervalMs);
    }
  }

  async record(
    body: Omit<TaskMessage, 'taskId' | 'attemptN' | 'seq' | 'timestamp'>,
  ): Promise<void> {
    const token = await this.opts.auth();
    const response = await this.fetchImpl(
      `${this.baseUrl}/tasks/${this.taskId}/attempts/${this.attemptN}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: [
            {
              kind: body.kind,
              payload: body.payload,
              timestamp: new Date().toISOString(),
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `ApiTaskReporter: append messages failed for task ${this.taskId} ` +
          `attempt ${this.attemptN}: ${response.status} ${response.statusText}`,
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
    const token = await this.opts.auth();
    const response = await this.fetchImpl(
      `${this.baseUrl}/tasks/${this.taskId}/attempts/${this.attemptN}/heartbeat`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          this.opts.leaseTtlSec ? { leaseTtlSec: this.opts.leaseTtlSec } : {},
        ),
      },
    );

    if (!response.ok) {
      throw new Error(
        `ApiTaskReporter: heartbeat failed for task ${this.taskId} ` +
          `attempt ${this.attemptN}: ${response.status} ${response.statusText}`,
      );
    }
  }
}
