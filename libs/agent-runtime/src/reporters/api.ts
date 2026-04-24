import type { TaskMessage, TaskUsage } from '@moltnet/tasks';
import type { TasksNamespace } from '@themoltnet/sdk';

import type { TaskReporter } from './types.js';

export interface ApiTaskReporterOptions {
  tasks: TasksNamespace;
  leaseTtlSec?: number;
  heartbeatIntervalMs?: number;
  /**
   * Max messages buffered before a synchronous flush is triggered.
   * Defaults to 50. Set to 1 to flush after every `record()` (legacy
   * one-POST-per-message behaviour; not recommended — produces 429s under
   * token-streaming workloads).
   */
  maxBatchSize?: number;
  /**
   * Time window for coalescing `record()` calls. When the buffer is non-empty,
   * the reporter flushes after at most this many ms. Defaults to 200ms.
   * Set to 0 to disable time-based flushing (flushes only on size / finalize).
   */
  flushIntervalMs?: number;
}

type BufferedMessage = {
  kind: TaskMessage['kind'];
  payload: TaskMessage['payload'];
  timestamp: string;
};

/**
 * TaskReporter backed by the Tasks API via the SDK's TasksNamespace.
 *
 * - `open()` fires an immediate heartbeat (satisfies DBOS recv('started', 300s))
 *   then starts the periodic timer
 * - `record()` enqueues into an in-memory buffer; the buffer is flushed when
 *   it reaches `maxBatchSize`, when `flushIntervalMs` elapses, or on
 *   `finalize()` / `close()`. Flushes call `tasks.appendMessages` with the
 *   full batch in a single POST. This is required because per-delta POSTs
 *   for streaming providers (one per token) overwhelm the API rate limiter.
 * - `finalize()` drains the buffer, stops timers, and stores usage
 */
export class ApiTaskReporter implements TaskReporter {
  private taskId = '';
  private attemptN = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizedUsage: TaskUsage | null = null;

  private readonly buffer: BufferedMessage[] = [];
  private inFlight: Promise<void> | null = null;
  /**
   * First error raised by a background flush. Surfaced on the next call
   * that can meaningfully block on it (`record`, `flush`, `finalize`) so
   * failures are never silently dropped by the batching layer.
   */
  private pendingError: Error | null = null;

  private readonly maxBatchSize: number;
  private readonly flushIntervalMs: number;

  constructor(private readonly opts: ApiTaskReporterOptions) {
    // `??` only substitutes the default for null/undefined, so a caller
    // passing `NaN` (e.g. from a failed `Number(flag)` upstream) would slip
    // through and silently disable batching (`x >= NaN` is always false).
    // Validate integer-ness here too — belt-and-braces against callers that
    // don't replicate the work-task CLI guards.
    const maxBatchSize = Number.isInteger(opts.maxBatchSize)
      ? (opts.maxBatchSize as number)
      : 50;
    const flushIntervalMs = Number.isInteger(opts.flushIntervalMs)
      ? (opts.flushIntervalMs as number)
      : 200;
    this.maxBatchSize = Math.max(1, maxBatchSize);
    this.flushIntervalMs = Math.max(0, flushIntervalMs);
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
          // Transient heartbeat failures should not crash the process from
          // inside a timer. The runtime owns terminal failure handling.
        });
      }, intervalMs);
    }
  }

  async record(
    body: Omit<TaskMessage, 'taskId' | 'attemptN' | 'seq' | 'timestamp'>,
  ): Promise<void> {
    this.throwIfPendingError();
    this.buffer.push({
      kind: body.kind,
      payload: body.payload,
      timestamp: new Date().toISOString(),
    });

    if (this.buffer.length >= this.maxBatchSize) {
      // Synchronous flush: guarantees backpressure — the caller awaits the
      // network round-trip once per batch instead of once per message.
      await this.flush();
      return;
    }

    if (this.flushIntervalMs > 0 && !this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush().catch((err) => {
          const wrapped = err instanceof Error ? err : new Error(String(err));
          if (this.pendingError) {
            // A prior timer-flush error is still waiting for the next
            // blocking call to surface it. Don't silently drop this one —
            // log to stderr so consecutive failures under a flaky network
            // are visible in the worker log even if only the first
            // survives to throw.
            console.error(
              `ApiTaskReporter: secondary timer-flush error (dropped) ` +
                `for task ${this.taskId} attempt ${this.attemptN}: ` +
                wrapped.message,
            );
          } else {
            this.pendingError = wrapped;
          }
        });
      }, this.flushIntervalMs);
    }
  }

  /**
   * Drain the buffer in a single `appendMessages` call. Safe to call when
   * empty (no-op). Callers that need ordering guarantees across concurrent
   * flushes await `inFlight` first, so two overlapping triggers (size limit
   * + timer) serialize to one POST per distinct batch.
   */
  async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.inFlight) {
      await this.inFlight;
    }
    if (this.buffer.length === 0) {
      this.throwIfPendingError();
      return;
    }

    const batch = this.buffer.splice(0, this.buffer.length);
    this.inFlight = (async () => {
      try {
        await this.opts.tasks.appendMessages(this.taskId, this.attemptN, {
          messages: batch,
        });
      } catch (err) {
        // The batch was spliced out of the buffer before the network call.
        // Restore the messages to the FRONT of the buffer so a subsequent
        // flush can retry them in the original order. Bound the buffer to
        // `maxBatchSize * 3` to prevent unbounded growth under sustained
        // failure: if restoring would overflow the cap, drop the oldest
        // overflow and log the loss so it's visible in Axiom/stderr.
        const overflowCap = this.maxBatchSize * 3;
        const restoredCount = batch.length;
        let droppedCount = 0;
        if (this.buffer.length + batch.length > overflowCap) {
          const room = Math.max(0, overflowCap - this.buffer.length);
          droppedCount = batch.length - room;
          if (droppedCount > 0) {
            console.error(
              `ApiTaskReporter: dropping ${droppedCount} of ${restoredCount} ` +
                `messages for task ${this.taskId} attempt ${this.attemptN} ` +
                `(buffer overflow cap=${overflowCap})`,
            );
          }
          batch.splice(room);
        }
        this.buffer.unshift(...batch);

        const detail = err instanceof Error ? err.message : String(err);
        throw new Error(
          `ApiTaskReporter: append messages failed for task ${this.taskId} ` +
            `attempt ${this.attemptN} ` +
            `(${restoredCount - droppedCount} messages restored for retry, ` +
            `${droppedCount} dropped): ${detail}`,
        );
      }
    })();

    try {
      await this.inFlight;
    } finally {
      this.inFlight = null;
    }
    this.throwIfPendingError();
  }

  async finalize(usage: TaskUsage): Promise<void> {
    this.finalizedUsage = usage;
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    // Drain remaining buffered messages so the completion signal never
    // races ahead of in-flight records.
    await this.flush();
  }

  async close(): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    // Always wait for any in-flight POST first: a timer-driven flush may
    // have spliced the buffer to empty and fired the request microseconds
    // before close() was invoked. Without this await we'd return while the
    // HTTP request is still pending, leaving a floating promise whose
    // error (if any) lands in a timer catch with no live caller.
    if (this.inFlight) {
      try {
        await this.inFlight;
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          `ApiTaskReporter: in-flight flush failed during close() ` +
            `for task ${this.taskId} attempt ${this.attemptN}: ${detail}`,
        );
      }
      this.inFlight = null;
    }
    // Best-effort drain of any messages still buffered (e.g. callers that
    // invoke close() without a prior finalize()). close() is terminal — no
    // caller will read `pendingError` after it returns — so any error here
    // goes only to stderr.
    if (this.buffer.length > 0) {
      try {
        await this.flush();
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        console.error(
          `ApiTaskReporter: final flush failed during close() ` +
            `for task ${this.taskId} attempt ${this.attemptN}: ${detail}`,
        );
      }
    }
  }

  private throwIfPendingError(): void {
    if (this.pendingError) {
      const err = this.pendingError;
      this.pendingError = null;
      throw err;
    }
  }

  private async sendHeartbeat(): Promise<void> {
    const body = this.opts.leaseTtlSec
      ? { leaseTtlSec: this.opts.leaseTtlSec }
      : {};
    await this.opts.tasks.heartbeat(this.taskId, this.attemptN, body);
  }
}
