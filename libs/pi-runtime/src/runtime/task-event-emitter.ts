import type { TaskReporter } from '@themoltnet/agent-runtime';

const LOG_TRUNCATE_LIMIT = 4 * 1024;

// Wire-level kind union. Matches `TaskMessageKind` in libs/tasks; reusing
// `Parameters<TaskReporter['record']>[0]['kind']` keeps the two surfaces
// in sync and gives exhaustiveness in the summariser switch.
export type TurnEventKind = Parameters<TaskReporter['record']>[0]['kind'];

// Structured turn-event sink invoked alongside every `reporter.record()`.
// Mirrors task_messages into the daemon's local logger so operators can
// tail the workflow log without crawling Axiom or the console UI.
// Default is no-op so existing callers see no behavioural change.
export interface TurnEventHandler {
  (event: TurnEventKind, summary: Record<string, unknown>): void;
}

export interface EmitTaskEventInput {
  kind: TurnEventKind;
  payload: Record<string, unknown>;
  onTurnEvent: TurnEventHandler;
  reporter: TaskReporter;
  taskId: string;
  attemptN: number;
  log: (message: string) => void;
}

export async function emitTaskEvent(input: EmitTaskEventInput): Promise<void> {
  try {
    input.onTurnEvent(
      input.kind,
      summarizePayloadForLog(input.kind, input.payload),
    );
  } catch (err) {
    process.stderr.write(
      `[emit] onTurnEvent threw for kind="${input.kind}": ` +
        `${err instanceof Error ? err.message : String(err)}\n`,
    );
  }

  try {
    await input.reporter.record({
      kind: input.kind,
      payload: input.payload,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    input.log(
      `executePiTask: reporter.record() failed for task ${input.taskId} ` +
        `attempt ${input.attemptN} kind="${input.kind}": ${detail}`,
    );
  }
}

// Project a task_message payload into a flat shape suitable for a pino
// log line. Wire payload (with full deltas, stack traces) still goes to
// the API; this is just the summary the daemon prints locally.
function summarizePayloadForLog(
  kind: TurnEventKind,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  switch (kind) {
    case 'text_delta': {
      const delta = payload.delta;
      const chars = typeof delta === 'string' ? delta.length : 0;
      return { chars };
    }
    case 'tool_call_start':
      return { tool: payload.tool_name };
    case 'tool_call_end':
      return {
        tool: payload.tool_name,
        is_error: payload.is_error === true,
        ...(payload.is_error === true && payload.result !== undefined
          ? { result: payload.result }
          : {}),
      };
    case 'turn_end':
      return { stop_reason: payload.stop_reason };
    case 'error':
      return {
        phase: payload.phase,
        // String slice (not truncateForWire) keeps the value a string
        // for stable log shape; operators don't need original_size here.
        message:
          typeof payload.message === 'string'
            ? payload.message.slice(0, LOG_TRUNCATE_LIMIT)
            : payload.message,
      };
    case 'info':
      return Object.fromEntries(
        Object.entries(payload).map(([k, v]) => [
          k,
          typeof v === 'string' ? v.slice(0, LOG_TRUNCATE_LIMIT) : v,
        ]),
      );
    default:
      // Forward unknown kinds as-is so a future `TaskMessageKind`
      // addition still carries diagnostic data until the summariser
      // catches up. This branch only fires when someone bypasses the
      // type system at the call site.
      return payload;
  }
}
