import type { TaskMessage, TaskUsage } from '@moltnet/tasks';

import type { TaskReporter } from './types.js';

/**
 * Terminal-friendly reporter. Mirrors the streaming behavior of the
 * original `resolve-issue.ts` main loop (text deltas → stdout, tool
 * calls → `\n[tool] <name>...`, errors → stderr).
 *
 * Not structured output — use `JsonlReporter` for that.
 */
export class StdoutReporter implements TaskReporter {
  private seq = 0;
  private taskId = '';
  private attemptN = 0;

  async open(ctx: { taskId: string; attemptN: number }): Promise<void> {
    this.taskId = ctx.taskId;
    this.attemptN = ctx.attemptN;
    this.seq = 0;
    process.stdout.write(
      `\n[task] ${this.taskId} (attempt ${this.attemptN}) started\n\n`,
    );
  }

  async record(
    body: Omit<TaskMessage, 'taskId' | 'attemptN' | 'seq' | 'timestamp'>,
  ): Promise<void> {
    this.seq += 1;

    switch (body.kind) {
      case 'text_delta': {
        const delta = body.payload['delta'];
        if (typeof delta === 'string') process.stdout.write(delta);
        break;
      }
      case 'tool_call_start': {
        const name = body.payload['tool_name'];
        process.stdout.write(`\n[tool] ${String(name ?? '?')}...\n`);
        break;
      }
      case 'tool_call_end': {
        const isError = body.payload['is_error'];
        if (isError) {
          const name = body.payload['tool_name'];
          const result = body.payload['result'];
          process.stderr.write(
            `[tool:error] ${String(name ?? '?')}: ${JSON.stringify(result)}\n`,
          );
        }
        break;
      }
      case 'error': {
        const msg = body.payload['message'];
        process.stderr.write(`\n[ERROR] ${String(msg ?? 'unknown')}\n`);
        break;
      }
      case 'turn_end': {
        const stopReason = body.payload['stop_reason'];
        if (stopReason && stopReason !== 'end_turn') {
          process.stderr.write(`\n[turn_end] stop=${String(stopReason)}\n`);
        }
        break;
      }
      case 'info':
      default:
        // Silent in stdout mode; JSONL preserves everything.
        break;
    }
  }

  async finalize(usage: TaskUsage): Promise<void> {
    process.stdout.write(
      `\n\n[done] task ${this.taskId} — input=${usage.inputTokens}t output=${usage.outputTokens}t\n`,
    );
  }

  async close(): Promise<void> {
    // stdout is process-owned; nothing to release.
  }
}
