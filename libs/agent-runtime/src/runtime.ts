/**
 * AgentRuntime — coding-agent-agnostic claim → execute → report loop.
 *
 * The runtime pulls tasks from a `TaskSource` and hands each one to an
 * injected `executeTask` function that knows how to actually run it. PR 0
 * ships one concrete executor (pi + Gondolin, in `@themoltnet/pi-extension`),
 * but the runtime itself has no idea whether tasks run via pi, the Codex
 * CLI, the Anthropic SDK, or anything else.
 *
 * PR 7's daemon mode swaps `TaskSource` (file → HTTP long-poll) and
 * `TaskReporter` (stdout/jsonl → HTTP POST). The executor is unchanged.
 */
import type { TaskOutput, TaskUsage } from '@moltnet/tasks';
import {
  context as otelContext,
  propagation,
  ROOT_CONTEXT,
} from '@opentelemetry/api';
import { pino } from 'pino';

import type { TaskReporter } from './reporters/index.js';
import type { ClaimedTask, TaskSource } from './sources/index.js';

type LogFn = (obj: Record<string, unknown>, msg: string) => void;
/**
 * Minimal pino-compatible logger surface used by the runtime, the
 * task sources, and (eventually) reporters. Structurally compatible
 * with both pino's `Logger` and Fastify's `FastifyBaseLogger`, so
 * callers can pass an existing app logger without unsafe casts.
 *
 * The `child()` method is critical: per-task scopes bind taskId/
 * taskType/attemptN once and every downstream log inherits them.
 */
export interface AgentRuntimeLogger {
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
  child(bindings: Record<string, unknown>): AgentRuntimeLogger;
}

/**
 * Runs one task attempt. Concrete implementations own the VM, the LLM
 * session, and any other coding-agent state. They MUST resolve with a
 * `TaskOutput`; failures surface as `status: 'failed'`, not thrown errors.
 */
export type TaskExecutor = (
  claimedTask: ClaimedTask,
  reporter: TaskReporter,
) => Promise<TaskOutput>;

export interface AgentRuntimeOptions {
  /** Pulls the next task (file in PR 0, HTTP poll in PR 7). */
  source: TaskSource;
  /**
   * Factory for per-task reporters. Called once per claimed task so
   * reporters can own a fresh file / stream / connection.
   */
  makeReporter: (claimedTask: ClaimedTask) => TaskReporter;
  /**
   * Runs one attempt of the claimed task. Injected by the caller so this
   * package stays free of pi / Gondolin / SDK dependencies.
   */
  executeTask: TaskExecutor;
  /**
   * Pino-compatible logger for unconditional lifecycle events
   * (task claimed → info, task finished → info). Defaults to a
   * self-named pino instance so the daemon emits structured logs
   * without --debug. Callers running inside a Fastify app should
   * pass `app.log` so logs ride the existing per-request scope.
   */
  logger?: AgentRuntimeLogger;
}

export interface AgentRuntimeStatus {
  state: 'idle' | 'running' | 'stopped';
  tasksProcessed: number;
  currentTaskId: string | null;
}

export class AgentRuntime {
  private status: AgentRuntimeStatus = {
    state: 'idle',
    tasksProcessed: 0,
    currentTaskId: null,
  };
  private stopRequested = false;
  private readonly logger: AgentRuntimeLogger;

  constructor(private readonly opts: AgentRuntimeOptions) {
    this.logger = opts.logger ?? pino({ name: 'agent-runtime' });
  }

  getStatus(): AgentRuntimeStatus {
    return { ...this.status };
  }

  /**
   * Drain the source, executing each task via `opts.executeTask`. Resolves
   * with every `TaskOutput` in claim order.
   */
  async start(): Promise<TaskOutput[]> {
    if (this.status.state !== 'idle') {
      throw new Error(
        `AgentRuntime: cannot start from state=${this.status.state}`,
      );
    }
    this.status.state = 'running';

    const outputs: TaskOutput[] = [];
    try {
      while (!this.stopRequested) {
        const claimedTask = await this.opts.source.claim();
        if (!claimedTask) break;

        this.status.currentTaskId = claimedTask.task.id;
        // Bind task-scoped fields as child-logger context so every log
        // emitted while this task runs (claim, finish, anything the
        // executor logs through the same pipeline) carries them
        // automatically without repeating.
        const taskLogger = this.logger.child({
          taskId: claimedTask.task.id,
          taskType: claimedTask.task.taskType,
          attemptN: claimedTask.attemptN,
        });
        taskLogger.info({}, 'agent-runtime.task_claimed');
        const reporter = this.opts.makeReporter(claimedTask);
        // Restore the W3C trace context from the claim response so every
        // OTel-instrumented call inside the task (heartbeats, messages, tool
        // calls in pi-extension) lands as a child span of the workflow trace.
        const taskCtx = Object.keys(claimedTask.traceHeaders).length
          ? propagation.extract(ROOT_CONTEXT, claimedTask.traceHeaders)
          : otelContext.active();
        const taskStart = Date.now();
        let output: TaskOutput;
        try {
          output = await otelContext.with(taskCtx, () =>
            this.opts.executeTask(claimedTask, reporter),
          );
        } catch (err) {
          // Contract: executors resolve with `status: 'failed'` on agent
          // failure, but they may still throw on unrecoverable setup errors
          // (snapshot build, VM resume, unexpected bugs). Convert those into
          // a structured failure so the loop drains the source predictably.
          const message = err instanceof Error ? err.message : String(err);
          const usage: TaskUsage = { inputTokens: 0, outputTokens: 0 };
          output = {
            taskId: claimedTask.task.id,
            attemptN: claimedTask.attemptN,
            status: 'failed',
            output: null,
            outputCid: null,
            usage,
            durationMs: Date.now() - taskStart,
            error: {
              code: 'executor_threw',
              message,
              retryable: false,
            },
          };
        }

        // If the reporter observed cancellation while the executor was
        // running, override whatever the executor produced. Executors
        // that wired `reporter.cancelSignal` into their loop will return
        // promptly with status='cancelled' already; this branch covers
        // executors that ignored the signal (or finished mid-flight
        // before noticing) so the runtime never reports `completed` for
        // a cancelled task (#938).
        if (reporter.cancelSignal.aborted && output.status !== 'cancelled') {
          output = {
            ...output,
            status: 'cancelled',
            output: null,
            outputCid: null,
            error: {
              code: 'task_cancelled',
              message:
                reporter.cancelReason ??
                'Task cancelled by imposer while executor was running.',
              retryable: false,
            },
          };
        }

        outputs.push(output);

        const finishedFields = {
          status: output.status,
          durationMs: output.durationMs,
          inputTokens: output.usage?.inputTokens,
          outputTokens: output.usage?.outputTokens,
          ...(output.error
            ? {
                errorCode: output.error.code,
                errorMessage: output.error.message,
              }
            : {}),
        };
        if (output.status === 'completed') {
          taskLogger.info(finishedFields, 'agent-runtime.task_finished');
        } else {
          taskLogger.warn(finishedFields, 'agent-runtime.task_finished');
        }

        this.status.tasksProcessed += 1;
        this.status.currentTaskId = null;
      }
    } finally {
      await this.opts.source.close();
      this.status.state = 'stopped';
    }
    return outputs;
  }

  /** Request cooperative shutdown. Safe from signal handlers. */
  stop(): void {
    this.stopRequested = true;
  }
}
