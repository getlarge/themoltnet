import { type TaskMessage, type TaskUsage } from '@moltnet/tasks';
import type { TasksNamespace } from '@themoltnet/sdk';

import { addActiveTaskEvent, traceRuntimePhase } from '../telemetry.js';
import type { TaskReporter } from './types.js';

export interface ApiTaskReporterOptions {
  tasks: TasksNamespace;
  /** Owning team context. Falls back to SDK task context when already known. */
  teamId?: string;
  heartbeatIntervalMs?: number;
  logger?: {
    warn(context: Record<string, unknown>, message: string): void;
  };
}

const MAX_BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 200;
const HEARTBEAT_TIMEOUT_MS = 30_000;

type BufferedMessage = {
  kind: TaskMessage['kind'];
  payload: TaskMessage['payload'];
  timestamp: string;
};

/** Narrowly identify the legacy server response caused by claimant-tuple lag. */
function isLegacyClaimantLag403(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const status = (err as { statusCode?: number }).statusCode;
  if (status !== 403) return false;
  const message = (err as { message?: string }).message ?? '';
  return /Not authorized/i.test(message);
}

/**
 * TaskReporter backed by the Tasks API via the SDK's TasksNamespace.
 *
 * - `open()` fires an immediate heartbeat (satisfies DBOS recv('started', 300s))
 *   then starts the periodic timer
 * - `record()` enqueues into an in-memory buffer; the buffer is flushed when
 *   it reaches 50 messages, after 200ms, or on
 *   `finalize()` / `close()`. Flushes call `tasks.appendMessages` with the
 *   full batch in a single POST. This is required because per-delta POSTs
 *   for streaming providers (one per token) overwhelm the API rate limiter.
 * - `finalize()` drains the buffer, stops timers, and stores usage
 */
export class ApiTaskReporter implements TaskReporter {
  private taskId = '';
  private attemptN = 0;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private heartbeatQueue: Promise<void> = Promise.resolve();
  private heartbeatPendingCount = 0;
  private initialHeartbeatSucceeded = false;
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
  /**
   * Compatibility guard for runtimes talking to servers that still authorize
   * reporting through the eventually-consistent Keto claimant tuple. New
   * database-authorized servers succeed on the first attempt, so this adds no
   * latency to their hot path.
   */
  private firstAppendSucceeded = false;
  private firstUsefulEventEmitted = false;

  private readonly cancelController = new AbortController();
  private observedCancelReason: string | null = null;

  constructor(private readonly opts: ApiTaskReporterOptions) {}

  getUsage(): TaskUsage | null {
    return this.finalizedUsage;
  }

  get cancelSignal(): AbortSignal {
    return this.cancelController.signal;
  }

  get cancelReason(): string | null {
    return this.observedCancelReason;
  }

  requestCancel(reason: string): void {
    this.abortForCancel(reason);
  }

  async open(ctx: { taskId: string; attemptN: number }): Promise<void> {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.taskId = ctx.taskId;
    this.attemptN = ctx.attemptN;
    this.firstAppendSucceeded = false;
    this.firstUsefulEventEmitted = false;
    this.initialHeartbeatSucceeded = false;

    // Send immediately so the DBOS workflow receives the 'started' signal
    // before the dispatch timeout (default 5 min). Without this, fast tasks
    // that complete before the first periodic heartbeat silently time out.
    //
    await traceRuntimePhase(
      'moltnet.reporter.open',
      { 'moltnet.task.attempt': this.attemptN },
      () => this.heartbeatNow(),
    );

    const intervalMs = this.opts.heartbeatIntervalMs ?? 60_000;
    if (intervalMs > 0) {
      this.heartbeatTimer = setInterval(() => {
        if (this.heartbeatPendingCount > 0) return;
        void this.heartbeatNow().catch(() => {
          // `heartbeatNow` logs the failure. A periodic connectivity blip must
          // not crash the process from inside a timer.
        });
      }, intervalMs);
    }
  }

  async record(
    body: Omit<TaskMessage, 'taskId' | 'attemptN' | 'seq' | 'timestamp'>,
  ): Promise<void> {
    this.throwIfPendingError();
    if (!this.firstUsefulEventEmitted) {
      const usefulKind =
        body.kind === 'tool_call_start' ||
        (body.kind === 'text_delta' &&
          typeof body.payload['delta'] === 'string' &&
          body.payload['delta'].trim().length > 0)
          ? body.kind
          : null;
      if (usefulKind) {
        this.firstUsefulEventEmitted = true;
        addActiveTaskEvent('moltnet.task.first_useful_event.emitted', {
          'moltnet.task.first_useful.kind': usefulKind,
        });
      }
    }
    this.buffer.push({
      kind: body.kind,
      payload: body.payload,
      timestamp: new Date().toISOString(),
    });

    if (this.buffer.length >= MAX_BATCH_SIZE) {
      // Synchronous flush: guarantees backpressure — the caller awaits the
      // network round-trip once per batch instead of once per message.
      await this.flush();
      return;
    }

    if (!this.flushTimer) {
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
      }, FLUSH_INTERVAL_MS);
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
        await this.appendWithFirstCallRetry(batch);
        this.firstAppendSucceeded = true;
      } catch (err) {
        // The batch was spliced out of the buffer before the network call.
        // Restore the messages to the FRONT of the buffer so a subsequent
        // flush can retry them in the original order. Bound the buffer to
        // three batches to prevent unbounded growth under sustained
        // failure: if restoring would overflow the cap, drop the oldest
        // overflow and log the loss so it's visible in Axiom/stderr.
        const overflowCap = MAX_BATCH_SIZE * 3;
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
    await this.drainHeartbeats();
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
    await this.drainHeartbeats();
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

  /** Send a heartbeat after all earlier heartbeat checks have settled. */
  heartbeatNow(): Promise<void> {
    this.heartbeatPendingCount += 1;
    const pending = this.heartbeatQueue.then(() => this.sendHeartbeatBounded());
    this.heartbeatQueue = pending.catch(() => undefined);
    void pending.then(
      () => {
        this.heartbeatPendingCount -= 1;
      },
      () => {
        this.heartbeatPendingCount -= 1;
      },
    );
    return pending;
  }

  private async sendHeartbeatBounded(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(new Error('Heartbeat request timed out')),
      HEARTBEAT_TIMEOUT_MS,
    );
    try {
      await this.sendHeartbeatWithCompatibilityRetry(controller.signal);
    } catch (err) {
      this.warn(
        { err, taskId: this.taskId, attemptN: this.attemptN },
        'agent-runtime.reporter.heartbeat_failed',
      );
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Preserve bounded compatibility with pre-database-authority servers. Only
   * the initial 403 is retried; all other failures still surface immediately.
   */
  private async sendHeartbeatWithCompatibilityRetry(
    signal: AbortSignal,
  ): Promise<void> {
    if (this.initialHeartbeatSucceeded) {
      await this.sendHeartbeat(signal);
      return;
    }
    const maxAttempts = 5;
    const baseDelayMs = 100;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.sendHeartbeat(signal);
        this.initialHeartbeatSucceeded = true;
        return;
      } catch (err) {
        if (attempt === maxAttempts || !isLegacyClaimantLag403(err)) throw err;
        await abortableDelay(baseDelayMs * attempt, signal);
      }
    }
  }

  private async appendWithFirstCallRetry(
    batch: BufferedMessage[],
  ): Promise<void> {
    if (this.firstAppendSucceeded) {
      await this.appendMessages(batch);
      return;
    }
    const maxAttempts = 5;
    const baseDelayMs = 100;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await this.appendMessages(batch);
        return;
      } catch (err) {
        if (attempt === maxAttempts || !isLegacyClaimantLag403(err)) throw err;
        await new Promise<void>((resolve) => {
          setTimeout(resolve, baseDelayMs * attempt);
        });
      }
    }
  }

  private async sendHeartbeat(signal: AbortSignal): Promise<void> {
    const response = this.opts.teamId
      ? await this.opts.tasks.heartbeat(
          this.taskId,
          this.attemptN,
          {},
          {
            teamId: this.opts.teamId,
            signal,
          },
        )
      : await this.opts.tasks.heartbeat(
          this.taskId,
          this.attemptN,
          {},
          { signal },
        );
    // The server reports cancellation via a 200 response with
    // cancelled:true so the worker gets a clean abort signal instead
    // of having to interpret a 409 envelope (#938). Once observed, abort
    // the controller — executors that wired the signal into their loop
    // will tear down; the runtime will convert the output to 'cancelled'
    // post-execute regardless.
    if (response?.cancelled) {
      this.abortForCancel(response.cancelReason ?? null);
    }
  }

  private appendMessages(batch: BufferedMessage[]): Promise<{ count: number }> {
    const body = { messages: batch };
    return this.opts.teamId
      ? this.opts.tasks.appendMessages(this.taskId, this.attemptN, body, {
          teamId: this.opts.teamId,
        })
      : this.opts.tasks.appendMessages(this.taskId, this.attemptN, body);
  }

  private abortForCancel(reason: string | null): void {
    if (this.cancelController.signal.aborted) {
      return;
    }
    this.observedCancelReason = reason;
    this.cancelController.abort(
      new Error(
        `Task cancelled${
          this.observedCancelReason ? `: ${this.observedCancelReason}` : ''
        }`,
      ),
    );
    // Stop the heartbeat timer once cancellation is observed; further
    // heartbeats add no value and pile up rejected requests if the
    // executor takes time to honor the signal.
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async drainHeartbeats(): Promise<void> {
    try {
      await this.heartbeatQueue;
    } catch {
      // Individual heartbeat failures are logged at the request boundary.
    }
  }

  private warn(context: Record<string, unknown>, message: string): void {
    if (this.opts.logger) {
      this.opts.logger.warn(context, message);
      return;
    }
    const detail = context['err'];
    console.error(
      `${message} for task ${this.taskId} attempt ${this.attemptN}: ${
        detail instanceof Error ? detail.message : String(detail)
      }`,
    );
  }
}

function abortableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortReason(signal));
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(abortReason(signal));
    };
    const timeout = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error('Heartbeat aborted');
}
