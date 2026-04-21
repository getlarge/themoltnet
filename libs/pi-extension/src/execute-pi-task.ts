/**
 * executePiTask — run a single Task attempt using pi-coding-agent inside a
 * Gondolin sandbox.
 *
 * This is the pi-specific task executor. It owns:
 *   - VM lifecycle (ensureSnapshot + resumeVm + close)
 *   - Gondolin-redirected tool wiring (read/write/edit/bash → VM)
 *   - MoltNet custom tools (diary entries, pack render/judge, etc.)
 *   - pi createAgentSession + event → TaskReporter bridge
 *
 * `@moltnet/agent-runtime` is coding-agent-agnostic: it owns the Task loop,
 * reporters, sources, and prompt builders, but it does NOT depend on pi or
 * Gondolin. Concrete runtimes (this one, a future Codex one, a future direct
 * Anthropic-SDK one) plug in via the `executeTask` function injected into
 * `AgentRuntime`.
 */
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type Api, getModel, type Model } from '@mariozechner/pi-ai';
import {
  createAgentSession,
  createBashTool,
  createEditTool,
  createReadTool,
  createWriteTool,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import {
  buildPromptForTask,
  type PromptContext,
  type TaskReporter,
} from '@moltnet/agent-runtime';
import type { Task, TaskOutput, TaskUsage } from '@moltnet/tasks';
import { connect } from '@themoltnet/sdk';

import { createMoltNetTools } from './moltnet/tools.js';
import { ensureSnapshot, type SandboxConfig } from './snapshot.js';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} from './tool-operations.js';
import { activateAgentEnv, findMainWorktree, resumeVm } from './vm-manager.js';

export interface ExecutePiTaskOptions {
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
  /** Attempt number; defaults to 1. */
  attemptN?: number;
  /**
   * Optional pre-resolved checkpoint path. If omitted, `ensureSnapshot` is
   * invoked. Useful for batch execution where the caller wants to cache
   * across tasks.
   */
  checkpointPath?: string;
}

/**
 * Factory that builds a pi-specific `executeTask` function suitable for
 * injection into `AgentRuntime`. The returned function caches the resolved
 * checkpoint across tasks so the second task hits the snapshot cache.
 */
export function createPiTaskExecutor(
  opts: ExecutePiTaskOptions,
): (task: Task, reporter: TaskReporter) => Promise<TaskOutput> {
  let cachedCheckpoint: string | null = opts.checkpointPath ?? null;

  return async (task, reporter) => {
    if (!cachedCheckpoint) {
      cachedCheckpoint = await ensureSnapshot({
        onProgress:
          opts.onSnapshotProgress ??
          ((m) => {
            process.stderr.write(`[snapshot] ${m}\n`);
          }),
      });
    }
    return executePiTask(task, reporter, {
      ...opts,
      checkpointPath: cachedCheckpoint,
    });
  };
}

/**
 * Run one attempt of `task` in a freshly-resumed Gondolin VM. Owns the full
 * lifecycle: resume VM → wire tools → pi session → close VM. Always returns
 * a `TaskOutput` (failures surface as `status: 'failed'`); throws only on
 * unrecoverable setup errors.
 */
export async function executePiTask(
  task: Task,
  reporter: TaskReporter,
  opts: ExecutePiTaskOptions,
): Promise<TaskOutput> {
  const attemptN = opts.attemptN ?? 1;
  const startTime = Date.now();
  const mountPath = opts.mountPath ?? process.cwd();

  const checkpointPath =
    opts.checkpointPath ??
    (await ensureSnapshot({
      onProgress:
        opts.onSnapshotProgress ??
        ((m) => {
          process.stderr.write(`[snapshot] ${m}\n`);
        }),
    }));

  const managed = await resumeVm({
    checkpointPath,
    agentName: opts.agentName,
    mountPath,
    extraAllowedHosts: opts.extraAllowedHosts,
    sandboxConfig: opts.sandboxConfig,
  });

  try {
    const mainRepo = findMainWorktree();
    activateAgentEnv(managed.credentials.agentEnv, mainRepo);

    const diaryId = task.diary_id ?? '';
    await reporter.open({ taskId: task.id, attemptN });

    const emit = (
      kind: Parameters<TaskReporter['record']>[0]['kind'],
      payload: Record<string, unknown>,
    ) => reporter.record({ kind, payload });

    await emit('info', {
      event: 'execute_start',
      task_type: task.task_type,
      team_id: task.team_id,
      provider: opts.provider,
      model: opts.model,
    });

    let taskPrompt: string;
    try {
      const promptCtx: PromptContext = {
        diaryId,
        taskId: task.id,
        extras: opts.promptExtras,
      };
      taskPrompt = buildPromptForTask(task, promptCtx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'prompt_build' });
      const failedOutput: TaskOutput = {
        task_id: task.id,
        attempt_n: attemptN,
        status: 'failed',
        output: null,
        output_cid: null,
        usage: emptyUsage(opts.provider, opts.model),
        duration_ms: Date.now() - startTime,
        error: { code: 'prompt_build_failed', message, retryable: false },
      };
      await reporter.finalize(failedOutput.usage);
      await reporter.close();
      return failedOutput;
    }

    const gondolinRead = createReadTool(mountPath, {
      operations: createGondolinReadOps(managed.vm, mountPath),
    });
    const gondolinWrite = createWriteTool(mountPath, {
      operations: createGondolinWriteOps(managed.vm, mountPath),
    });
    const gondolinEdit = createEditTool(mountPath, {
      operations: createGondolinEditOps(managed.vm, mountPath),
    });
    const gondolinBash = createBashTool(mountPath, {
      operations: createGondolinBashOps(managed.vm, mountPath),
    });

    const moltnetAgent = await connect({ configDir: managed.agentDir });
    const moltnetTools = createMoltNetTools({
      getAgent: () => moltnetAgent,
      getDiaryId: () => diaryId,
      getSessionErrors: () => [],
      clearSessionErrors: () => {
        /* no-op in headless mode */
      },
    });

    const piAuthDir = join(homedir(), '.pi', 'agent');
    const getModelLoose = getModel as unknown as (
      provider: string,
      modelId: string,
    ) => Model<Api>;
    const modelHandle = getModelLoose(opts.provider, opts.model);

    const { session } = await createAgentSession({
      agentDir: piAuthDir,
      model: modelHandle,
      tools: [gondolinRead, gondolinWrite, gondolinEdit, gondolinBash],
      customTools: moltnetTools,
      sessionManager: SessionManager.inMemory(),
    });

    let llmAbort = false;
    const recordingPromise: Promise<void>[] = [];
    const track = (p: Promise<void>) => {
      recordingPromise.push(
        p.catch(() => {
          /* swallow */
        }),
      );
    };

    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent;
        if (ae.type === 'text_delta') {
          track(emit('text_delta', { delta: ae.delta }));
        }
      } else if (event.type === 'tool_execution_start') {
        track(emit('tool_call_start', { tool_name: event.toolName }));
      } else if (event.type === 'tool_execution_end') {
        track(
          emit('tool_call_end', {
            tool_name: event.toolName,
            is_error: event.isError,
            result: event.isError ? event.result : undefined,
          }),
        );
      } else if (event.type === 'turn_end') {
        const msg = (event as Record<string, unknown>)['message'] as
          | { stopReason?: string }
          | undefined;
        track(emit('turn_end', { stop_reason: msg?.stopReason ?? 'end_turn' }));
        if (msg?.stopReason === 'error') {
          llmAbort = true;
        }
      }
    });

    let runError: { code: string; message: string } | null = null;
    try {
      await session.prompt(taskPrompt);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      runError = { code: 'session_prompt_failed', message };
      await emit('error', { message, phase: 'session_prompt' });
    }

    await Promise.all(recordingPromise);

    const usage = emptyUsage(opts.provider, opts.model);
    await reporter.finalize(usage);
    session.dispose();
    await reporter.close();

    const status: TaskOutput['status'] =
      runError || llmAbort ? 'failed' : 'completed';
    const errorCode =
      runError?.code ?? (llmAbort ? 'llm_api_error' : undefined);
    const errorMessage =
      runError?.message ?? (llmAbort ? 'LLM API error during turn' : undefined);

    return {
      task_id: task.id,
      attempt_n: attemptN,
      status,
      output: null,
      output_cid: null,
      usage,
      duration_ms: Date.now() - startTime,
      ...(errorCode && errorMessage
        ? {
            error: { code: errorCode, message: errorMessage, retryable: false },
          }
        : {}),
    };
  } finally {
    await managed.vm.close();
  }
}

function emptyUsage(provider: string, model: string): TaskUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    provider,
    model,
  };
}
