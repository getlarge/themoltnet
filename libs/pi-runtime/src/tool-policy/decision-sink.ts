import type { ToolPolicyDecisionRecord } from './session-policy.js';

/**
 * Collects policy refusals emitted from pi's synchronous `tool_call` handler
 * and lets the attempt drain them before the reporter is finalized.
 *
 * The handler cannot await: returning a promise would delay, and could change,
 * the gate's verdict. But a refusal is security evidence, so it must not be
 * dropped when the attempt tears down. The sink is that seam — record without
 * awaiting, drain once at the end.
 */
export interface ToolPolicyDecisionSink {
  /** Record a refusal. Never throws and never blocks the caller. */
  record(record: ToolPolicyDecisionRecord & { execution: string }): void;
  /** Resolve once every recorded emission has settled. */
  drain(): Promise<void>;
  /** Number of emissions recorded so far. For assertions and diagnostics. */
  readonly size: number;
}

export function createToolPolicyDecisionSink(
  emit: (
    record: ToolPolicyDecisionRecord & { execution: string },
  ) => Promise<void>,
): ToolPolicyDecisionSink {
  const pending: Promise<void>[] = [];
  return {
    record(record) {
      try {
        // A rejected emission must not become an unhandled rejection, and must
        // not fail the drain: the attempt's outcome does not depend on whether
        // its audit trail was written.
        pending.push(Promise.resolve(emit(record)).catch(() => undefined));
      } catch {
        // A synchronous throw from `emit` is swallowed for the same reason.
      }
    },
    async drain() {
      // Await a snapshot: an emission recorded while draining is captured by
      // the loop rather than missed.
      while (pending.length > 0) {
        const batch = pending.splice(0, pending.length);
        await Promise.all(batch);
      }
    },
    get size() {
      return pending.length;
    },
  };
}
