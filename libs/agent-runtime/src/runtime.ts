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

import type { TaskReporter } from './reporters/index.js';
import type { ClaimedTask, TaskSource } from './sources/index.js';

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

  constructor(private readonly opts: AgentRuntimeOptions) {}

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
        const reporter = this.opts.makeReporter(claimedTask);
        const taskStart = Date.now();
        let output: TaskOutput;
        try {
          output = await this.opts.executeTask(claimedTask, reporter);
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
        outputs.push(output);

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
