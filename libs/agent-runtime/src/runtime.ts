/**
 * AgentRuntime — orchestrates the claim → execute → report loop.
 *
 * PR 0 scope: pull one task at a time from a `TaskSource`, provision a
 * Gondolin VM, run `executeTask`, close the VM, report the output. No
 * retries, no concurrency, no attempt-N > 1.
 *
 * The same class powers PR 7's daemon mode — the only delta is swapping
 * `TaskSource` (file → HTTP long-poll) and `TaskReporter` (stdout/jsonl →
 * HTTP POST). `AgentRuntime` itself stays identical; that's the whole
 * point of the abstraction.
 */
import type { Task, TaskOutput } from '@moltnet/tasks';
import {
  activateAgentEnv,
  ensureSnapshot,
  findMainWorktree,
  resumeVm,
  type SandboxConfig,
} from '@themoltnet/pi-extension';

import { executeTask } from './execute-task.js';
import type { TaskReporter } from './reporters/index.js';
import type { TaskSource } from './sources/index.js';

export interface AgentRuntimeOptions {
  /** Pulls the next task (file in PR 0, HTTP poll in PR 7). */
  source: TaskSource;
  /**
   * Factory for per-task reporters. Called once per claimed task so
   * reporters can own a fresh file / stream / connection.
   */
  makeReporter: (task: Task) => TaskReporter;
  /** MoltNet agent whose credentials the VM boots with. */
  agentName: string;
  /** Host cwd that the VM mounts at /workspace (defaults to `process.cwd()`). */
  mountPath?: string;
  /** LLM selection. */
  provider: string;
  model: string;
  /** Extra hosts to allow in the sandbox egress policy. */
  extraAllowedHosts?: string[];
  /** Sandbox overrides (env, VFS shadows, resources). */
  sandboxConfig?: SandboxConfig;
  /** Forwarded to `buildPromptForTask` for per-type builders. */
  promptExtras?: Record<string, unknown>;
  /** Snapshot progress callback; defaults to stderr logging. */
  onSnapshotProgress?: (message: string) => void;
}

export interface AgentRuntimeStatus {
  state: 'idle' | 'running' | 'stopped';
  tasksProcessed: number;
  currentTaskId: string | null;
}

/**
 * Local-mode runtime: `start()` drains the source then resolves.
 * PR 7 replaces the source with an HTTP long-poll so the loop runs
 * forever; no other code changes.
 */
export class AgentRuntime {
  private status: AgentRuntimeStatus = {
    state: 'idle',
    tasksProcessed: 0,
    currentTaskId: null,
  };
  private stopRequested = false;
  private checkpointPath: string | null = null;

  constructor(private readonly opts: AgentRuntimeOptions) {}

  getStatus(): AgentRuntimeStatus {
    return { ...this.status };
  }

  /**
   * Drain the source, executing each task in its own VM. Resolves with
   * every `TaskOutput` the runtime produced (in order). Failures are
   * captured as `TaskOutput.status === 'failed'` — they do not throw.
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
        const task = await this.opts.source.claim();
        if (!task) break;

        this.status.currentTaskId = task.id;
        const output = await this.runOne(task);
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

  /**
   * Request cooperative shutdown. The in-flight task (if any) finishes;
   * subsequent `claim()` calls are skipped. Safe to call from signal
   * handlers.
   */
  stop(): void {
    this.stopRequested = true;
  }

  private async runOne(task: Task): Promise<TaskOutput> {
    const reporter = this.opts.makeReporter(task);

    // Resolve snapshot once per runtime. Subsequent tasks hit the cache.
    if (!this.checkpointPath) {
      this.checkpointPath = await ensureSnapshot({
        onProgress:
          this.opts.onSnapshotProgress ??
          ((m) => {
            process.stderr.write(`[snapshot] ${m}\n`);
          }),
      });
    }

    const mountPath = this.opts.mountPath ?? process.cwd();
    const managed = await resumeVm({
      checkpointPath: this.checkpointPath,
      agentName: this.opts.agentName,
      mountPath,
      extraAllowedHosts: this.opts.extraAllowedHosts,
      sandboxConfig: this.opts.sandboxConfig,
    });

    try {
      const mainRepo = findMainWorktree();
      activateAgentEnv(managed.credentials.agentEnv, mainRepo);

      return await executeTask(task, {
        cwd: mountPath,
        agentDir: managed.agentDir,
        managedVm: managed,
        reporter,
        provider: this.opts.provider,
        model: this.opts.model,
        promptExtras: this.opts.promptExtras,
      });
    } finally {
      await managed.vm.close();
    }
  }
}
