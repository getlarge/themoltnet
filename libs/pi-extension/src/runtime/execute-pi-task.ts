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
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { type Api, getModel, type Model } from '@mariozechner/pi-ai';
import type { ToolDefinition } from '@mariozechner/pi-coding-agent';
import {
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  SessionManager,
} from '@mariozechner/pi-coding-agent';
import {
  BUILT_IN_TASK_TYPES,
  buildPromptForTask,
  type ClaimedTask,
  type PromptContext,
  type TaskReporter,
  type TaskOutput,
  type TaskUsage,
} from '@themoltnet/agent-runtime';
import { computeJsonCid } from '@moltnet/crypto-service';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { connect } from '@themoltnet/sdk';

import {
  createMoltNetTools,
  HOST_EXEC_DEFAULT_BASE_ENV,
} from '../moltnet/tools.js';
import { ensureSnapshot, type SandboxConfig } from '../snapshot.js';
import {
  createGondolinBashOps,
  createGondolinEditOps,
  createGondolinReadOps,
  createGondolinWriteOps,
} from '../tool-operations.js';
import { activateAgentEnv, findMainWorktree, resumeVm } from '../vm-manager.js';
import { parseStructuredTaskOutput } from './task-output.js';

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
): (claimedTask: ClaimedTask, reporter: TaskReporter) => Promise<TaskOutput> {
  let cachedCheckpoint: string | null = opts.checkpointPath ?? null;

  return async (claimedTask, reporter) => {
    if (!cachedCheckpoint) {
      cachedCheckpoint = await ensureSnapshot({
        config: opts.sandboxConfig?.snapshot,
        onProgress:
          opts.onSnapshotProgress ??
          ((m) => {
            process.stderr.write(`[snapshot] ${m}\n`);
          }),
      });
    }
    return executePiTask(claimedTask, reporter, {
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
  claimedTask: ClaimedTask,
  reporter: TaskReporter,
  opts: ExecutePiTaskOptions,
): Promise<TaskOutput> {
  const task = claimedTask.task;
  const attemptN = opts.attemptN ?? claimedTask.attemptN;
  const startTime = Date.now();
  const mountPath = opts.mountPath ?? process.cwd();

  const checkpointPath =
    opts.checkpointPath ??
    (await ensureSnapshot({
      config: opts.sandboxConfig?.snapshot,
      onProgress:
        opts.onSnapshotProgress ??
        ((m) => {
          process.stderr.write(`[snapshot] ${m}\n`);
        }),
    }));

  // Repair worktree pointers on the host before the VM mounts the tree.
  // Mirrors the interactive extension (libs/pi-extension/src/index.ts):
  // rewrites each worktree's `.git` pointer and backlink to relative form
  // so the VM (which sees the tree at `/workspace`) can still follow them,
  // provided the worktree's relative depth from the main repo matches the
  // VM's layout. No-op if nothing needs fixing.
  const mainRepoForRepair = findMainWorktree();
  try {
    execFileSync(
      'git',
      ['-C', mainRepoForRepair, 'worktree', 'repair', '--relative-paths'],
      { stdio: 'pipe' },
    );
  } catch {
    // Best-effort — older git versions lack --relative-paths.
  }

  const managed = await resumeVm({
    checkpointPath,
    agentName: opts.agentName,
    mountPath,
    extraAllowedHosts: opts.extraAllowedHosts,
    sandboxConfig: opts.sandboxConfig,
  });

  const diaryId = task.diary_id ?? '';
  let reporterOpen = false;
  let session:
    | Awaited<ReturnType<typeof createAgentSession>>['session']
    | null = null;
  const finalUsage: TaskUsage = emptyUsage(opts.provider, opts.model);

  const makeFailedOutput = (
    code: string,
    message: string,
    usage: TaskUsage = finalUsage,
  ): TaskOutput => ({
    task_id: task.id,
    attempt_n: attemptN,
    status: 'failed',
    output: null,
    output_cid: null,
    usage,
    duration_ms: Date.now() - startTime,
    error: { code, message, retryable: false },
  });

  try {
    const mainRepo = findMainWorktree();
    activateAgentEnv(managed.credentials.agentEnv, mainRepo);

    await reporter.open({ taskId: task.id, attemptN });
    reporterOpen = true;

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
      return makeFailedOutput('prompt_build_failed', message);
    }

    // pi's createAgentSession only treats `tools:` as a name-filter; the actual
    // read/write/edit/bash implementations are rebuilt from defaults inside the
    // session unless we route them through customTools, which DOES override the
    // default by name at definition-registry merge time (AgentSession._refreshToolRegistry).
    const gondolinCustomTools = [
      createReadToolDefinition(mountPath, {
        operations: createGondolinReadOps(managed.vm, mountPath),
      }),
      createWriteToolDefinition(mountPath, {
        operations: createGondolinWriteOps(managed.vm, mountPath),
      }),
      createEditToolDefinition(mountPath, {
        operations: createGondolinEditOps(managed.vm, mountPath),
      }),
      createBashToolDefinition(mountPath, {
        operations: createGondolinBashOps(managed.vm, mountPath),
      }),
    ] as unknown as ToolDefinition[];

    try {
      const moltnetAgent = await connect({ configDir: managed.agentDir });
      // Build the host-exec env allowlist: default keys + all agent env keys
      // (MOLTNET_*, GIT_CONFIG_GLOBAL, etc. set by activateAgentEnv).
      const hostExecBaseEnv = new Set([
        ...HOST_EXEC_DEFAULT_BASE_ENV,
        ...Object.keys(managed.credentials.agentEnv),
      ]);
      const moltnetTools = createMoltNetTools({
        getAgent: () => moltnetAgent,
        getDiaryId: () => diaryId,
        getSessionErrors: () => [],
        clearSessionErrors: () => {
          /* no-op in headless mode */
        },
        getHostCwd: () => mountPath,
        hostExecBaseEnv,
      });

      const piAuthDir = join(homedir(), '.pi', 'agent');
      const getModelLoose = getModel as unknown as (
        provider: string,
        modelId: string,
      ) => Model<Api>;
      const modelHandle = getModelLoose(opts.provider, opts.model);

      const resourceLoader = new DefaultResourceLoader({
        cwd: mountPath,
        agentDir: piAuthDir,
      });
      await resourceLoader.reload();

      const created = await createAgentSession({
        agentDir: piAuthDir,
        cwd: mountPath,
        model: modelHandle,
        customTools: [...gondolinCustomTools, ...moltnetTools],
        sessionManager: SessionManager.inMemory(),
        resourceLoader,
      });
      session = created.session;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await emit('error', { message, phase: 'session_setup' });
      return makeFailedOutput('session_setup_failed', message);
    }

    let llmAbort = false;
    let assistantText = '';
    let reporterError: { code: string; message: string } | null = null;
    const usage: TaskUsage = finalUsage;
    const recordingPromise: Promise<void>[] = [];
    const track = (p: Promise<void>) => {
      recordingPromise.push(
        p.catch((err: unknown) => {
          if (!reporterError) {
            const message = err instanceof Error ? err.message : String(err);
            reporterError = { code: 'reporter_failed', message };
            process.stderr.write(`[reporter] ${message}\n`);
          }
        }),
      );
    };

    session.subscribe((event) => {
      if (event.type === 'message_update') {
        const ae = event.assistantMessageEvent;
        if (ae.type === 'text_delta') {
          assistantText += ae.delta;
          track(emit('text_delta', { delta: ae.delta }));
        }
      } else if (event.type === 'tool_execution_start') {
        track(emit('tool_call_start', { tool_name: event.toolName }));
      } else if (event.type === 'tool_execution_end') {
        track(
          emit('tool_call_end', {
            tool_name: event.toolName,
            is_error: event.isError,
            result: event.isError ? truncateForWire(event.result) : undefined,
          }),
        );
      } else if (event.type === 'turn_end') {
        const msg = event.message as {
          role?: string;
          stopReason?: string;
          usage?: {
            input?: number;
            output?: number;
            cacheRead?: number;
            cacheWrite?: number;
          };
        };
        if (msg?.role === 'assistant' && msg.usage) {
          usage.input_tokens += Math.max(0, msg.usage.input ?? 0);
          usage.output_tokens += Math.max(0, msg.usage.output ?? 0);
          const cr = Math.max(0, msg.usage.cacheRead ?? 0);
          const cw = Math.max(0, msg.usage.cacheWrite ?? 0);
          if (cr) usage.cache_read_tokens = (usage.cache_read_tokens ?? 0) + cr;
          if (cw)
            usage.cache_write_tokens = (usage.cache_write_tokens ?? 0) + cw;
        }
        track(emit('turn_end', { stop_reason: msg?.stopReason ?? 'end_turn' }));
        // Reflect ONLY the final turn's stop reason. pi emits turn_end per
        // assistant turn; a transient error in an earlier turn that pi then
        // recovers from (next turn completes cleanly) must not fail the task.
        // session.prompt() resolves after the final turn, so by the time we
        // read llmAbort below it holds the terminal state.
        llmAbort = msg?.stopReason === 'error';
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

    let parsedOutput: Record<string, unknown> | null = null;
    let parsedOutputCid: string | null = null;
    let parseError: { code: string; message: string } | null = null;
    if (!runError && !llmAbort) {
      const parsed = await parseStructuredTaskOutput(
        assistantText,
        task.task_type,
      );
      parsedOutput = parsed.output;
      parsedOutputCid = parsed.outputCid;
      parseError = parsed.error;
      if (parseError) {
        await emit('error', {
          message: parseError.message,
          phase: 'output_validation',
        });
      }
    }

    const status: TaskOutput['status'] =
      runError || llmAbort || parseError || reporterError
        ? 'failed'
        : 'completed';
    const errorCode =
      runError?.code ??
      parseError?.code ??
      (reporterError as { code: string } | null)?.code ??
      (llmAbort ? 'llm_api_error' : undefined);
    const errorMessage =
      runError?.message ??
      parseError?.message ??
      (reporterError as { message: string } | null)?.message ??
      (llmAbort ? 'LLM API error during turn' : undefined);

    return {
      task_id: task.id,
      attempt_n: attemptN,
      status,
      output: parsedOutput,
<<<<<<< HEAD
      output_cid: parsedOutput ? await computeJsonCid(parsedOutput) : null,
      usage,
      duration_ms: Date.now() - startTime,
      ...(errorCode && errorMessage
        ? {
            error: { code: errorCode, message: errorMessage, retryable: false },
          }
        : {}),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return makeFailedOutput('executor_unexpected_error', message);
  } finally {
    if (session) {
      try {
        session.dispose();
      } catch {
        /* swallow */
      }
    }
    if (reporterOpen) {
      try {
        await reporter.finalize(finalUsage);
      } catch {
        /* swallow */
      }
      try {
        await reporter.close();
      } catch {
        /* swallow */
      }
    }
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

/**
 * Cap oversized tool-result payloads before embedding them in a
 * `task_messages.payload` row. Bodies above 4 KiB are replaced with a
 * `{ truncated, original_size }` marker so the JSONL/DB size stays bounded.
 */
const TRUNCATE_LIMIT = 4 * 1024;
function truncateForWire(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length <= TRUNCATE_LIMIT) return value;
    return {
      truncated: value.slice(0, TRUNCATE_LIMIT),
      original_size: value.length,
    };
  }
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= TRUNCATE_LIMIT) return value;
    return {
      truncated: serialized.slice(0, TRUNCATE_LIMIT),
      original_size: serialized.length,
    };
  } catch {
    return { truncated: '[unserializable]', original_size: -1 };
  }
}
